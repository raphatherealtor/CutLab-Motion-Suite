/**
 * CutLab Transcript Workspace — Section 10
 * Word click → seek, phrase selection, search, speaker labels,
 * filler/silence detection, delete words → timeline ops,
 * tighten, keep speaker, captions gen, SRT export, navigation.
 * Transcript entities retain stable IDs. Timeline changes project correctly.
 */

import type { TranscriptWord, Sequence } from './schema';

import { fromSeconds, toSeconds, compare } from './time';
import type { OpEnvelope } from './operations';
import { makeOp } from './operations';
import { generateId } from './schema';

// ── Word seek ─────────────────────────────────────────────────

/**
 * Get the sequence frame for a transcript word click.
 * Maps word time through clip source offset to sequence time.
 */
export function wordToSequenceFrame(
  word: TranscriptWord,
  clip: import('./schema').Clip,
  fps: number
): number {
  const wordSecs = toSeconds(word.startTime);
  const clipSourceStart = toSeconds(clip.sourceIn);
  const clipSeqStart = toSeconds(clip.startTime);
  const offsetSecs = wordSecs - clipSourceStart;
  const seqSecs = clipSeqStart + offsetSecs / (clip.speed || 1);
  return Math.round(seqSecs * fps);
}

// ── Phrase / range selection ──────────────────────────────────

export interface TranscriptSelection {
  startWordId: string;
  endWordId: string;
  words: TranscriptWord[];
}

export function getWordRange(
  words: TranscriptWord[],
  startId: string,
  endId: string
): TranscriptWord[] {
  const sorted = [...words].sort((a, b) => compare(a.startTime, b.startTime));
  const startIdx = sorted.findIndex((w) => w.id === startId);
  const endIdx = sorted.findIndex((w) => w.id === endId);
  if (startIdx < 0 || endIdx < 0) return [];
  const [lo, hi] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
  return sorted.slice(lo, hi + 1);
}

// ── Search ────────────────────────────────────────────────────

export function searchTranscript(
  words: TranscriptWord[],
  query: string
): TranscriptWord[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return words.filter((w) => w.text.toLowerCase().includes(q));
}

// ── Speaker navigation ────────────────────────────────────────

export function getSpeakers(words: TranscriptWord[]): string[] {
  const speakers = new Set<string>();
  for (const w of words) {
    if (w.speaker) speakers.add(w.speaker);
  }
  return Array.from(speakers).sort();
}

export function getWordsBySpeaker(
  words: TranscriptWord[],
  speaker: string
): TranscriptWord[] {
  return words.filter((w) => w.speaker === speaker);
}

export function nextSpeakerChangeFrame(
  words: TranscriptWord[],
  currentFrame: number,
  fps: number
): number | null {
  const sorted = [...words].sort((a, b) => compare(a.startTime, b.startTime));
  const currentSecs = currentFrame / fps;
  let lastSpeaker: string | undefined;

  for (const w of sorted) {
    const wSecs = toSeconds(w.startTime);
    if (wSecs <= currentSecs) {
      lastSpeaker = w.speaker;
      continue;
    }
    if (w.speaker && w.speaker !== lastSpeaker) {
      return Math.round(wSecs * fps);
    }
    lastSpeaker = w.speaker;
  }
  return null;
}

// ── Filler / dead air detection ───────────────────────────────

const FILLER_WORDS = new Set([
  'um', 'uh', 'er', 'ah', 'like', 'you know', 'i mean',
  'basically', 'literally', 'actually', 'so', 'right',
  'okay', 'ok', 'hmm', 'hm', 'mm',
]);

export function detectFillers(words: TranscriptWord[]): TranscriptWord[] {
  return words.map((w) => ({
    ...w,
    isFiller: FILLER_WORDS.has(w.text.toLowerCase().trim()),
  }));
}

