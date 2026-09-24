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
 * Legacy signal kind → canonical Studio analysis channel id.
 * Signals created by the Motion Suite panels (and legacy docs) carry their
 * channel identity in `kind` (e.g. 'audio-beat'); the Studio analysis
 * contract delivers values keyed by channel id (e.g. 'audio.beat').
 * This map is the ONE translation point between the two identities.
 */
export const SIGNAL_KIND_TO_CHANNEL: Record<string, string> = {
  'audio-rms': 'audio.rms',
  'audio-low': 'audio.low',
  'audio-mid': 'audio.mid',
  'audio-high': 'audio.high',
  'audio-beat': 'audio.beat',
  'audio-onset': 'audio.onset',
  'audio-transient': 'audio.transient',
  'audio-tempo': 'audio.tempo',
  'speech-timing': 'speech.active_word',
  'semantic-emphasis': 'speech.emphasis',
  'cue': 'timeline.cue',
  'marker': 'timeline.marker',
};

/**
 * Evaluate a whole MotionDocument at clip-local time (no Studio clip required).
 * Used by the AI Creative Operator preview and any document-level inspection.
 * Returns a FrameState for preview/inspector use.
 */
export function evaluateMotionDocument(
  doc: MotionDocument,
  localTimeSecs: number,
  signalValues: Record<string, number> = {}
): FrameState {
  const durationSecs = motionTimeToSeconds(doc.duration);
  const clampedSecs = Math.max(0, Math.min(durationSecs, localTimeSecs));
  const tau = durationSecs > 0 ? clampedSecs / durationSecs : 0;

  const startTime = performance.now();

  // Evaluate signals from doc, then overlay Studio-provided channel values.
  const docSignalValues = { ...evaluateSignals(doc, clampedSecs), ...signalValues };

  // Bridge signal identity: behaviors bind by SIGNAL ID, but Studio delivers
  // values by CHANNEL id. Alias each signal's value to its own id so
  // signal-reactive behaviors actually react to the analysis contract.
  for (const sig of Object.values(doc.signals ?? {})) {
    if (!sig.kind) continue;
    const channelId = SIGNAL_KIND_TO_CHANNEL[sig.kind];
    if (channelId && signalValues[channelId] !== undefined) {
      docSignalValues[sig.id] = signalValues[channelId];
    }
  }

  const objects: MotionObjectState[] = [];
  let keyframeCount = 0;
  let behaviorCount = 0;

  for (const objId of doc.rootObjectIds) {
    const obj = doc.objects[objId];
    if (!obj || !obj.visible) continue;

    const worldTransform = evaluateMotionTransform(obj, clampedSecs, docSignalValues);
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
    localTimeSecs: clampedSecs,
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

  return evaluateMotionDocument(doc, localTimeSecs, signalValues);
}
