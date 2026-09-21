/**
 * CutLab MotionDocument — Canonical Motion Layer
 * Lives inside ProjectData.motionDocuments[id].
 * Edited by both Studio (via canonical ops) and Motion Animator.
 * NO separate project, NO separate timeline, NO separate history.
 * Studio sequence time is authoritative; Motion receives clip-local time.
 */

import type { RationalTime } from './time';
import { generateId } from './schema';

// ── MotionObject types ────────────────────────────────────────

export type MotionObjectKind =
  | 'text' | 'text-segment' | 'shape' | 'svg' | 'group' |'image' | 'video' | 'camera' | 'null-object';

export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' |'color-dodge'| 'color-burn' | 'hard-light' | 'soft-light' |'difference' | 'exclusion' | 'add';

export interface MotionTransform {
  x: number;
  y: number;
  z: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  anchorX: number;
  anchorY: number;
  anchorZ: number;
  opacity: number;
}

export const DEFAULT_MOTION_TRANSFORM: MotionTransform = {
  x: 0, y: 0, z: 0,
  scaleX: 1, scaleY: 1, scaleZ: 1,
  rotationX: 0, rotationY: 0, rotationZ: 0,
  anchorX: 0, anchorY: 0, anchorZ: 0,
  opacity: 1,
};

export type MotionEasingType = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold' | 'bezier' | 'spring' | 'bounce' | 'elastic';

export interface MotionKeyframe {
  id: string;
  time: RationalTime; // clip-local time
  property: string;
  value: number | string | boolean | number[];
  easing: MotionEasingType;
  /** Bezier handles [in_x, in_y, out_x, out_y] */
  bezierHandles?: [number, number, number, number];
  /** Spring/elastic params */
  easingParams?: { tension?: number; friction?: number; amplitude?: number };
}

export interface MotionMask {
  id: string;
  shape: 'rectangle' | 'ellipse' | 'path';
  pathData?: string; // SVG path for 'path' shape
  x: number;
  y: number;
  width: number;
  height: number;
  feather: number;
  invert: boolean;
  rotation: number;
  opacity: number;
}

export interface MotionMaterial {
  id: string;
  name: string;
  type: 'solid' | 'gradient' | 'image' | 'neon' | 'glass' | 'shadow' | 'projector';
  color?: string;
  gradientStops?: Array<{ offset: number; color: string }>;
  gradientAngle?: number;
  /** Asset ref for image material */
  assetRef?: string;
  /** Neon glow params */
  neonColor?: string;
  neonBlur?: number;
  neonIntensity?: number;
  /** Shadow params */
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  /** Glass blur */
  glassBlur?: number;
  glassOpacity?: number;
}

export interface MotionTextSegment {
  id: string;
  text: string;
  startTime: RationalTime;
  endTime: RationalTime;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  materialId?: string;
  /** Per-segment keyframes */
  keyframes?: MotionKeyframe[];
}

// ── Canonical Behavior Types ──────────────────────────────────

export type MotionBehaviorType =
  | 'fade-in' | 'fade-out' |'slide-in'| 'slide-out' |'scale-in'| 'scale-out' |'wipe-in'| 'wipe-out' |'blur-in'| 'blur-out' |'bounce-in' |'typewriter'| 'word-by-word' | 'char-by-char' |'wave'| 'shake' | 'pulse' | 'spin' |'signal-reactive' |'custom';

/**
 * Canonical MotionBehavior — stored directly on MotionObject.behaviors[].
 * NOT in graphicParams._behaviors.
 * Survives undo/redo/save/reopen/export.
 */
export interface MotionBehavior {
  id: string;
  type: MotionBehaviorType;
  /** Clip-local start time */
  startTime: RationalTime;
  /** Duration of the behavior */
  duration: RationalTime;
  /** Behavior parameters (direction, distance, amplitude, etc.) */
  params: Record<string, number | string | boolean>;
  /** Signal binding — which signal id drives this behavior's intensity */
  signalBinding?: string;
  /** Easing for the behavior envelope */
  easing?: MotionEasingType;
}

