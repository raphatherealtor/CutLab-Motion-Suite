/**
 * CutLab Keyframe Engine — Section 6
 * Canonical keyframe editing: add/delete/move/next/prev, interpolation.
 * Keyframe time = RationalTime. Evaluation is deterministic.
 * Viewer manipulation at a keyed playhead updates the intended keyframe.
 */

import type { Keyframe, EasingType, Clip } from './schema';
import type { RationalTime } from './time';
import { compare, toSeconds } from './time';
import type { OpEnvelope } from './operations';
import { makeOp } from './operations';
import { generateId } from './schema';

// ── Keyframeable properties ───────────────────────────────────

export const KEYFRAMEABLE_PROPERTIES = [
  // Transform
  'transform.x', 'transform.y', 'transform.scaleX', 'transform.scaleY',
  'transform.rotation', 'transform.opacity',
  // Crop
  'transform.cropLeft', 'transform.cropRight', 'transform.cropTop', 'transform.cropBottom',
  // Audio
  'gain', 'pan',
  // Effect params (prefixed with effect ID)
  'effect.blur.amount', 'effect.brightness.amount', 'effect.contrast.amount',
  'effect.saturation.amount', 'effect.opacity.amount',
] as const;

export type KeyframeableProperty = string;

// ── Keyframe evaluation ───────────────────────────────────────

/**
 * Evaluate a keyframed property at a given clip-local time.
 * Returns the interpolated value.
 * If no keyframes for property, returns the base value.
 */
export function evaluateKeyframedProperty(
  clip: Clip,
  property: KeyframeableProperty,
  clipLocalTime: RationalTime,
  baseValue: number
): number {
  const kfs = clip.keyframes
    .filter((k) => k.property === property)
    .sort((a, b) => compare(a.time, b.time));

  if (kfs.length === 0) return baseValue;

  const t = toSeconds(clipLocalTime);

  // Before first keyframe
  if (t <= toSeconds(kfs[0].time)) return Number(kfs[0].value);
  // After last keyframe
  if (t >= toSeconds(kfs[kfs.length - 1].time)) return Number(kfs[kfs.length - 1].value);

  // Find surrounding keyframes
  let prev = kfs[0];
  let next = kfs[1];
  for (let i = 0; i < kfs.length - 1; i++) {
    if (t >= toSeconds(kfs[i].time) && t <= toSeconds(kfs[i + 1].time)) {
      prev = kfs[i];
      next = kfs[i + 1];
      break;
    }
  }

  const t0 = toSeconds(prev.time);
  const t1 = toSeconds(next.time);
  const v0 = Number(prev.value);
  const v1 = Number(next.value);
  const alpha = t1 === t0 ? 0 : (t - t0) / (t1 - t0);

  return interpolate(alpha, v0, v1, prev.easing);
}

function interpolate(alpha: number, v0: number, v1: number, easing: EasingType): number {
  switch (easing) {
    case 'hold': return v0;
    case 'linear': return v0 + (v1 - v0) * alpha;
    case 'ease-in': {
      const t = alpha * alpha;
      return v0 + (v1 - v0) * t;
    }
    case 'ease-out': {
      const t = alpha * (2 - alpha);
      return v0 + (v1 - v0) * t;
    }
    case 'ease-in-out': {
      const t = alpha < 0.5 ? 2 * alpha * alpha : -1 + (4 - 2 * alpha) * alpha;
      return v0 + (v1 - v0) * t;
    }
    default: return v0 + (v1 - v0) * alpha;
  }
}

// ── Keyframe navigation ───────────────────────────────────────

export function nextKeyframeTime(
  clip: Clip,
  property: KeyframeableProperty,
  currentTime: RationalTime
): RationalTime | null {
  const kfs = clip.keyframes
    .filter((k) => k.property === property)
    .sort((a, b) => compare(a.time, b.time));
  let next = kfs.find((k) => compare(k.time, currentTime) > 0);
  return next?.time ?? null;
}

export function prevKeyframeTime(
  clip: Clip,
  property: KeyframeableProperty,
  currentTime: RationalTime
): RationalTime | null {
  const kfs = clip.keyframes
    .filter((k) => k.property === property)
    .sort((a, b) => compare(b.time, a.time));
  let prev = kfs.find((k) => compare(k.time, currentTime) < 0);
  return prev?.time ?? null;
}

