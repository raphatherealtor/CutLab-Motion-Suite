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
import { evaluateMotionTransform, evaluateSignals } from './motion-document';
import { toSeconds } from './time';
import { generateId } from './schema';
import { resolveMotionDocument as bridgeResolveMotionDocument } from './motion-bridge';

// Re-export canonical types for workspace use
export type { MotionBehavior, MotionMaterial };

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
