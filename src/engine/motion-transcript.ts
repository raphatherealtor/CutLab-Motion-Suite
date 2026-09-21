/**
 * CutLab Motion Transcript Bridge
 * Connects Studio transcript/captions/cues/markers to Motion text choreography.
 * Studio owns the transcript. Motion consumes it as immutable signal/text data.
 */

import type { Sequence, Caption, SemanticCue, TranscriptWord } from './schema';
import type { MotionDocument, MotionOp, MotionTextSegment, MotionSignal, MotionBehavior } from '@/motion/types';
import { secondsToMotionTime } from '@/motion/types';
import { makeMotionOp } from '@/motion/transaction';
import { generateMotionId } from '@/motion/utils';
import { toSeconds } from './time';

// ── Caption → Motion Text ─────────────────────────────────────

/**
 * Convert Studio captions to Motion text segments with word timing.
 * Used to drive word-by-word text choreography.
 */
export function captionsToMotionTextSegments(
  captions: Caption[],
  clipStartSecs: number,
  clipDurationSecs: number
): MotionTextSegment[] {
  const segments: MotionTextSegment[] = [];

  for (const cap of captions) {
    const capStart = toSeconds(cap.startTime);
    const capEnd = toSeconds(cap.endTime);

    // Only include captions within clip range
    if (capEnd < clipStartSecs || capStart > clipStartSecs + clipDurationSecs) continue;

    // Convert to clip-local time
    const localStart = capStart - clipStartSecs;
    const localEnd = capEnd - clipStartSecs;

    const segment: MotionTextSegment = {
      id: generateMotionId('seg'),
      text: cap.text,
      fontFamily: 'Inter, sans-serif',
      fontSize: 48,
      fontWeight: 700,
      textAlign: 'center',
    };

    // Add word-level timing if available
    if (cap.wordTimings && cap.wordTimings.length > 0) {
      segment.wordTimings = cap.wordTimings.map((wt) => ({
        wordId: wt.wordId,
        text: wt.text,
        startTime: secondsToMotionTime(Math.max(0, toSeconds(wt.startTime) - clipStartSecs)),
        endTime: secondsToMotionTime(Math.max(0, toSeconds(wt.endTime) - clipStartSecs)),
        emphasis: (wt.semanticMetadata?.emphasis as number) ?? 0,
      }));
    }

    segments.push(segment);
  }

  return segments;
}

/**
 * Create Motion ops to inject transcript word timing into a text object.
 * Enables word-by-word choreography driven by Studio transcript.
 */
export function injectTranscriptIntoMotionObject(
  doc: MotionDocument,
  objectId: string,
  words: TranscriptWord[],
  clipStartSecs: number
): MotionOp[] {
  const obj = doc.objects[objectId];
  if (!obj || obj.kind !== 'text') return [];

  const segment: MotionTextSegment = {
    id: obj.textSegments?.[0]?.id ?? generateMotionId('seg'),
    text: words.map((w) => w.text).join(' '),
    fontFamily: obj.textSegments?.[0]?.fontFamily ?? 'Inter, sans-serif',
    fontSize: obj.textSegments?.[0]?.fontSize ?? 48,
    fontWeight: obj.textSegments?.[0]?.fontWeight ?? 700,
    textAlign: obj.textSegments?.[0]?.textAlign ?? 'center',
    wordTimings: words.map((w) => ({
      wordId: w.id,
      text: w.text,
      startTime: secondsToMotionTime(Math.max(0, toSeconds(w.startTime) - clipStartSecs)),
      endTime: secondsToMotionTime(Math.max(0, toSeconds(w.endTime) - clipStartSecs)),
      emphasis: 0,
    })),
  };

  return [makeMotionOp('motion.setTextSegment', doc.id, { objectId, segment })];
}

// ── Semantic Cue → Motion Trigger ─────────────────────────────

/**
 * Convert Studio semantic cues to Motion signal sample data.
 * Emphasis cues become signal spikes that drive Motion behaviors.
 */
