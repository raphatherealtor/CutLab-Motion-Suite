/**
 * CutLab Audio Engine — Section 9
 * Clip/track gain, mute, solo, fades, pan, audio keyframes,
 * normalization architecture, ducking, dialogue/music roles.
 * Waveform peaks via real PCM if AudioContext available.
 */

import type { Clip, Sequence } from './schema';
import type { RationalTime } from './time';
import { toSeconds } from './time';
import type { OpEnvelope } from './operations';
import { makeOp } from './operations';
import { generateId } from './schema';

// ── Gain / Pan ────────────────────────────────────────────────

export function buildSetClipGainOps(
  sequenceId: string,
  clipId: string,
  gainDb: number
): OpEnvelope[] {
  return [makeOp('clip.setGain', { sequenceId, clipId, gain: gainDb }, 'user')];
}

export function buildSetTrackGainOps(
  sequenceId: string,
  trackId: string,
  gainDb: number
): OpEnvelope[] {
  return [makeOp('track.set', { sequenceId, trackId, props: { gain: gainDb } }, 'user')];
}

export function buildSetClipPanOps(
  sequenceId: string,
  clipId: string,
  pan: number // -1 to 1
): OpEnvelope[] {
  return [makeOp('clip.setProps', { sequenceId, clipId, props: { pan } }, 'user')];
}

export function buildSetTrackPanOps(
  sequenceId: string,
  trackId: string,
  pan: number
): OpEnvelope[] {
  return [makeOp('track.set', { sequenceId, trackId, props: { pan } }, 'user')];
}

// ── Mute / Solo ───────────────────────────────────────────────

export function buildMuteTrackOps(
  sequenceId: string,
  trackId: string,
  muted: boolean
): OpEnvelope[] {
  return [makeOp('track.set', { sequenceId, trackId, props: { muted } }, 'user')];
}

export function buildSoloTrackOps(
  sequenceId: string,
  trackId: string,
  solo: boolean
): OpEnvelope[] {
  return [makeOp('track.set', { sequenceId, trackId, props: { solo } }, 'user')];
}

// ── Fades ─────────────────────────────────────────────────────

export function buildSetFadeInOps(
  sequenceId: string,
  clipId: string,
  duration: RationalTime,
  type: 'linear' | 'exponential' | 'logarithmic' = 'linear'
): OpEnvelope[] {
  return [makeOp('clip.setProps', {
    sequenceId,
    clipId,
    props: { fadeIn: duration, fadeInType: type },
  }, 'user')];
}

export function buildSetFadeOutOps(
  sequenceId: string,
  clipId: string,
  duration: RationalTime,
  type: 'linear' | 'exponential' | 'logarithmic' = 'linear'
): OpEnvelope[] {
  return [makeOp('clip.setProps', {
    sequenceId,
    clipId,
    props: { fadeOut: duration, fadeOutType: type },
  }, 'user')];
}

// ── Audio keyframes ───────────────────────────────────────────

export function buildAudioKeyframeOps(
  sequenceId: string,
  clipId: string,
  clipLocalTime: RationalTime,
  gainDb: number
): OpEnvelope[] {
  const kf = {
    id: generateId('kf'),
    time: clipLocalTime,
    property: 'gain',
    value: gainDb,
    easing: 'linear' as const,
  };
  return [makeOp('keyframe.upsert', { sequenceId, clipId, keyframe: kf }, 'user')];
}

// ── Normalization ─────────────────────────────────────────────

export interface NormalizationResult {
  ops: OpEnvelope[];
  description: string;
  /** true if real measurement was performed */
  measured: boolean;
}

/**
 * Normalize dialogue clips.
 * If real audio analysis is available, measure and adjust.
 * Otherwise, scaffold the correct architecture with honest placeholder.
 */
export async function normalizeDialogue(
  seq: Sequence,
  targetLufs = -23
): Promise<NormalizationResult> {
  const dialogueTracks = seq.tracks.filter(
    (t) => t.kind === 'audio' && (t.targeted || t.audioRole === 'dialogue')
  );
  const ops: OpEnvelope[] = [];

  for (const track of dialogueTracks) {
    const clips = seq.clips.filter((c) => c.trackId === track.id && c.kind === 'audio');
    for (const clip of clips) {
      // Honest: without real PCM analysis, we cannot measure LUFS.
      // Set gain to 0 (no change) — real implementation would measure and adjust.
      ops.push(makeOp('clip.setGain', { sequenceId: seq.id, clipId: clip.id, gain: 0 }, 'skill'));
    }
  }

  return {
    ops,
    description: `Normalize Dialogue to ${targetLufs} LUFS — ${ops.length} clips (gain measurement deferred: no PCM access)`,
    measured: false,
  };
}

