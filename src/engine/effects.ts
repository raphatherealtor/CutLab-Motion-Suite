/**
 * CutLab Effect Stack — Section 7
 * Ordered effect model. Project-level stacks. Keyframe-eligible parameters.
 * Effects: transform, crop, opacity, blur, brightness, contrast, saturation,
 *          vignette, sharpen, color-temperature, tint, exposure.
 */

import type { Effect, EffectType } from './schema';
import { generateId } from './schema';
import type { OpEnvelope } from './operations';
import { makeOp } from './operations';

// ── Effect definitions ────────────────────────────────────────

export interface EffectDefinition {
  type: EffectType;
  label: string;
  description: string;
  defaultParams: Record<string, number | string | boolean>;
  paramDefs: EffectParamDef[];
}

export interface EffectParamDef {
  key: string;
  label: string;
  type: 'number' | 'boolean' | 'select';
  min?: number;
  max?: number;
  step?: number;
  default: number | string | boolean;
  keyframeEligible?: boolean;
  options?: string[];
}

export const EFFECT_DEFINITIONS: Record<EffectType, EffectDefinition> = {
  transform: {
    type: 'transform',
    label: 'Transform',
    description: 'Position, scale, rotation, opacity',
    defaultParams: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    paramDefs: [
      { key: 'x', label: 'Position X', type: 'number', min: -4096, max: 4096, step: 1, default: 0, keyframeEligible: true },
      { key: 'y', label: 'Position Y', type: 'number', min: -4096, max: 4096, step: 1, default: 0, keyframeEligible: true },
      { key: 'scaleX', label: 'Scale X', type: 'number', min: 0, max: 10, step: 0.01, default: 1, keyframeEligible: true },
      { key: 'scaleY', label: 'Scale Y', type: 'number', min: 0, max: 10, step: 0.01, default: 1, keyframeEligible: true },
      { key: 'rotation', label: 'Rotation', type: 'number', min: -360, max: 360, step: 0.1, default: 0, keyframeEligible: true },
      { key: 'opacity', label: 'Opacity', type: 'number', min: 0, max: 1, step: 0.01, default: 1, keyframeEligible: true },
    ],
  },
  crop: {
    type: 'crop',
    label: 'Crop',
    description: 'Crop edges',
    defaultParams: { left: 0, right: 0, top: 0, bottom: 0 },
    paramDefs: [
      { key: 'left', label: 'Left', type: 'number', min: 0, max: 1, step: 0.01, default: 0, keyframeEligible: true },
      { key: 'right', label: 'Right', type: 'number', min: 0, max: 1, step: 0.01, default: 0, keyframeEligible: true },
      { key: 'top', label: 'Top', type: 'number', min: 0, max: 1, step: 0.01, default: 0, keyframeEligible: true },
      { key: 'bottom', label: 'Bottom', type: 'number', min: 0, max: 1, step: 0.01, default: 0, keyframeEligible: true },
    ],
  },
  opacity: {
    type: 'opacity',
    label: 'Opacity',
    description: 'Clip opacity',
    defaultParams: { amount: 1 },
    paramDefs: [
      { key: 'amount', label: 'Opacity', type: 'number', min: 0, max: 1, step: 0.01, default: 1, keyframeEligible: true },
    ],
  },
  blur: {
    type: 'blur',
    label: 'Blur',
    description: 'Gaussian blur',
    defaultParams: { amount: 0, maskId: '' },
    paramDefs: [
      { key: 'amount', label: 'Amount', type: 'number', min: 0, max: 100, step: 0.5, default: 0, keyframeEligible: true },
    ],
  },
  brightness: {
    type: 'brightness',
    label: 'Brightness',
    description: 'Brightness / exposure',
    defaultParams: { amount: 0 },
    paramDefs: [
      { key: 'amount', label: 'Amount', type: 'number', min: -1, max: 1, step: 0.01, default: 0, keyframeEligible: true },
    ],
  },
  contrast: {
    type: 'contrast',
    label: 'Contrast',
    description: 'Contrast',
    defaultParams: { amount: 0 },
    paramDefs: [
      { key: 'amount', label: 'Amount', type: 'number', min: -1, max: 1, step: 0.01, default: 0, keyframeEligible: true },
    ],
  },
  saturation: {
    type: 'saturation',
    label: 'Saturation',
    description: 'Color saturation',
    defaultParams: { amount: 0 },
    paramDefs: [
      { key: 'amount', label: 'Amount', type: 'number', min: -1, max: 1, step: 0.01, default: 0, keyframeEligible: true },
    ],
  },
  vignette: {
    type: 'vignette',
    label: 'Vignette',
    description: 'Edge darkening vignette',
    defaultParams: { amount: 0, feather: 0.5 },
    paramDefs: [
      { key: 'amount', label: 'Amount', type: 'number', min: 0, max: 1, step: 0.01, default: 0, keyframeEligible: true },
      { key: 'feather', label: 'Feather', type: 'number', min: 0, max: 1, step: 0.01, default: 0.5, keyframeEligible: false },
    ],
  },
  sharpen: {
    type: 'sharpen',
    label: 'Sharpen',
    description: 'Unsharp mask sharpening',
    defaultParams: { amount: 0 },
    paramDefs: [
      { key: 'amount', label: 'Amount', type: 'number', min: 0, max: 2, step: 0.05, default: 0, keyframeEligible: true },
    ],
  },
  'color-temperature': {
    type: 'color-temperature',
    label: 'Color Temperature',
    description: 'Warm/cool color temperature',
    defaultParams: { amount: 0 },
    paramDefs: [
      { key: 'amount', label: 'Temperature', type: 'number', min: -1, max: 1, step: 0.01, default: 0, keyframeEligible: true },
    ],
  },
  tint: {
    type: 'tint',
    label: 'Tint',
    description: 'Green/magenta tint',
    defaultParams: { amount: 0 },
    paramDefs: [
      { key: 'amount', label: 'Tint', type: 'number', min: -1, max: 1, step: 0.01, default: 0, keyframeEligible: true },
    ],
  },
  exposure: {
    type: 'exposure',
    label: 'Exposure',
    description: 'Exposure in stops',
    defaultParams: { amount: 0 },
    paramDefs: [
      { key: 'amount', label: 'Stops', type: 'number', min: -5, max: 5, step: 0.1, default: 0, keyframeEligible: true },
    ],
  },
  custom: {
    type: 'custom',
    label: 'Custom',
    description: 'Custom effect',
    defaultParams: {},
    paramDefs: [],
  },
};