export function keyframeAtTime(
  clip: Clip,
  property: KeyframeableProperty,
  time: RationalTime,
  toleranceFrames = 1,
  fps = 29.97
): Keyframe | null {
  const toleranceSecs = toleranceFrames / fps;
  return clip.keyframes.find((k) => {
    if (k.property !== property) return false;
    return Math.abs(toSeconds(k.time) - toSeconds(time)) <= toleranceSecs;
  }) ?? null;
}

// ── Keyframe op builders ──────────────────────────────────────

export function buildAddKeyframeOps(
  sequenceId: string,
  clip: Clip,
  property: KeyframeableProperty,
  clipLocalTime: RationalTime,
  value: number,
  easing: EasingType = 'linear'
): OpEnvelope[] {
  // Check if keyframe already exists at this time
  const existing = keyframeAtTime(clip, property, clipLocalTime);
  const kf: Keyframe = {
    id: existing?.id ?? generateId('kf'),
    time: clipLocalTime,
    property,
    value,
    easing,
  };
  return [makeOp('keyframe.upsert', { sequenceId, clipId: clip.id, keyframe: kf }, 'user')];
}

export function buildDeleteKeyframeOps(
  sequenceId: string,
  clipId: string,
  keyframeId: string
): OpEnvelope[] {
  return [makeOp('keyframe.remove', { sequenceId, clipId, keyframeId }, 'user')];
}

export function buildMoveKeyframeOps(
  sequenceId: string,
  clipId: string,
  keyframeId: string,
  newTime: RationalTime
): OpEnvelope[] {
  return [makeOp('keyframe.move', { sequenceId, clipId, keyframeId, newTime }, 'user')];
}

export function buildSetEasingOps(
  sequenceId: string,
  clipId: string,
  keyframeId: string,
  easing: EasingType
): OpEnvelope[] {
  return [makeOp('keyframe.setEasing', { sequenceId, clipId, keyframeId, easing }, 'user')];
}

/**
 * When viewer manipulates a property at a keyed playhead:
 * Update the INTENDED keyframe, not the base property.
 * If no keyframe exists at this time, create one.
 */
export function buildViewerKeyframeUpdateOps(
  sequenceId: string,
  clip: Clip,
  property: KeyframeableProperty,
  clipLocalTime: RationalTime,
  newValue: number,
  fps: number
): OpEnvelope[] {
  const existing = keyframeAtTime(clip, property, clipLocalTime, 1, fps);
  if (existing) {
    // Update existing keyframe value
    const updated: Keyframe = { ...existing, value: newValue };
    return [makeOp('keyframe.upsert', { sequenceId, clipId: clip.id, keyframe: updated }, 'user')];
  }
  // Create new keyframe at this time
  return buildAddKeyframeOps(sequenceId, clip, property, clipLocalTime, newValue);
}

// ── Evaluate all keyframed transform properties ───────────────

export function evaluateClipTransform(
  clip: Clip,
  clipLocalTime: RationalTime
): import('./schema').Transform {
  const t = clip.transform;
  return {
    x: evaluateKeyframedProperty(clip, 'transform.x', clipLocalTime, t.x),
    y: evaluateKeyframedProperty(clip, 'transform.y', clipLocalTime, t.y),
    scaleX: evaluateKeyframedProperty(clip, 'transform.scaleX', clipLocalTime, t.scaleX),
    scaleY: evaluateKeyframedProperty(clip, 'transform.scaleY', clipLocalTime, t.scaleY),
    rotation: evaluateKeyframedProperty(clip, 'transform.rotation', clipLocalTime, t.rotation),
    opacity: evaluateKeyframedProperty(clip, 'transform.opacity', clipLocalTime, t.opacity),
    cropLeft: evaluateKeyframedProperty(clip, 'transform.cropLeft', clipLocalTime, t.cropLeft),
    cropRight: evaluateKeyframedProperty(clip, 'transform.cropRight', clipLocalTime, t.cropRight),
    cropTop: evaluateKeyframedProperty(clip, 'transform.cropTop', clipLocalTime, t.cropTop),
    cropBottom: evaluateKeyframedProperty(clip, 'transform.cropBottom', clipLocalTime, t.cropBottom),
  };
}