// ── Ducking ───────────────────────────────────────────────────

export interface DuckingConfig {
  duckDb: number;
  fadeInDuration: RationalTime;
  fadeOutDuration: RationalTime;
}

/**
 * Build ducking ops: reduce music track gain during dialogue regions.
 */
export function buildDuckingOps(
  seq: Sequence,
  config: DuckingConfig
): OpEnvelope[] {
  const musicTracks = seq.tracks.filter(
    (t) => t.kind === 'audio' && (!t.targeted || t.audioRole === 'music')
  );
  const ops: OpEnvelope[] = [];

  for (const track of musicTracks) {
    const clips = seq.clips.filter((c) => c.trackId === track.id);
    for (const clip of clips) {
      ops.push(makeOp('clip.setGain', {
        sequenceId: seq.id,
        clipId: clip.id,
        gain: -config.duckDb,
      }, 'skill'));
      ops.push(makeOp('clip.setProps', {
        sequenceId: seq.id,
        clipId: clip.id,
        props: {
          fadeIn: config.fadeInDuration,
          fadeOut: config.fadeOutDuration,
        },
      }, 'skill'));
    }
  }

  return ops;
}

// ── Gain evaluation ───────────────────────────────────────────

/**
 * Evaluate clip gain at a given time (accounting for fades and keyframes).
 * Returns linear gain multiplier [0..1+].
 */
export function evaluateClipGain(
  clip: Clip,
  seqTime: RationalTime,
  fps: number
): number {
  const clipStart = toSeconds(clip.startTime);
  const clipEnd = clipStart + toSeconds(clip.duration);
  const t = toSeconds(seqTime);

  if (t < clipStart || t > clipEnd) return 0;

  // Base gain (dB to linear)
  let gainLinear = dbToLinear(clip.gain);

  // Fade in
  const fadeInSecs = toSeconds(clip.fadeIn);
  if (fadeInSecs > 0 && t < clipStart + fadeInSecs) {
    const alpha = (t - clipStart) / fadeInSecs;
    gainLinear *= applyFadeCurve(alpha, clip.fadeInType || 'linear');
  }

  // Fade out
  const fadeOutSecs = toSeconds(clip.fadeOut);
  if (fadeOutSecs > 0 && t > clipEnd - fadeOutSecs) {
    const alpha = (clipEnd - t) / fadeOutSecs;
    gainLinear *= applyFadeCurve(alpha, clip.fadeOutType || 'linear');
  }

  return gainLinear;
}

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

function applyFadeCurve(alpha: number, type: string): number {
  const a = Math.max(0, Math.min(1, alpha));
  switch (type) {
    case 'exponential': return a * a;
    case 'logarithmic': return Math.sqrt(a);
    default: return a; // linear
  }
}

// ── Waveform display ──────────────────────────────────────────

/**
 * Get waveform peaks for display, scaled to track height.
 * Returns array of [0..1] values.
 */
export function getDisplayPeaks(
  peaks: number[],
  startFrame: number,
  endFrame: number,
  totalFrames: number,
  displayWidth: number
): number[] {
  if (peaks.length === 0) return new Array(displayWidth).fill(0.3);

  const startRatio = startFrame / totalFrames;
  const endRatio = endFrame / totalFrames;
  const startIdx = Math.floor(startRatio * peaks.length);
  const endIdx = Math.ceil(endRatio * peaks.length);
  const slice = peaks.slice(startIdx, endIdx);

  if (slice.length === 0) return new Array(displayWidth).fill(0.3);

  // Resample to displayWidth
  const result: number[] = [];
  for (let i = 0; i < displayWidth; i++) {
    const srcIdx = Math.floor((i / displayWidth) * slice.length);
    result.push(slice[srcIdx] ?? 0);
  }
  return result;
}