export interface MotionObject {
  id: string;
  kind: MotionObjectKind;
  name: string;
  parentId?: string; // for groups
  /** Depth / z-order */
  depth: number;
  transform: MotionTransform;
  keyframes: MotionKeyframe[];
  /** Canonical behaviors — NOT graphicParams._behaviors */
  behaviors: MotionBehavior[];
  masks: MotionMask[];
  blendMode: BlendMode;
  visible: boolean;
  solo: boolean;
  locked: boolean;
  /** Material reference */
  materialId?: string;
  /** For text objects */
  text?: string;
  textSegments?: MotionTextSegment[];
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  textAlign?: 'left' | 'center' | 'right';
  lineHeight?: number;
  letterSpacing?: number;
  /** For shape objects */
  shapeType?: 'rectangle' | 'ellipse' | 'polygon' | 'star' | 'line' | 'path';
  shapePath?: string; // SVG path data
  shapeCornerRadius?: number;
  shapeStrokeWidth?: number;
  shapeStrokeColor?: string;
  shapeFillColor?: string;
  /** For SVG objects */
  svgData?: string;
  /** For image/video objects — resolves through canonical Studio asset system */
  assetRef?: string; // asset.id in ProjectData.assets
  /** For video objects — local time mapping */
  videoTimeOffset?: number;
  videoSpeed?: number;
  /** Camera properties */
  cameraFov?: number;
  cameraNear?: number;
  cameraFar?: number;
  /** Procedural treatments */
  proceduralType?: 'noise' | 'gradient-wipe' | 'particle' | 'wave' | 'ripple';
  proceduralParams?: Record<string, number | string | boolean>;
  /** Children (for groups) */
  childIds?: string[];
  /** Signals binding: property → signal id */
  signalBindings?: Record<string, string>;
  /**
   * @deprecated Legacy compat only — DO NOT write new data here.
   * Loaded from old saves and migrated to behaviors[] on first read.
   */
  graphicParams?: Record<string, unknown>;
}

// ── MotionDocument ────────────────────────────────────────────

export interface MotionCamera {
  id: string;
  name: string;
  transform: MotionTransform;
  fov: number;
  near: number;
  far: number;
  keyframes: MotionKeyframe[];
  active: boolean;
}

export interface MotionSignal {
  id: string;
  name: string;
  type: 'number' | 'string' | 'boolean' | 'color';
  defaultValue: number | string | boolean;
  /** Current driven value (runtime only, not persisted) */
  currentValue?: number | string | boolean;
  /** Expression driving this signal */
  expression?: string;
}

export interface MotionDocument {
  id: string;
  name: string;
  /** Duration in clip-local time */
  duration: RationalTime;
  /** Frame rate (matches sequence or overridden) */
  fps: number;
  /** Canvas size */
  width: number;
  height: number;
  /** All objects, keyed by id */
  objects: Record<string, MotionObject>;
  /** Root-level object order (depth-sorted) */
  rootObjectIds: string[];
  /** Materials library */
  materials: Record<string, MotionMaterial>;
  /** Cameras */
  cameras: Record<string, MotionCamera>;
  activeCameraId?: string;
  /** Signals */
  signals: Record<string, MotionSignal>;
  /** Background color */
  backgroundColor?: string;
  /** Created/updated */
  createdAt: number;
  updatedAt: number;
}

// ── MotionOp types ────────────────────────────────────────────

export type MotionOpType =
  | 'motion.object.add' |'motion.object.remove' |'motion.object.setProps' |'motion.object.setTransform' |'motion.object.reorder' |'motion.object.reparent' |'motion.keyframe.upsert' |'motion.keyframe.remove' |'motion.keyframe.move' |'motion.keyframe.setEasing' |'motion.behavior.upsert' |'motion.behavior.remove' |'motion.material.upsert' |'motion.material.remove' |'motion.camera.upsert' |'motion.camera.remove' |'motion.camera.setActive' |'motion.signal.upsert' |'motion.signal.remove' |'motion.document.setProps' |'motion.mask.upsert' |'motion.mask.remove' |'motion.textSegment.upsert' |'motion.textSegment.remove';

export interface MotionOp {
  type: MotionOpType;
  documentId: string;
  payload: Record<string, unknown>;
}

export interface MotionTransaction {
  ops: MotionOp[];
  description: string;
}

// ── Migration: graphicParams._behaviors → canonical behaviors[] ──

/**
 * Migrate a MotionObject from legacy graphicParams._behaviors to canonical behaviors[].
 * Called on load. After migration, graphicParams._behaviors is removed.
 */