export function detectDeadAir(
  words: TranscriptWord[],
  thresholdMs = 800
): TranscriptWord[] {
  const sorted = [...words].sort((a, b) => compare(a.startTime, b.startTime));
  const thresholdSecs = thresholdMs / 1000;
  const result: TranscriptWord[] = [...sorted];

  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = toSeconds(sorted[i + 1].startTime) - toSeconds(sorted[i].endTime);
    if (gap > thresholdSecs) {
      // Mark the gap — represented as a synthetic dead-air word
      result.push({
        id: generateId('dead-air'),
        text: '[silence]',
        startTime: sorted[i].endTime,
        endTime: sorted[i + 1].startTime,
        isDeadAir: true,
        speaker: sorted[i].speaker,
      });
    }
  }

  return result.sort((a, b) => compare(a.startTime, b.startTime));
}

// ── Delete words → timeline ops ───────────────────────────────

const DEFAULT_PAD_MS = 60;
const FRAME_GUARD = 2;

export function buildDeleteWordsOps(
  words: TranscriptWord[],
  seq: Sequence,
  fps: number
): OpEnvelope[] {
  const ops: OpEnvelope[] = [];
  const padSecs = DEFAULT_PAD_MS / 1000;
  const guardSecs = FRAME_GUARD / fps;

  for (const word of words) {
    const startSecs = toSeconds(word.startTime);
    const endSecs = toSeconds(word.endTime);
    const deleteStart = fromSeconds(Math.max(0, startSecs - padSecs + guardSecs), 30000);
    const deleteEnd = fromSeconds(endSecs + padSecs - guardSecs, 30000);

    ops.push(makeOp('timeline.rippleDeleteRange', {
      sequenceId: seq.id,
      startTime: deleteStart,
      endTime: deleteEnd,
    }, 'user'));
  }

  return ops;
}

// ── Tighten selection ─────────────────────────────────────────

export function buildTightenSelectionOps(
  selectedWords: TranscriptWord[],
  seq: Sequence,
  fps: number
): OpEnvelope[] {
  // Tighten: trim clips to selection boundaries
  if (selectedWords.length === 0) return [];
  const sorted = [...selectedWords].sort((a, b) => compare(a.startTime, b.startTime));
  const selStart = toSeconds(sorted[0].startTime);
  const selEnd = toSeconds(sorted[sorted.length - 1].endTime);

  const ops: OpEnvelope[] = [];
  const padSecs = DEFAULT_PAD_MS / 1000;

  // Delete before selection
  if (selStart > padSecs) {
    ops.push(makeOp('timeline.rippleDeleteRange', {
      sequenceId: seq.id,
      startTime: fromSeconds(0, 30000),
      endTime: fromSeconds(selStart - padSecs, 30000),
    }, 'user'));
  }

  return ops;
}

// ── Keep speaker ──────────────────────────────────────────────

export function buildKeepSpeakerOps(
  words: TranscriptWord[],
  keepSpeaker: string,
  seq: Sequence,
  fps: number
): OpEnvelope[] {
  const sorted = [...words].sort((a, b) => compare(a.startTime, b.startTime));
  const ops: OpEnvelope[] = [];
  const padSecs = DEFAULT_PAD_MS / 1000;
  const guardSecs = FRAME_GUARD / fps;

  // Find regions NOT from the kept speaker
  let i = 0;
  while (i < sorted.length) {
    if (sorted[i].speaker !== keepSpeaker) {
      const regionStart = toSeconds(sorted[i].startTime);
      let j = i;
      while (j < sorted.length && sorted[j].speaker !== keepSpeaker) j++;
      const regionEnd = j < sorted.length
        ? toSeconds(sorted[j].startTime)
        : toSeconds(sorted[sorted.length - 1].endTime);

      const deleteStart = fromSeconds(regionStart + guardSecs, 30000);
      const deleteEnd = fromSeconds(regionEnd - guardSecs, 30000);

      if (regionEnd - regionStart > guardSecs * 2) {
        ops.push(makeOp('timeline.rippleDeleteRange', {
          sequenceId: seq.id,
          startTime: deleteStart,
          endTime: deleteEnd,
        }, 'skill'));
      }
      i = j;
    } else {
      i++;
    }
  }

  return ops;
}

