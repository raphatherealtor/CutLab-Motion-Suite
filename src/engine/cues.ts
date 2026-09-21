/**
 * CutLab Semantic Cue Foundation — Section 12
 * Lightweight canonical cue/event representation.
 * References RationalTime, transcript words, markers, clips, graphics, captions.
 * Semantic type metadata for future graphics/captions/Motion to react to.
 * This is metadata/project truth — does NOT automatically mutate project.
 */

import type { SemanticCue, CueSemanticType } from './schema';
import type { RationalTime } from './time';
import { compare } from './time';
import { generateId } from './schema';
import type { OpEnvelope } from './operations';
import { makeOp } from './operations';

// ── Cue factory ───────────────────────────────────────────────

export function createCue(
  type: CueSemanticType,
  timeRange: { start: RationalTime; end: RationalTime },
  options: Partial<SemanticCue> = {}
): SemanticCue {
  return {
    id: generateId('cue'),
    type,
    timeRange,
    ...options,
  };
}

// ── Cue op builders ───────────────────────────────────────────

export function buildUpsertCueOps(
  sequenceId: string,
  cue: SemanticCue
): OpEnvelope[] {
  return [makeOp('cue.upsert', { sequenceId, cue }, 'user')];
}

export function buildRemoveCueOps(
  sequenceId: string,
  cueId: string
): OpEnvelope[] {
  return [makeOp('cue.remove', { sequenceId, cueId }, 'user')];
}

// ── Cue queries ───────────────────────────────────────────────

export function cuesAtTime(
  cues: SemanticCue[],
  time: RationalTime
): SemanticCue[] {
  return cues.filter((c) =>
    compare(c.timeRange.start, time) <= 0 &&
    compare(c.timeRange.end, time) >= 0
  );
}

export function cuesInRange(
  cues: SemanticCue[],
  start: RationalTime,
  end: RationalTime
): SemanticCue[] {
  return cues.filter((c) =>
    compare(c.timeRange.start, end) <= 0 &&
    compare(c.timeRange.end, start) >= 0
  );
}

export function cuesByType(
  cues: SemanticCue[],
  type: CueSemanticType
): SemanticCue[] {
  return cues.filter((c) => c.type === type);
}

export function cuesByClip(
  cues: SemanticCue[],
  clipId: string
): SemanticCue[] {
  return cues.filter((c) => c.clipId === clipId);
}

export function cuesByTranscriptWord(
  cues: SemanticCue[],
  wordId: string
): SemanticCue[] {
  return cues.filter((c) =>
    c.transcriptWordId === wordId ||
    c.transcriptRangeStart === wordId ||
    c.transcriptRangeEnd === wordId
  );
}

// ── Auto-cue generation ───────────────────────────────────────

/**
 * Generate speaker-change cues from transcript words.
 * Useful for future graphics/captions to react to speaker changes.
 */
export function generateSpeakerChangeCues(
  words: import('./schema').TranscriptWord[],
  sequenceId: string
): OpEnvelope[] {
  const sorted = [...words].sort((a, b) => compare(a.startTime, b.startTime));
  const ops: OpEnvelope[] = [];
  let lastSpeaker: string | undefined;

  for (const word of sorted) {
    if (word.speaker && word.speaker !== lastSpeaker) {
      const cue = createCue('speaker-change', {
        start: word.startTime,
        end: word.endTime,
      }, {
        transcriptWordId: word.id,
        label: word.speaker,
        data: { speaker: word.speaker },
      });
      ops.push(makeOp('cue.upsert', { sequenceId, cue }, 'system'));
      lastSpeaker = word.speaker;
    }
  }

  return ops;
}

/**
 * Generate chapter cues from markers.
 */
export function generateChapterCues(
  markers: import('./schema').Marker[],
  sequenceId: string,
  sequenceDuration: RationalTime
): OpEnvelope[] {
  const sorted = [...markers].sort((a, b) => compare(a.time, b.time));
  const ops: OpEnvelope[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const marker = sorted[i];
    const end = sorted[i + 1]?.time ?? sequenceDuration;
    const cue = createCue('chapter', {
      start: marker.time,
      end,
    }, {
      markerId: marker.id,
      label: marker.label,
      data: { chapter: marker.label },
    });
    ops.push(makeOp('cue.upsert', { sequenceId, cue }, 'system'));
  }

  return ops;
}

// ── Cue context for Motion/Graphics ──────────────────────────

/**
 * Get cue context for a given time — used by Motion evaluator and graphics.
 * Returns structured context that future renderers can use deterministically.
 */
export interface CueContext {
  activeCues: SemanticCue[];
  speakerChange: SemanticCue | null;
  emphasis: SemanticCue | null;
  beat: SemanticCue | null;
  chapter: SemanticCue | null;
  callout: SemanticCue | null;
  highlight: SemanticCue | null;
  statistic: SemanticCue | null;
}

export function getCueContext(
  cues: SemanticCue[],
  time: RationalTime
): CueContext {
  const active = cuesAtTime(cues, time);
  return {
    activeCues: active,
    speakerChange: active.find((c) => c.type === 'speaker-change') ?? null,
    emphasis: active.find((c) => c.type === 'emphasis') ?? null,
    beat: active.find((c) => c.type === 'beat') ?? null,
    chapter: active.find((c) => c.type === 'chapter') ?? null,
    callout: active.find((c) => c.type === 'callout') ?? null,
    highlight: active.find((c) => c.type === 'highlight') ?? null,
    statistic: active.find((c) => c.type === 'statistic') ?? null,
  };
}