export function migrateObjectBehaviors(obj: MotionObject): MotionObject {
  if (!obj.graphicParams?.['_behaviors']) return obj;

  let legacyBehaviors: Array<Record<string, unknown>> = [];
  try {
    legacyBehaviors = JSON.parse(obj.graphicParams['_behaviors'] as string);
  } catch {
    legacyBehaviors = [];
  }

  const canonicalBehaviors: MotionBehavior[] = legacyBehaviors.map((b) => ({
    id: (b.id as string) ?? generateId('mbhv'),
    type: (b.type as MotionBehaviorType) ?? 'fade-in',
    startTime: (b.startTime as RationalTime) ?? { value: 0, timescale: 30000 },
    duration: (b.duration as RationalTime) ?? { value: 30000, timescale: 30000 },
    params: (b.params as Record<string, number | string | boolean>) ?? {},
    signalBinding: b.signalBinding as string | undefined,
    easing: (b.easing as MotionEasingType) ?? 'ease-out',
  }));

  // Merge with any existing canonical behaviors (avoid duplicates by id)
  const existingIds = new Set((obj.behaviors ?? []).map((b) => b.id));
  const merged = [
    ...(obj.behaviors ?? []),
    ...canonicalBehaviors.filter((b) => !existingIds.has(b.id)),
  ];

  const { _behaviors: _removed, ...restGraphicParams } = obj.graphicParams;
  const cleanedGraphicParams = Object.keys(restGraphicParams).length > 0 ? restGraphicParams : undefined;

  return {
    ...obj,
    behaviors: merged,
    graphicParams: cleanedGraphicParams,
  };
}

/**
 * Migrate all objects in a MotionDocument from legacy behavior storage.
 */
export function migrateDocumentBehaviors(doc: MotionDocument): MotionDocument {
  let changed = false;
  const newObjects: Record<string, MotionObject> = {};
  for (const [id, obj] of Object.entries(doc.objects)) {
    const migrated = migrateObjectBehaviors(obj);
    newObjects[id] = migrated;
    if (migrated !== obj) changed = true;
  }
  if (!changed) return doc;
  return { ...doc, objects: newObjects };
}

// ── Apply MotionOp to MotionDocument ─────────────────────────

