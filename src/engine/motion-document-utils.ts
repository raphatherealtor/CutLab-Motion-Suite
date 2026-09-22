/**
 * CutLab Motion Document Utils
 * Bridge utilities for MotionAnimatorWorkspace.
 * Provides helpers that work with both motion/types.ts and engine/motion-document.ts.
 *
 * The makeOp helper here creates MotionOps (not Studio OpEnvelopes).
 * These are collected by MotionAnimatorWorkspace and committed via applyOps → motionTransactionToStudioOps.
 */

import type { ProjectData, Clip } from './schema';
import type { MotionDocument, MotionObject, MotionTransaction, MotionOp, MotionBehavior, MotionMaterial } from './motion-document';
import { createMotionDocument, evaluateMotionTransform, evaluateSignals } from './motion-document';
import { toSeconds } from './time';
import { generateId } from './schema';
import { resolveMotionDocument as bridgeResolveMotionDocument } from './motion-bridge';

// Re-export canonical types for workspace use
export type { MotionBehavior, MotionMaterial };

// ── Legacy → canonical document conversion ────────────────────

/**
 * Convert a legacy motion/types.ts MotionDocument into the canonical
 * engine/motion-document.ts MotionDocument.
 *
 * This is the ONE seam where legacy Motion Suite documents enter the
 * canonical project (ProjectData.motionDocuments). After conversion the
 * document is indistinguishable from one created natively — same ID,
 * same undo path, same evaluation path.
 */
export function convertLegacyDocumentToEngine(
  regDoc: import('@/motion/types').MotionDocument
): MotionDocument {
  const engineDoc = createMotionDocument(
    regDoc.name,
    secondsToMotionTime(motionTimeToSeconds(regDoc.duration)),
    regDoc.fps,
    regDoc.width,
    regDoc.height
  );
  engineDoc.id = regDoc.id;
  engineDoc.createdAt = regDoc.createdAt;
  engineDoc.updatedAt = regDoc.updatedAt;
  if (regDoc.templateId) engineDoc.templateId = regDoc.templateId;
  if (regDoc.templateParams) engineDoc.templateParams = regDoc.templateParams;

  const mapKind = (kind: string): MotionObject['kind'] => {
    const map: Record<string, MotionObject['kind']> = {
      text: 'text',
      shape: 'shape',
      image: 'image',
      video: 'video',
      group: 'group',
      camera: 'camera',
      light: 'null-object',
      particle: 'shape',
      path: 'shape',
      mask: 'shape',
      null: 'null-object',
      svg: 'svg',
    };
    return map[kind] ?? 'shape';
  };

  for (const [objId, regObj] of Object.entries(regDoc.objects)) {
    const transform = regObj.transform;
    engineDoc.objects[objId] = {
      id: regObj.id,
      kind: mapKind(regObj.kind),
      name: regObj.name,
      parentId: regObj.parentId,
      depth: regObj.depth,
      transform: {
        x: transform.position?.x ?? 0,
        y: transform.position?.y ?? 0,
        z: transform.position?.z ?? 0,
        scaleX: transform.scale?.x ?? 1,
        scaleY: transform.scale?.y ?? 1,
        scaleZ: transform.scale?.z ?? 1,
        rotationX: transform.rotation?.x ?? 0,
        rotationY: transform.rotation?.y ?? 0,
        rotationZ: transform.rotation?.z ?? 0,
        anchorX: transform.anchor?.x ?? 0,
        anchorY: transform.anchor?.y ?? 0,
        anchorZ: transform.anchor?.z ?? 0,
        opacity: transform.opacity ?? 1,
      },
      keyframes: (regObj.keyframes ?? []).map((k) => ({
        id: k.id,
        time: { value: k.time.value, timescale: k.time.timescale },
        property: k.property,
        value: typeof k.value === 'object' && k.value !== null && !Array.isArray(k.value)
          ? 0
          : (k.value as number | string | boolean | number[]),
        easing: (k.easing ?? 'linear') as MotionDocument['objects'][string]['keyframes'][number]['easing'],
        easingParams: k.easingParams,
      })),
      behaviors: (regObj.behaviors ?? []).map((b) => ({
        id: b.id,
        type: (b.type ?? 'fade-in') as MotionBehavior['type'],
        startTime: { value: b.startTime.value, timescale: b.startTime.timescale },
        duration: { value: b.duration.value, timescale: b.duration.timescale },
        params: b.params ?? {},
        signalBinding: b.signalBinding,
        easing: (b.easing ?? 'ease-out') as MotionBehavior['easing'],
      })),
      masks: [],
      blendMode: (regObj.blendMode as MotionObject['blendMode']) ?? 'normal',
      visible: regObj.visible,
      solo: false,
      locked: regObj.locked,
      text: regObj.textSegments?.[0]?.text ?? (regObj.kind === 'text' ? regObj.name : undefined),
      fontSize: regObj.textSegments?.[0]?.fontSize ?? 48,
      fontFamily: regObj.textSegments?.[0]?.fontFamily ?? 'sans-serif',
      fontWeight: regObj.textSegments?.[0]?.fontWeight ?? 700,
      assetRef: regObj.assetRef,
      svgData: regObj.svgData,
      childIds: regObj.children,
    };
  }
  engineDoc.rootObjectIds = [...regDoc.rootObjectIds];

  // Signals: legacy kind → canonical type/defaultValue
  for (const [sigId, regSig] of Object.entries(regDoc.signals ?? {})) {
    engineDoc.signals[sigId] = {
      id: regSig.id,
      name: regSig.name,
      type: 'number',
      defaultValue: 0,
      expression: regSig.expression,
    };
  }

  if (regDoc.rigs) engineDoc.rigs = regDoc.rigs;
  if (regDoc.contributionTrace) engineDoc.contributionTrace = regDoc.contributionTrace;

  return engineDoc;
}