// ── Captions from transcript ──────────────────────────────────

export function buildCaptionsFromTranscriptOps(
  words: TranscriptWord[],
  seq: Sequence,
  maxWordsPerLine = 7,
  maxDurationSecs = 3
): OpEnvelope[] {
  const captionTrack = seq.tracks.find((t) => t.kind === 'caption');
  if (!captionTrack) return [];

  const sorted = [...words].sort((a, b) => compare(a.startTime, b.startTime));
  const ops: OpEnvelope[] = [];
  let lineWords: TranscriptWord[] = [];

  const flushLine = () => {
    if (lineWords.length === 0) return;
    const caption = {
      id: generateId('cap'),
      startTime: lineWords[0].startTime,
      endTime: lineWords[lineWords.length - 1].endTime,
      text: lineWords.map((w) => w.text).join(' '),
      trackId: captionTrack.id,
      speaker: lineWords[0].speaker,
      wordTimings: lineWords.map((w) => ({
        wordId: w.id,
        text: w.text,
        startTime: w.startTime,
        endTime: w.endTime,
      })),
    };
    ops.push(makeOp('caption.upsert', { sequenceId: seq.id, caption }, 'skill'));
    lineWords = [];
  };

  for (const word of sorted) {
    if (word.isDeadAir) { flushLine(); continue; }
    lineWords.push(word);
    const lineDur = toSeconds(word.endTime) - toSeconds(lineWords[0].startTime);
    // Speaker change = new line
    const speakerChanged = lineWords.length > 1 &&
      word.speaker !== lineWords[lineWords.length - 2].speaker;
    if (lineWords.length >= maxWordsPerLine || lineDur >= maxDurationSecs || speakerChanged) {
      flushLine();
    }
  }
  flushLine();

  return ops;
}

// ── SRT export ────────────────────────────────────────────────

export function exportSRT(captions: import('./schema').Caption[]): string {
  const sorted = [...captions].sort((a, b) => compare(a.startTime, b.startTime));
  return sorted.map((cap, i) => {
    const start = toSRTTime(toSeconds(cap.startTime));
    const end = toSRTTime(toSeconds(cap.endTime));
    return `${i + 1}\n${start} --> ${end}\n${cap.text}\n`;
  }).join('\n');
}

function toSRTTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const ms = Math.round((secs % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${ms.toString().padStart(3, '0')}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

// ── Transcript navigation ─────────────────────────────────────

export function wordAtFrame(
  words: TranscriptWord[],
  frame: number,
  fps: number
): TranscriptWord | null {
  const secs = frame / fps;
  return words.find((w) => {
    const start = toSeconds(w.startTime);
    const end = toSeconds(w.endTime);
    return secs >= start && secs < end;
  }) ?? null;
}

export function nextWordFrame(
  words: TranscriptWord[],
  currentFrame: number,
  fps: number
): number | null {
  const currentSecs = currentFrame / fps;
  const sorted = [...words].sort((a, b) => compare(a.startTime, b.startTime));
  const next = sorted.find((w) => toSeconds(w.startTime) > currentSecs);
  return next ? Math.round(toSeconds(next.startTime) * fps) : null;
}

export function prevWordFrame(
  words: TranscriptWord[],
  currentFrame: number,
  fps: number
): number | null {
  const currentSecs = currentFrame / fps;
  const sorted = [...words].sort((a, b) => compare(b.startTime, a.startTime));
  const prev = sorted.find((w) => toSeconds(w.startTime) < currentSecs);
  return prev ? Math.round(toSeconds(prev.startTime) * fps) : null;
}