export function applyMotionOp(doc: MotionDocument, op: MotionOp): MotionDocument {
  const p = op.payload as any;
  const normalizedType = normalizeMotionOpType(op.type);

  switch (normalizedType) {
    case 'motion.object.add': {
      const rawObj = p.object as MotionObject;
      // Ensure behaviors array exists and migrate if needed
      const obj: MotionObject = {
        ...rawObj,
        behaviors: rawObj.behaviors ?? [],
      };
      const migratedObj = migrateObjectBehaviors(obj);
      const newDoc = {
        ...doc,
        objects: { ...doc.objects, [migratedObj.id]: migratedObj },
        rootObjectIds: migratedObj.parentId
          ? doc.rootObjectIds
          : [...doc.rootObjectIds, migratedObj.id],
      };
      // If has parent, add to parent's childIds
      if (migratedObj.parentId && doc.objects[migratedObj.parentId]) {
        const parent = doc.objects[migratedObj.parentId];
        newDoc.objects[migratedObj.parentId] = {
          ...parent,
          childIds: [...(parent.childIds ?? []), migratedObj.id],
        };
      }
      return newDoc;
    }
    case 'motion.object.remove': {
      const { [p.objectId]: removed, ...restObjects } = doc.objects;
      return {
        ...doc,
        objects: restObjects,
        rootObjectIds: doc.rootObjectIds.filter((id) => id !== p.objectId),
      };
    }
    case 'motion.object.setProps': {
      const existing = doc.objects[p.objectId];
      if (!existing) return doc;
      return {
        ...doc,
        objects: { ...doc.objects, [p.objectId]: { ...existing, ...p.props } },
      };
    }
    case 'motion.object.setTransform': {
      const existing = doc.objects[p.objectId];
      if (!existing) return doc;
      return {
        ...doc,
        objects: {
          ...doc.objects,
          [p.objectId]: { ...existing, transform: { ...existing.transform, ...p.transform } },
        },
      };
    }
    case 'motion.object.reorder': {
      const ids = [...doc.rootObjectIds];
      const idx = ids.indexOf(p.objectId);
      if (idx < 0) return doc;
      ids.splice(idx, 1);
      ids.splice(p.newIndex, 0, p.objectId);
      return { ...doc, rootObjectIds: ids };
    }
    case 'motion.keyframe.upsert': {
      const obj = doc.objects[p.objectId];
      if (!obj) return doc;
      const existing = obj.keyframes.findIndex((k) => k.id === p.keyframe.id);
      let newKfs: MotionKeyframe[];
      if (existing >= 0) {
        newKfs = [...obj.keyframes];
        newKfs[existing] = p.keyframe;
      } else {
        newKfs = [...obj.keyframes, p.keyframe];
      }
      return {
        ...doc,
        objects: { ...doc.objects, [p.objectId]: { ...obj, keyframes: newKfs } },
      };
    }
    case 'motion.keyframe.remove': {
      const obj = doc.objects[p.objectId];
      if (!obj) return doc;
      return {
        ...doc,
        objects: {
          ...doc.objects,
          [p.objectId]: { ...obj, keyframes: obj.keyframes.filter((k) => k.id !== p.keyframeId) },
        },
      };
    }
    case 'motion.keyframe.move': {
      const obj = doc.objects[p.objectId];
      if (!obj) return doc;
      return {
        ...doc,
        objects: {
          ...doc.objects,
          [p.objectId]: {
            ...obj,
            keyframes: obj.keyframes.map((k) =>
              k.id === p.keyframeId ? { ...k, time: p.newTime } : k
            ),
          },
        },
      };
    }
    case 'motion.keyframe.setEasing': {
      const obj = doc.objects[p.objectId];
      if (!obj) return doc;
      return {
        ...doc,
        objects: {
          ...doc.objects,
          [p.objectId]: {
            ...obj,
            keyframes: obj.keyframes.map((k) =>
              k.id === p.keyframeId ? { ...k, easing: p.easing, bezierHandles: p.bezierHandles } : k
            ),
          },
        },
      };
    }
    case 'motion.behavior.upsert': {
      const obj = doc.objects[p.objectId];
      if (!obj) return doc;
      const behaviors = obj.behaviors ?? [];
      const existingIdx = behaviors.findIndex((b) => b.id === p.behavior.id);
      let newBehaviors: MotionBehavior[];
      if (existingIdx >= 0) {
        newBehaviors = [...behaviors];
        newBehaviors[existingIdx] = p.behavior;
      } else {
        newBehaviors = [...behaviors, p.behavior];
      }
      return {
        ...doc,
        objects: { ...doc.objects, [p.objectId]: { ...obj, behaviors: newBehaviors } },
      };
    }
    case 'motion.behavior.remove': {
      const obj = doc.objects[p.objectId];
      if (!obj) return doc;
      return {
        ...doc,
        objects: {
          ...doc.objects,
          [p.objectId]: {
            ...obj,
            behaviors: (obj.behaviors ?? []).filter((b) => b.id !== p.behaviorId),
          },
        },
      };
    }
    case 'motion.material.upsert': {
      return {
        ...doc,
        materials: { ...doc.materials, [p.material.id]: p.material },
      };
    }
    case 'motion.material.remove': {
      const { [p.materialId]: _rm, ...rest } = doc.materials;
      return { ...doc, materials: rest };
    }
    case 'motion.camera.upsert': {
      return {
        ...doc,
        cameras: { ...doc.cameras, [p.camera.id]: p.camera },
      };
    }
    case 'motion.camera.remove': {
      const { [p.cameraId]: _rm, ...rest } = doc.cameras;
      return { ...doc, cameras: rest };
    }
    case 'motion.camera.setActive': {
      return { ...doc, activeCameraId: p.cameraId };
    }
    case 'motion.signal.upsert': {
      return {
        ...doc,
        signals: { ...doc.signals, [p.signal.id]: p.signal },
      };
    }
    case 'motion.signal.remove': {
      const { [p.signalId]: _rm, ...rest } = doc.signals;
      return { ...doc, signals: rest };
    }
    case 'motion.document.setProps': {
      return { ...doc, ...p.props };
    }
    case 'motion.mask.upsert': {
      const obj = doc.objects[p.objectId];
      if (!obj) return doc;
      const existingIdx = obj.masks.findIndex((m) => m.id === p.mask.id);
      let newMasks: MotionMask[];
      if (existingIdx >= 0) {
        newMasks = [...obj.masks];
        newMasks[existingIdx] = p.mask;
      } else {
        newMasks = [...obj.masks, p.mask];
      }
      return {
        ...doc,
        objects: { ...doc.objects, [p.objectId]: { ...obj, masks: newMasks } },
      };
    }
    case 'motion.mask.remove': {
      const obj = doc.objects[p.objectId];
      if (!obj) return doc;
      return {
        ...doc,
        objects: {
          ...doc.objects,
          [p.objectId]: { ...obj, masks: obj.masks.filter((m) => m.id !== p.maskId) },
        },
      };
    }
    case 'motion.textSegment.upsert': {
      const obj = doc.objects[p.objectId];
      if (!obj) return doc;
      const segs = obj.textSegments ?? [];
      const existingIdx = segs.findIndex((s) => s.id === p.segment.id);
      let newSegs: MotionTextSegment[];
      if (existingIdx >= 0) {
        newSegs = [...segs];
        newSegs[existingIdx] = p.segment;
      } else {
        newSegs = [...segs, p.segment];
      }
      return {
        ...doc,
        objects: { ...doc.objects, [p.objectId]: { ...obj, textSegments: newSegs } },
      };
    }
    case 'motion.textSegment.remove': {
      const obj = doc.objects[p.objectId];
      if (!obj) return doc;
      return {
        ...doc,
        objects: {
          ...doc.objects,
          [p.objectId]: {
            ...obj,
            textSegments: (obj.textSegments ?? []).filter((s) => s.id !== p.segmentId),
          },
        },
      };
    }
    default:
      return doc;
  }
}