export function cuesToMotionSignals(
  cues: SemanticCue[],
  clipStartSecs: number,
  clipDurationSecs: number
): MotionSignal[] {
  const signals: MotionSignal[] = [];

  // Group cues by type
  const emphasisCues = cues.filter((c) => c.type === 'emphasis');
  const beatCues = cues.filter((c) => c.type === 'beat');
  const chapterCues = cues.filter((c) => c.type === 'chapter');

  if (emphasisCues.length > 0) {
    const sampleData = generateCueSignalData(emphasisCues, clipStartSecs, clipDurationSecs);
    signals.push({
      id: generateMotionId('sig'),
      kind: 'semantic-emphasis',
      name: 'Semantic Emphasis',
      sampleData,
    });
  }

  if (beatCues.length > 0) {
    const sampleData = generateCueSignalData(beatCues, clipStartSecs, clipDurationSecs);
    signals.push({
      id: generateMotionId('sig'),
      kind: 'audio-beat',
      name: 'Beat Cues',
      sampleData,
    });
  }

  return signals;
}

function generateCueSignalData(
  cues: SemanticCue[],
  clipStartSecs: number,
  clipDurationSecs: number
): number[] {
  const resolution = 30; // samples per second
  const totalSamples = Math.ceil(clipDurationSecs * resolution);
  const data = new Array(totalSamples).fill(0);

  for (const cue of cues) {
    const cueStart = toSeconds(cue.timeRange.start) - clipStartSecs;
    const cueEnd = toSeconds(cue.timeRange.end) - clipStartSecs;

    const startIdx = Math.max(0, Math.floor(cueStart * resolution));
    const endIdx = Math.min(totalSamples - 1, Math.ceil(cueEnd * resolution));

    for (let i = startIdx; i <= endIdx; i++) {
      const t = (i / resolution - cueStart) / Math.max(0.001, cueEnd - cueStart);
      // Smooth envelope: attack + sustain + decay
      const envelope = t < 0.2 ? t / 0.2 : t > 0.8 ? (1 - t) / 0.2 : 1;
      data[i] = Math.max(data[i], envelope);
    }
  }

  return data;
}

// ── Marker → Motion Trigger ───────────────────────────────────

/**
 * Create Motion behaviors triggered by Studio markers.
 */
export function markersToMotionBehaviors(
  markers: Sequence['markers'],
  clipStartSecs: number,
  clipDurationSecs: number,
  behaviorType: MotionBehavior['type'] = 'pulse'
): MotionBehavior[] {
  const behaviors: MotionBehavior[] = [];

  for (const marker of markers) {
    const markerSecs = toSeconds(marker.time);
    const localSecs = markerSecs - clipStartSecs;

    if (localSecs < 0 || localSecs > clipDurationSecs) continue;

    behaviors.push({
      id: generateMotionId('beh'),
      type: behaviorType,
      startTime: secondsToMotionTime(localSecs),
      duration: secondsToMotionTime(0.3),
      params: { amplitude: 0.15, frequency: 3 },
      easing: 'ease-out',
    });
  }

  return behaviors;
}

// ── Speaker → Motion Styling ──────────────────────────────────

/**
 * Map speaker identities to Motion material colors.
 * Enables speaker-aware text styling.
 */
export function speakerToMotionColor(speaker: string): string {
  const speakerColors: Record<string, string> = {
    'speaker-0': '#3B82FF',
    'speaker-1': '#34D399',
    'speaker-2': '#F43F5E',
    'speaker-3': '#8B5CF6',
    'speaker-4': '#22D3EE',
    'speaker-5': '#F59E0B',
  };

  // Hash speaker name to color
  const hash = speaker.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const colorKeys = Object.keys(speakerColors);
  return speakerColors[colorKeys[hash % colorKeys.length]] ?? '#ffffff';
}

/**
 * Build a complete Motion signal set from Studio sequence context.
 * Called when inserting a Motion clip to pre-populate signals.
 */
export function buildMotionSignalsFromSequence(
  seq: Sequence,
  clipStartSecs: number,
  clipDurationSecs: number
): MotionSignal[] {
  const signals: MotionSignal[] = [];

  // Cue-based signals
  const cueSignals = cuesToMotionSignals(seq.cues, clipStartSecs, clipDurationSecs);
  signals.push(...cueSignals);

  // Audio RMS placeholder (will be populated by AudioBridgeSeam)
  signals.push({
    id: generateMotionId('sig'),
    kind: 'audio-rms',
    name: 'Audio RMS',
    // Sample data will be filled in by AudioBridgeSeam
  });

  return signals;
}
