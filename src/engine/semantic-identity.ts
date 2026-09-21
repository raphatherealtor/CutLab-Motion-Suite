/**
 * CutLab Semantic Identity System
 * Persistent semantic/text identities for word/phrase targeting.
 * Resolves selections to stable IDs rather than fragile visual indices.
 * Bridges Studio transcript truth → Motion text bindings.
 */

import type { TranscriptWord, SemanticCue } from './schema';
import { toSeconds } from './time';

// ── Canonical Text Target ─────────────────────────────────────

export type TextTargetKind =
  | 'whole-text'       // entire text object
  | 'phrase'           // contiguous word range by IDs
  | 'word'             // single word by ID
  | 'semantic-phrase'  // phrase identified by semantic cue
  | 'active-spoken'    // currently spoken word (runtime)
  | 'speaker-phrase';  // all words by a speaker

export interface TextTarget {
  kind: TextTargetKind;
  /** For word/phrase: stable word IDs from transcript */
  wordIds?: string[];
  /** For semantic-phrase: cue ID */
  cueId?: string;
  /** For speaker-phrase: speaker label */
  speaker?: string;
  /** Human-readable label for display */
  label: string;
  /** Confidence that this target is still valid after edits */
  confidence: number; // 0..1
}

// ── Semantic Word Identity ────────────────────────────────────

export interface SemanticWordIdentity {
  /** Stable ID from transcript */
  wordId: string;
  /** The word text at time of binding */
  text: string;
  /** Word index within its phrase/sentence */
  phraseIndex: number;
  /** Speaker who spoke this word */
  speaker?: string;
  /** Semantic emphasis score 0..1 */
  emphasis: number;
  /** Whether this word is a filler/dead-air */
  isFiller: boolean;
  /** Start time in seconds */
  startSecs: number;
  /** End time in seconds */
  endSecs: number;
}

// ── Phrase Identity ───────────────────────────────────────────

export interface PhraseIdentity {
  /** Stable phrase ID — derived from first+last word IDs */
  phraseId: string;
  /** Word IDs in order */
  wordIds: string[];
  /** Reconstructed text */
  text: string;
  /** Speaker (if uniform) */
  speaker?: string;
  /** Start/end seconds */
  startSecs: number;
  endSecs: number;
  /** Semantic cue ID if this phrase is cue-bound */
  cueId?: string;
}

// ── Motion Binding Record ─────────────────────────────────────

export interface MotionTextBinding {
  /** Stable binding ID */
  bindingId: string;
  /** The canonical text target */
  target: TextTarget;
  /** Motion document ID */
  motionDocumentId: string;
  /** Motion object ID within the document */
  motionObjectId: string;
  /** Motion behavior ID */
  motionBehaviorId?: string;
  /** What property/behavior is bound */
  bindingType: 'choreography' | 'signal' | 'material' | 'spatial' | 'emphasis';
  /** Reconciliation status */
  status: 'active' | 'ambiguous' | 'broken' | 'reconciled';
  /** When status is ambiguous, the reason */
  ambiguityReason?: string;
  createdAt: number;
  updatedAt: number;
}

// ── Reconciliation Result ─────────────────────────────────────

export interface ReconciliationResult {
  preserved: MotionTextBinding[];
  ambiguous: Array<{ binding: MotionTextBinding; reason: string; candidates: TextTarget[] }>;
  broken: MotionTextBinding[];
}

// ── Build semantic word identities from transcript ────────────

export function buildWordIdentities(words: TranscriptWord[]): Map<string, SemanticWordIdentity> {
  const sorted = [...words].sort((a, b) => toSeconds(a.startTime) - toSeconds(b.startTime));
  const map = new Map<string, SemanticWordIdentity>();

  // Group into phrases by speaker and timing gaps
  let phraseIndex = 0;
  let lastSpeaker: string | undefined;
  let lastEndSecs = 0;

  for (const word of sorted) {
    const startSecs = toSeconds(word.startTime);
    const endSecs = toSeconds(word.endTime);

    // New phrase if speaker changes or gap > 0.5s
    if (word.speaker !== lastSpeaker || startSecs - lastEndSecs > 0.5) {
      phraseIndex = 0;
    }

    // Compute emphasis: longer words, non-fillers, and words after pauses get higher emphasis
    const duration = endSecs - startSecs;
    const pauseBefore = startSecs - lastEndSecs;
    const emphasis = Math.min(1,
      (word.isFiller ? 0 : 0.3) +
      Math.min(0.3, duration / 0.8) +
      Math.min(0.2, pauseBefore / 0.3) +
      (word.confidence ?? 0.8) * 0.2
    );

    map.set(word.id, {
      wordId: word.id,
      text: word.text,
      phraseIndex,
      speaker: word.speaker,
      emphasis,
      isFiller: word.isFiller ?? false,
      startSecs,
      endSecs,
    });

    phraseIndex++;
    lastSpeaker = word.speaker;
    lastEndSecs = endSecs;
  }

  return map;
}

// ── Build phrase identities from word groups ──────────────────