function normalizeMotionOpType(type: string): MotionOpType {
  const aliases: Record<string, MotionOpType> = {
    // motion/types.ts → engine/motion-document.ts
    'motion.addObject': 'motion.object.add',
    'motion.removeObject': 'motion.object.remove',
    'motion.setObjectProp': 'motion.object.setProps',
    'motion.setObjectTransform': 'motion.object.setTransform',
    'motion.reorderObjects': 'motion.object.reorder',
    'motion.upsertKeyframe': 'motion.keyframe.upsert',
    'motion.removeKeyframe': 'motion.keyframe.remove',
    'motion.setMaterial': 'motion.material.upsert',
    'motion.addMask': 'motion.mask.upsert',
    'motion.removeMask': 'motion.mask.remove',
    'motion.setMask': 'motion.mask.upsert',
    'motion.upsertSignal': 'motion.signal.upsert',
    'motion.removeSignal': 'motion.signal.remove',
    'motion.setDocumentProp': 'motion.document.setProps',
    'motion.setTextSegment': 'motion.textSegment.upsert',
    'motion.setCamera': 'motion.camera.upsert',
    'motion.upsertDocument': 'motion.document.setProps',
    // Canonical behavior ops from panels
    'motion.addBehavior': 'motion.behavior.upsert',
    'motion.removeBehavior': 'motion.behavior.remove',
    'motion.setBehaviorParam': 'motion.behavior.upsert',
    'motion.upsertBehavior': 'motion.behavior.upsert',
  };
  return (aliases[type] ?? type) as MotionOpType;
}

export function applyMotionTransaction(doc: MotionDocument, tx: MotionTransaction): MotionDocument {
  let current = doc;
  for (const op of tx.ops) {
    current = applyMotionOp(current, op);
  }
  return { ...current, updatedAt: Date.now() };
}

// ── Convert MotionTransaction → Studio canonical ops ──────────

import type { OpEnvelope } from './operations';
import { makeOp } from './operations';

/**
 * Convert a MotionTransaction into Studio canonical OpEnvelopes.
 * This is the ONE path through which Motion Animator edits enter the undo stack.
 * motionTransactionToStudioOps → dispatchBatch → one history entry → project revision
 */
export function motionTransactionToStudioOps(
  tx: MotionTransaction,
  documentId: string
): OpEnvelope[] {
  // Pack the entire transaction as a single motion.document.patch op
  // The reducer applies it atomically to the MotionDocument stored in project.motionDocuments
  return [
    makeOp(
      'motion.document.patch' as any,
      { documentId, transaction: tx },
      'user'
    ),
  ];
}

// ── Factory ───────────────────────────────────────────────────

export function createMotionDocument(
  name: string,
  duration: RationalTime,
  fps: number,
  width = 1920,
  height = 1080
): MotionDocument {
  const now = Date.now();
  return {
    id: generateId('mdoc'),
    name,
    duration,
    fps,
    width,
    height,
    objects: {},
    rootObjectIds: [],
    materials: {},
    cameras: {},
    signals: {},
    backgroundColor: '#000000',
    createdAt: now,
    updatedAt: now,
  };
}

// ── Keyframe evaluation ───────────────────────────────────────

import { toSeconds } from './time';

/**
 * Evaluate a MotionObject property at a given clip-local time.
 * Returns the interpolated value.
 */