// ── Color utilities ───────────────────────────────────────────

export interface MotionColor { r: number; g: number; b: number; a: number }

export function hexToMotionColor(hex: string): MotionColor {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return { r, g, b, a: 1 };
}

export function motionColorToHex(c: MotionColor | string | undefined): string {
  if (!c) return '#ffffff';
  if (typeof c === 'string') return c;
  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`;
}

// ── Time utilities ────────────────────────────────────────────

export interface MotionRationalTime { value: number; timescale: number }

export function motionTimeToSeconds(t: MotionRationalTime | import('./time').RationalTime): number {
  return t.value / t.timescale;
}

export function secondsToMotionTime(secs: number, timescale = 30000): MotionRationalTime {
  return { value: Math.round(secs * timescale), timescale };
}

// ── ID generation ─────────────────────────────────────────────

export function generateMotionId(prefix = 'mid'): string {
  return generateId(prefix);
}

// ── Document resolution ───────────────────────────────────────

export function resolveMotionDocument(
  project: ProjectData,
  motionDocumentId: string
): MotionDocument | null {
  return bridgeResolveMotionDocument(project, motionDocumentId);
}

// ── Transaction creation ──────────────────────────────────────

/**
 * Create a MotionTransaction from an array of MotionOps.
 * The ops here are MotionOps (not Studio OpEnvelopes).
 */
export function createMotionTransaction(
  description: string,
  ops: MotionOp[]
): MotionTransaction {
  return { ops, description };
}

// ── makeOp helper for MotionAnimatorWorkspace ─────────────────

/**
 * Create a MotionOp for use in MotionAnimatorWorkspace.
 * Signature: makeOp(type, documentId, payload) → MotionOp
 *
 * Note: This is NOT the same as engine/operations makeOp.
 * This creates a MotionOp that goes into a MotionTransaction.
 */
export function makeOp(
  type: string,
  documentId: string,
  payload: Record<string, unknown>
): MotionOp {
  return {
    type: type as MotionOp['type'],
    documentId,
    payload,
  };
}

// ── Motion clip evaluation ────────────────────────────────────

export interface FrameState {
  localTimeSecs: number;
  tau: number;
  objects: MotionObjectState[];
  signalValues: Record<string, number>;
  diagnostics: {
    evaluationTimeMs: number;
    objectCount: number;
    keyframeCount: number;
    behaviorCount: number;
    signalCount: number;
    warnings: string[];
    errors: string[];
  };
}

export interface MotionObjectState {
  objectId: string;
  kind: MotionObject['kind'];
  worldTransform: import('./motion-document').MotionTransform;
  opacity: number;
  visible: boolean;
  depth: number;
  blendMode: string;
  assetRef?: string;
  svgData?: string;
  textContent?: string;
}

/**
 * Evaluate a motion clip at Studio sequence time.
 * Returns a FrameState for inspector/preview use.
 */
export function evaluateMotionClip(
  project: ProjectData,
  clip: Clip,
  sequenceTimeSecs: number,
  signalValues: Record<string, number> = {}
): FrameState | null {
  const docId = clip.motionDocumentId ?? clip.motionBundleId;
  if (!docId) return null;
  const doc = project.motionDocuments?.[docId];
  if (!doc) return null;

  const clipStartSecs = toSeconds(clip.startTime);
  const clipDurSecs = toSeconds(clip.duration);
  const localTimeSecs = Math.max(0, Math.min(clipDurSecs, sequenceTimeSecs - clipStartSecs));
  const tau = clipDurSecs > 0 ? localTimeSecs / clipDurSecs : 0;

  const startTime = performance.now();

  // Evaluate signals from doc
  const docSignalValues = { ...evaluateSignals(doc, localTimeSecs), ...signalValues };

  const objects: MotionObjectState[] = [];
  let keyframeCount = 0;
  let behaviorCount = 0;

  for (const objId of doc.rootObjectIds) {
    const obj = doc.objects[objId];
    if (!obj || !obj.visible) continue;

    const worldTransform = evaluateMotionTransform(obj, localTimeSecs, docSignalValues);
    keyframeCount += obj.keyframes?.length ?? 0;
    behaviorCount += obj.behaviors?.length ?? 0;

    objects.push({
      objectId: obj.id,
      kind: obj.kind,
      worldTransform,
      opacity: worldTransform.opacity,
      visible: obj.visible,
      depth: obj.depth,
      blendMode: obj.blendMode,
      assetRef: obj.assetRef,
      svgData: obj.svgData,
      textContent: obj.text,
    });
  }

  return {
    localTimeSecs,
    tau,
    objects,
    signalValues: docSignalValues,
    diagnostics: {
      evaluationTimeMs: performance.now() - startTime,
      objectCount: objects.length,
      keyframeCount,
      behaviorCount,
      signalCount: Object.keys(docSignalValues).length,
      warnings: [],
      errors: [],
    },
  };
}