export function buildPhraseIdentities(
  words: TranscriptWord[],
  cues?: SemanticCue[]
): PhraseIdentity[] {
  const sorted = [...words].sort((a, b) => toSeconds(a.startTime) - toSeconds(b.startTime));
  const phrases: PhraseIdentity[] = [];

  let currentPhrase: TranscriptWord[] = [];
  let lastSpeaker: string | undefined;
  let lastEndSecs = 0;

  const flushPhrase = () => {
    if (currentPhrase.length === 0) return;
    const first = currentPhrase[0];
    const last = currentPhrase[currentPhrase.length - 1];
    const phraseId = `phrase-${first.id}-${last.id}`;

    // Check if any cue covers this phrase
    const startSecs = toSeconds(first.startTime);
    const endSecs = toSeconds(last.endTime);
    const matchingCue = cues?.find((c) => {
      const cStart = toSeconds(c.timeRange.start);
      const cEnd = toSeconds(c.timeRange.end);
      return cStart <= startSecs && cEnd >= endSecs;
    });

    phrases.push({
      phraseId,
      wordIds: currentPhrase.map((w) => w.id),
      text: currentPhrase.map((w) => w.text).join(' '),
      speaker: first.speaker,
      startSecs,
      endSecs,
      cueId: matchingCue?.id,
    });
    currentPhrase = [];
  };

  for (const word of sorted) {
    const startSecs = toSeconds(word.startTime);
    const endSecs = toSeconds(word.endTime);

    if (word.speaker !== lastSpeaker || startSecs - lastEndSecs > 0.8) {
      flushPhrase();
    }

    currentPhrase.push(word);
    lastSpeaker = word.speaker;
    lastEndSecs = endSecs;
  }
  flushPhrase();

  return phrases;
}

// ── Resolve text target from selection ───────────────────────

export function resolveTextTarget(
  words: TranscriptWord[],
  selection: { startWordId?: string; endWordId?: string; speaker?: string; cueId?: string },
  cues?: SemanticCue[]
): TextTarget {
  const sorted = [...words].sort((a, b) => toSeconds(a.startTime) - toSeconds(b.startTime));

  if (selection.cueId) {
    const cue = cues?.find((c) => c.id === selection.cueId);
    const cueWords = cue
      ? sorted.filter((w) => {
          const ws = toSeconds(w.startTime);
          return ws >= toSeconds(cue.timeRange.start) && ws <= toSeconds(cue.timeRange.end);
        })
      : [];
    return {
      kind: 'semantic-phrase',
      wordIds: cueWords.map((w) => w.id),
      cueId: selection.cueId,
      label: cue?.label ?? 'Semantic Phrase',
      confidence: 0.95,
    };
  }

  if (selection.speaker) {
    const speakerWords = sorted.filter((w) => w.speaker === selection.speaker);
    return {
      kind: 'speaker-phrase',
      wordIds: speakerWords.map((w) => w.id),
      speaker: selection.speaker,
      label: `Speaker: ${selection.speaker}`,
      confidence: 0.9,
    };
  }

  if (selection.startWordId && selection.endWordId) {
    const startIdx = sorted.findIndex((w) => w.id === selection.startWordId);
    const endIdx = sorted.findIndex((w) => w.id === selection.endWordId);
    if (startIdx >= 0 && endIdx >= 0) {
      const [lo, hi] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
      const rangeWords = sorted.slice(lo, hi + 1);
      if (lo === hi) {
        return {
          kind: 'word',
          wordIds: [sorted[lo].id],
          label: sorted[lo].text,
          confidence: 1.0,
        };
      }
      return {
        kind: 'phrase',
        wordIds: rangeWords.map((w) => w.id),
        label: rangeWords.map((w) => w.text).join(' ').slice(0, 40),
        confidence: 0.95,
      };
    }
  }

  if (selection.startWordId) {
    const word = sorted.find((w) => w.id === selection.startWordId);
    return {
      kind: 'word',
      wordIds: word ? [word.id] : [],
      label: word?.text ?? 'Unknown word',
      confidence: word ? 1.0 : 0,
    };
  }

  return {
    kind: 'whole-text',
    label: 'Whole Text',
    confidence: 1.0,
  };
}

// ── Reconcile bindings after transcript edit ──────────────────