export function evaluateMotionProperty(
  keyframes: MotionKeyframe[],
  property: string,
  localTimeSecs: number,
  defaultValue: number
): number {
  const kfs = keyframes
    .filter((k) => k.property === property)
    .sort((a, b) => toSeconds(a.time) - toSeconds(b.time));

  if (kfs.length === 0) return defaultValue;
  if (kfs.length === 1) return kfs[0].value as number;

  let t = localTimeSecs;
  const first = kfs[0];
  const last = kfs[kfs.length - 1];

  if (t <= toSeconds(first.time)) return first.value as number;
  if (t >= toSeconds(last.time)) return last.value as number;

  // Find surrounding keyframes
  let kfA = first;
  let kfB = last;
  for (let i = 0; i < kfs.length - 1; i++) {
    if (t >= toSeconds(kfs[i].time) && t <= toSeconds(kfs[i + 1].time)) {
      kfA = kfs[i];
      kfB = kfs[i + 1];
      break;
    }
  }

  const tA = toSeconds(kfA.time);
  const tB = toSeconds(kfB.time);
  const alpha = tB > tA ? (t - tA) / (tB - tA) : 0;
  const vA = kfA.value as number;
  const vB = kfB.value as number;

  return applyEasingInterp(alpha, kfA.easing, kfA.easingParams, vA, vB);
}

function applyEasingInterp(
  alpha: number,
  easing: MotionEasingType,
  params: MotionKeyframe['easingParams'] | undefined,
  vA: number,
  vB: number
): number {
  switch (easing) {
    case 'hold': return vA;
    case 'ease-in': return vA + (vB - vA) * (alpha * alpha);
    case 'ease-out': return vA + (vB - vA) * (1 - (1 - alpha) * (1 - alpha));
    case 'ease-in-out': {
      const a = alpha < 0.5 ? 2 * alpha * alpha : 1 - 2 * (1 - alpha) * (1 - alpha);
      return vA + (vB - vA) * a;
    }
    case 'spring': {
      const tension = params?.tension ?? 170;
      const friction = params?.friction ?? 26;
      const omega = Math.sqrt(tension);
      const zeta = friction / (2 * Math.sqrt(tension));
      let easedAlpha = alpha;
      if (zeta < 1) {
        const omegaD = omega * Math.sqrt(1 - zeta * zeta);
        easedAlpha = 1 - Math.exp(-zeta * omega * alpha) * (Math.cos(omegaD * alpha) + (zeta * omega / omegaD) * Math.sin(omegaD * alpha));
      }
      return vA + (vB - vA) * easedAlpha;
    }
    case 'bounce': {
      let t = alpha;
      if (t < 1 / 2.75) t = 7.5625 * t * t;
      else if (t < 2 / 2.75) { const tt = t - 1.5 / 2.75; t = 7.5625 * tt * tt + 0.75; }
      else if (t < 2.5 / 2.75) { const tt = t - 2.25 / 2.75; t = 7.5625 * tt * tt + 0.9375; }
      else { const tt = t - 2.625 / 2.75; t = 7.5625 * tt * tt + 0.984375; }
      return vA + (vB - vA) * t;
    }
    case 'elastic': {
      const amplitude = params?.amplitude ?? 1;
      if (alpha === 0 || alpha === 1) return alpha === 0 ? vA : vB;
      const p = 0.3;
      const s = p / 4;
      let easedAlpha = amplitude * Math.pow(2, -10 * alpha) * Math.sin((alpha - s) * (2 * Math.PI) / p) + 1;
      return vA + (vB - vA) * easedAlpha;
    }
    case 'bezier': {
      // Simple cubic bezier approximation using bezierHandles
      return vA + (vB - vA) * alpha;
    }
    default: return vA + (vB - vA) * alpha; // linear
  }
}

// ── Behavior Evaluation ───────────────────────────────────────

/**
 * Apply canonical behaviors to a MotionTransform at clip-local time.
 * Ported from motion/evaluate.ts applyBehaviors — same semantics.
 * signalValues: signal id → current numeric value (0..1 or raw)
 */