// ── Effect factory ────────────────────────────────────────────

export function createEffect(type: EffectType, order: number): Effect {
  const def = EFFECT_DEFINITIONS[type];
  return {
    id: generateId('fx'),
    type,
    enabled: true,
    params: { ...def.defaultParams },
    order,
    keyframeEligible: def.paramDefs.some((p) => p.keyframeEligible),
  };
}

// ── Effect op builders ────────────────────────────────────────

export function buildAddEffectOps(
  sequenceId: string,
  clipId: string,
  type: EffectType,
  currentEffectCount: number
): OpEnvelope[] {
  const effect = createEffect(type, currentEffectCount);
  return [makeOp('clip.addEffect', { sequenceId, clipId, effect }, 'user')];
}

export function buildRemoveEffectOps(
  sequenceId: string,
  clipId: string,
  effectId: string
): OpEnvelope[] {
  return [makeOp('clip.removeEffect', { sequenceId, clipId, effectId }, 'user')];
}

export function buildToggleEffectOps(
  sequenceId: string,
  clipId: string,
  effectId: string,
  enabled: boolean
): OpEnvelope[] {
  return [makeOp('clip.setEffect', { sequenceId, clipId, effectId, props: { enabled } }, 'user')];
}

export function buildSetEffectParamOps(
  sequenceId: string,
  clipId: string,
  effectId: string,
  paramKey: string,
  value: number | string | boolean
): OpEnvelope[] {
  return [makeOp('clip.setEffect', {
    sequenceId,
    clipId,
    effectId,
    props: { params: undefined }, // handled specially
  }, 'user')];
  // Note: actual param update uses clip.setEffect with merged params
}

export function buildSetEffectParamsOps(
  sequenceId: string,
  clipId: string,
  effectId: string,
  params: Record<string, number | string | boolean>
): OpEnvelope[] {
  return [makeOp('clip.setEffect', {
    sequenceId,
    clipId,
    effectId,
    props: { params },
  }, 'user')];
}

export function buildReorderEffectOps(
  sequenceId: string,
  clipId: string,
  effectId: string,
  newOrder: number
): OpEnvelope[] {
  return [makeOp('clip.reorderEffect', { sequenceId, clipId, effectId, newOrder }, 'user')];
}

// ── Effect evaluation ─────────────────────────────────────────

/**
 * Evaluate effect params at a given time (for keyframed effects).
 * Returns resolved param values.
 */
export function evaluateEffectParams(
  effect: Effect,
  clip: import('./schema').Clip,
  clipLocalTime: import('./time').RationalTime
): Record<string, number | string | boolean> {
  const resolved: Record<string, number | string | boolean> = { ...effect.params };
  const def = EFFECT_DEFINITIONS[effect.type as EffectType];
  if (!def) return resolved;

  // Import inline to avoid circular dependency
  const { evaluateKeyframedProperty } = require('./keyframes') as typeof import('./keyframes');

  for (const paramDef of def.paramDefs) {
    if (paramDef.keyframeEligible && typeof resolved[paramDef.key] === 'number') {
      const propKey = `effect.${effect.id}.${paramDef.key}`;
      resolved[paramDef.key] = evaluateKeyframedProperty(
        clip, propKey, clipLocalTime, resolved[paramDef.key] as number
      );
    }
  }
  return resolved;
}