export function reconcileMotionBindings(
  bindings: MotionTextBinding[],
  oldWords: TranscriptWord[],
  newWords: TranscriptWord[]
): ReconciliationResult {
  const result: ReconciliationResult = { preserved: [], ambiguous: [], broken: [] };

  const newWordMap = new Map(newWords.map((w) => [w.id, w]));
  const newWordsByText = new Map<string, TranscriptWord[]>();
  for (const w of newWords) {
    const key = w.text.toLowerCase().trim();
    if (!newWordsByText.has(key)) newWordsByText.set(key, []);
    newWordsByText.get(key)!.push(w);
  }

  for (const binding of bindings) {
    const target = binding.target;

    if (target.kind === 'whole-text') {
      // Whole-text bindings always survive
      result.preserved.push({ ...binding, status: 'active' });
      continue;
    }

    if (target.kind === 'speaker-phrase') {
      // Speaker bindings survive as long as speaker exists
      const speakerExists = newWords.some((w) => w.speaker === target.speaker);
      if (speakerExists) {
        result.preserved.push({ ...binding, status: 'active' });
      } else {
        result.broken.push({ ...binding, status: 'broken' });
      }
      continue;
    }

    if (!target.wordIds || target.wordIds.length === 0) {
      result.broken.push({ ...binding, status: 'broken' });
      continue;
    }

    // Check how many word IDs still exist
    const existingIds = target.wordIds.filter((id) => newWordMap.has(id));
    const missingIds = target.wordIds.filter((id) => !newWordMap.has(id));

    if (missingIds.length === 0) {
      // All IDs preserved — perfect reconciliation
      result.preserved.push({ ...binding, status: 'reconciled' });
      continue;
    }

    if (existingIds.length === 0) {
      // All IDs gone — try text-based recovery
      const oldWordTexts = target.wordIds
        .map((id) => oldWords.find((w) => w.id === id)?.text ?? '')
        .filter(Boolean);

      if (oldWordTexts.length > 0) {
        // Try to find matching words by text
        const candidates: TextTarget[] = [];
        for (const text of oldWordTexts) {
          const matches = newWordsByText.get(text.toLowerCase().trim()) ?? [];
          if (matches.length === 1) {
            candidates.push({
              kind: target.kind,
              wordIds: [matches[0].id],
              label: matches[0].text,
              confidence: 0.7,
            });
          }
        }

        if (candidates.length > 0) {
          result.ambiguous.push({
            binding: { ...binding, status: 'ambiguous' },
            reason: `Words removed from transcript. Found ${candidates.length} possible match(es) by text.`,
            candidates,
          });
        } else {
          result.broken.push({ ...binding, status: 'broken' });
        }
      } else {
        result.broken.push({ ...binding, status: 'broken' });
      }
      continue;
    }

    // Partial survival — ambiguous
    result.ambiguous.push({
      binding: { ...binding, status: 'ambiguous' },
      reason: `${missingIds.length} of ${target.wordIds.length} words were removed. Binding may be incomplete.`,
      candidates: [{
        kind: target.kind,
        wordIds: existingIds,
        label: `Partial: ${existingIds.length}/${target.wordIds.length} words`,
        confidence: existingIds.length / target.wordIds.length,
      }],
    });
  }

  return result;
}

// ── Get active spoken word at time ────────────────────────────

export function getActiveSpokenWord(
  words: TranscriptWord[],
  timeSecs: number
): TranscriptWord | null {
  for (const word of words) {
    const start = toSeconds(word.startTime);
    const end = toSeconds(word.endTime);
    if (timeSecs >= start && timeSecs <= end) return word;
  }
  return null;
}

// ── Get word progress (0..1) at time ─────────────────────────

export function getWordProgress(word: TranscriptWord, timeSecs: number): number {
  const start = toSeconds(word.startTime);
  const end = toSeconds(word.endTime);
  if (timeSecs < start) return 0;
  if (timeSecs > end) return 1;
  const dur = end - start;
  if (dur <= 0) return 1;
  return (timeSecs - start) / dur;
}

// ── Get phrase progress (0..1) at time ───────────────────────

export function getPhraseProgress(
  words: TranscriptWord[],
  phraseWordIds: string[],
  timeSecs: number
): number {
  const phraseWords = words.filter((w) => phraseWordIds.includes(w.id));
  if (phraseWords.length === 0) return 0;
  const sorted = phraseWords.sort((a, b) => toSeconds(a.startTime) - toSeconds(b.startTime));
  const start = toSeconds(sorted[0].startTime);
  const end = toSeconds(sorted[sorted.length - 1].endTime);
  if (timeSecs < start) return 0;
  if (timeSecs > end) return 1;
  const dur = end - start;
  if (dur <= 0) return 1;
  return (timeSecs - start) / dur;
}

// ── Detect speech pause at time ───────────────────────────────

export function isSpeechPause(words: TranscriptWord[], timeSecs: number, minGapSecs = 0.3): boolean {
  const sorted = [...words].sort((a, b) => toSeconds(a.startTime) - toSeconds(b.startTime));
  for (let i = 0; i < sorted.length - 1; i++) {
    const endSecs = toSeconds(sorted[i].endTime);
    const nextStartSecs = toSeconds(sorted[i + 1].startTime);
    if (timeSecs >= endSecs && timeSecs <= nextStartSecs && nextStartSecs - endSecs >= minGapSecs) {
      return true;
    }
  }
  return false;
}

// ── Get semantic emphasis for a word ─────────────────────────

export function getWordEmphasis(
  word: TranscriptWord,
  cues?: SemanticCue[]
): number {
  if (!cues) return 0;
  const wordStart = toSeconds(word.startTime);
  const wordEnd = toSeconds(word.endTime);

  for (const cue of cues) {
    if (cue.type !== 'emphasis') continue;
    const cueStart = toSeconds(cue.timeRange.start);
    const cueEnd = toSeconds(cue.timeRange.end);
    if (wordStart >= cueStart && wordEnd <= cueEnd) {
      return (cue.data?.intensity as number) ?? 1.0;
    }
  }
  return 0;
}