export function applyMotionBehaviors(
  behaviors: MotionBehavior[],
  transform: MotionTransform,
  localTimeSecs: number,
  signalValues: Record<string, number>
): MotionTransform {
  let result = { ...transform };

  for (const behavior of behaviors) {
    const bStart = toSeconds(behavior.startTime);
    const bDur = toSeconds(behavior.duration);
    const bEnd = bStart + bDur;

    if (localTimeSecs < bStart || localTimeSecs > bEnd) continue;

    const bTau = bDur > 0 ? (localTimeSecs - bStart) / bDur : 0;
    const easedTau = applyEasingInterp(Math.max(0, Math.min(1, bTau)), behavior.easing ?? 'ease-out', undefined, 0, 1);

    // Get signal value if bound (default 1 = full intensity)
    const signalValue = behavior.signalBinding
      ? (signalValues[behavior.signalBinding] ?? 1)
      : 1;

    switch (behavior.type) {
      case 'fade-in':
        result = { ...result, opacity: result.opacity * easedTau * signalValue };
        break;
      case 'fade-out':
        result = { ...result, opacity: result.opacity * (1 - easedTau) * signalValue };
        break;
      case 'slide-in': {
        const dir = (behavior.params.direction as string) ?? 'bottom';
        const dist = (behavior.params.distance as number) ?? 60;
        const progress = 1 - easedTau;
        if (dir === 'bottom') result = { ...result, y: result.y + dist * progress };
        else if (dir === 'top') result = { ...result, y: result.y - dist * progress };
        else if (dir === 'left') result = { ...result, x: result.x - dist * progress };
        else if (dir === 'right') result = { ...result, x: result.x + dist * progress };
        break;
      }
      case 'slide-out': {
        const dir = (behavior.params.direction as string) ?? 'bottom';
        const dist = (behavior.params.distance as number) ?? 60;
        if (dir === 'bottom') result = { ...result, y: result.y + dist * easedTau };
        else if (dir === 'top') result = { ...result, y: result.y - dist * easedTau };
        else if (dir === 'left') result = { ...result, x: result.x - dist * easedTau };
        else if (dir === 'right') result = { ...result, x: result.x + dist * easedTau };
        break;
      }
      case 'scale-in': {
        const fromScale = (behavior.params.fromScale as number) ?? 0;
        const scaleVal = fromScale + (1 - fromScale) * easedTau;
        result = { ...result, scaleX: result.scaleX * scaleVal, scaleY: result.scaleY * scaleVal };
        break;
      }
      case 'scale-out': {
        const toScale = (behavior.params.toScale as number) ?? 0;
        const scaleVal = 1 - (1 - toScale) * easedTau;
        result = { ...result, scaleX: result.scaleX * scaleVal, scaleY: result.scaleY * scaleVal };
        break;
      }
      case 'pulse': {
        const amplitude = (behavior.params.amplitude as number) ?? 0.1;
        const freq = (behavior.params.frequency as number) ?? 2;
        const pulse = 1 + amplitude * Math.sin(localTimeSecs * freq * Math.PI * 2) * signalValue;
        result = { ...result, scaleX: result.scaleX * pulse, scaleY: result.scaleY * pulse };
        break;
      }
      case 'shake': {
        const amplitude = (behavior.params.amplitude as number) ?? 5;
        const freq = (behavior.params.frequency as number) ?? 10;
        const shakeX = amplitude * Math.sin(localTimeSecs * freq * Math.PI * 2) * signalValue;
        const shakeY = amplitude * Math.cos(localTimeSecs * freq * Math.PI * 2 * 1.3) * signalValue;
        result = { ...result, x: result.x + shakeX, y: result.y + shakeY };
        break;
      }
      case 'spin': {
        const speed = (behavior.params.speed as number) ?? 360;
        result = { ...result, rotationZ: result.rotationZ + speed * localTimeSecs };
        break;
      }
      case 'wave': {
        const amplitude = (behavior.params.amplitude as number) ?? 10;
        const freq = (behavior.params.frequency as number) ?? 3;
        result = { ...result, y: result.y + amplitude * Math.sin(localTimeSecs * freq * Math.PI * 2) * signalValue };
        break;
      }
      case 'signal-reactive': {
        const prop = (behavior.params.property as string) ?? 'scaleX';
        const min = (behavior.params.min as number) ?? 0.8;
        const max = (behavior.params.max as number) ?? 1.2;
        const reactiveVal = min + (max - min) * signalValue;
        if (prop === 'scaleX' || prop === 'scale.x') result = { ...result, scaleX: result.scaleX * reactiveVal };
        else if (prop === 'scaleY' || prop === 'scale.y') result = { ...result, scaleY: result.scaleY * reactiveVal };
        else if (prop === 'opacity') result = { ...result, opacity: result.opacity * reactiveVal };
        else if (prop === 'rotationZ' || prop === 'rotation.z') result = { ...result, rotationZ: result.rotationZ + reactiveVal };
        break;
      }
      case 'bounce-in': {
        // Bounce scale-in
        let t = easedTau;
        if (t < 1 / 2.75) t = 7.5625 * t * t;
        else if (t < 2 / 2.75) { const tt = t - 1.5 / 2.75; t = 7.5625 * tt * tt + 0.75; }
        else if (t < 2.5 / 2.75) { const tt = t - 2.25 / 2.75; t = 7.5625 * tt * tt + 0.9375; }
        else { const tt = t - 2.625 / 2.75; t = 7.5625 * tt * tt + 0.984375; }
        result = { ...result, scaleX: result.scaleX * t, scaleY: result.scaleY * t };
        break;
      }
    }
  }

  return result;
}

// ── Signal Evaluation ─────────────────────────────────────────

/**
 * Evaluate signal bindings on a MotionObject.
 * signalBindings: property → signal id
 * signalValues: signal id → current value
 * Returns a partial transform override from signal-driven properties.
 */
export function applySignalBindings(
  obj: MotionObject,
  transform: MotionTransform,
  signalValues: Record<string, number>
): MotionTransform {
  if (!obj.signalBindings || Object.keys(obj.signalBindings).length === 0) return transform;

  let result = { ...transform };
  for (const [prop, signalId] of Object.entries(obj.signalBindings)) {
    const val = signalValues[signalId];
    if (val === undefined) continue;
    switch (prop) {
      case 'x': result = { ...result, x: val }; break;
      case 'y': result = { ...result, y: val }; break;
      case 'z': result = { ...result, z: val }; break;
      case 'scaleX': result = { ...result, scaleX: val }; break;
      case 'scaleY': result = { ...result, scaleY: val }; break;
      case 'rotationZ': result = { ...result, rotationZ: val }; break;
      case 'opacity': result = { ...result, opacity: Math.max(0, Math.min(1, val)) }; break;
    }
  }
  return result;
}

/**
 * Evaluate all transform properties of a MotionObject at clip-local time.
 * Combines: base transform + keyframes + behaviors + signal bindings.
 */
export function evaluateMotionTransform(
  obj: MotionObject,
  localTimeSecs: number,
  signalValues: Record<string, number> = {}
): MotionTransform {
  const kfs = obj.keyframes;
  const base = obj.transform;

  // Step 1: evaluate keyframes
  let result: MotionTransform = {
    x: evaluateMotionProperty(kfs, 'x', localTimeSecs, base.x),
    y: evaluateMotionProperty(kfs, 'y', localTimeSecs, base.y),
    z: evaluateMotionProperty(kfs, 'z', localTimeSecs, base.z),
    scaleX: evaluateMotionProperty(kfs, 'scaleX', localTimeSecs, base.scaleX),
    scaleY: evaluateMotionProperty(kfs, 'scaleY', localTimeSecs, base.scaleY),
    scaleZ: evaluateMotionProperty(kfs, 'scaleZ', localTimeSecs, base.scaleZ),
    rotationX: evaluateMotionProperty(kfs, 'rotationX', localTimeSecs, base.rotationX),
    rotationY: evaluateMotionProperty(kfs, 'rotationY', localTimeSecs, base.rotationY),
    rotationZ: evaluateMotionProperty(kfs, 'rotationZ', localTimeSecs, base.rotationZ),
    anchorX: evaluateMotionProperty(kfs, 'anchorX', localTimeSecs, base.anchorX),
    anchorY: evaluateMotionProperty(kfs, 'anchorY', localTimeSecs, base.anchorY),
    anchorZ: evaluateMotionProperty(kfs, 'anchorZ', localTimeSecs, base.anchorZ),
    opacity: evaluateMotionProperty(kfs, 'opacity', localTimeSecs, base.opacity),
  };

  // Step 2: apply canonical behaviors
  if (obj.behaviors && obj.behaviors.length > 0) {
    result = applyMotionBehaviors(obj.behaviors, result, localTimeSecs, signalValues);
  }

  // Step 3: apply signal bindings (direct property override)
  if (obj.signalBindings && Object.keys(obj.signalBindings).length > 0) {
    result = applySignalBindings(obj, result, signalValues);
  }

  return result;
}

/**
 * Evaluate signal values from a MotionDocument's signals at a given time.
 * Returns a map of signal id → numeric value.
 */
export function evaluateSignals(
  doc: MotionDocument,
  _localTimeSecs: number
): Record<string, number> {
  let result: Record<string, number> = {};
  for (const [id, sig] of Object.entries(doc.signals)) {
    const val = sig.currentValue ?? sig.defaultValue;
    if (typeof val === 'number') result[id] = val;
    else if (typeof val === 'boolean') result[id] = val ? 1 : 0;
  }
  return result;
}
