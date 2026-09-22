/**
 * CutLab Studio↔Motion Bridge — Canonical
 *
 * Studio owns ProjectData.motionDocuments (keyed by id, value = MotionDocument from engine/motion-document.ts).
 * This bridge is the ONE seam between Studio time/project and Motion evaluation.
 *
 * NO separate Motion project. NO separate undo stack. NO separate persistence.
 * ALL Motion edits go through: MotionTransaction → motionTransactionToStudioOps → dispatchBatch → one history entry.
 */

import type { ProjectData, Clip } from './schema';
import type { RationalTime } from './time';
import { toSeconds, fromSeconds } from './time';
import type { MotionDocument, MotionTransaction } from './motion-document';
import { evaluateMotionTransform } from './motion-document';
import { makeOp } from './operations';
import type { OpEnvelope } from './operations';
import { generateId } from './schema';

/**
 * Structural Motion op shape — the ONE commit seam accepts both
 * engine/motion-document.ts MotionOps and legacy motion/types.ts MotionOps.
 * The reducer applies them through the canonical MotionTransaction applier.
 */
export interface MotionOpLike {
  documentId: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface MotionTransactionLike {
  ops: MotionOpLike[];
  description: string;
}

export function isMotionTransactionLike(tx: unknown): tx is MotionTransactionLike {
  return (
    typeof tx === 'object' && tx !== null &&
    typeof (tx as MotionTransactionLike).description === 'string' &&
    Array.isArray((tx as MotionTransactionLike).ops)
  );
}


// ── Time Conversion Seam ──────────────────────────────────────

/**
 * THE ONE explicit time conversion seam.
 * Studio sequence time → clip-local Motion time (seconds)
 */
export function studioTimeToMotionTime(
  sequenceTimeSecs: number,
  clip: Clip
): number {
  const clipStartSecs = toSeconds(clip.startTime);
  const clipDurationSecs = toSeconds(clip.duration);
  const speed = clip.speed || 1;
  let localSecs = (sequenceTimeSecs - clipStartSecs) * speed;
  if (clip.reverse) localSecs = clipDurationSecs - localSecs;
  return Math.max(0, Math.min(clipDurationSecs, localSecs));
}

/**
 * Convert clip-local Motion time back to Studio sequence time (seconds).
 */
export function motionLocalTimeToStudioSequenceTime(
  localTimeSecs: number,
  clip: Clip
): number {
  const clipStartSecs = toSeconds(clip.startTime);
  const clipDurationSecs = toSeconds(clip.duration);
  const speed = clip.speed || 1;
  if (clip.reverse) {
    return clipStartSecs + (clipDurationSecs - localTimeSecs) / speed;
  }
  return clipStartSecs + localTimeSecs / speed;
}

/**
 * Convert Studio RationalTime to a seconds value for Motion.
 */
export function studioRationalToMotionRational(rt: RationalTime): { value: number; timescale: number } {
  const secs = toSeconds(rt);
  return { value: Math.round(secs * rt.timescale), timescale: rt.timescale };
}

// ── Motion Document Resolution ────────────────────────────────

/**
 * Resolve a MotionDocument from Studio's ProjectData.
 * ProjectData.motionDocuments stores MotionDocument objects directly (not JSON-wrapped).
 * Returns null if not found.
 */
export function resolveMotionDocument(
  project: ProjectData,
  motionDocumentId: string
): MotionDocument | null {
  return project.motionDocuments?.[motionDocumentId] ?? null;
}

/**
 * Resolve a MotionDocument for a clip.
 * Checks motionDocumentId first, then falls back to motionBundleId.
 */
export function resolveClipMotionDocument(
  project: ProjectData,
  clip: Clip
): MotionDocument | null {
  const docId = clip.motionDocumentId ?? clip.motionBundleId;
  if (!docId) return null;
  return resolveMotionDocument(project, docId);
}

// ── Motion Transaction → Studio Op Bridge ────────────────────

/**
 * Convert a MotionTransaction into Studio canonical OpEnvelopes.
 * One Motion transaction → one Studio history entry.
 * Accepts both engine/motion-document.ts and motion/types.ts transaction shapes.
 *
 * Each document's ops are packed as ONE 'motion.document.patch' op — the
 * canonical Motion round-trip: the reducer (the ONE mutation door) applies
 * the transaction to the MotionDocument stored in ProjectData.motionDocuments.
 * No document copy is computed here; the document only ever changes inside
 * the reducer, so undo/redo snapshots stay canonical.
 */
export function motionTransactionToStudioOps(
  transaction: MotionTransactionLike | MotionTransaction,
  project: ProjectData
): OpEnvelope[] {
  const ops: OpEnvelope[] = [];

  // Group ops by documentId
  const byDoc = new Map<string, MotionOpLike[]>();
  for (const op of transaction.ops) {
    const arr = byDoc.get(op.documentId) ?? [];
    arr.push(op);
    byDoc.set(op.documentId, arr);
  }

  for (const [docId, motionOps] of byDoc) {
    const existing = project.motionDocuments?.[docId];
    if (!existing) continue;

    const tx: MotionTransaction = {
      ops: motionOps as MotionTransaction['ops'],
      description: transaction.description,
    };
    ops.push(makeOp('motion.document.patch', { documentId: docId, transaction: tx }, 'user'));
  }

  return ops;
}

// ── Motion Document Persistence Helpers ──────────────────────

/**
 * Create Studio ops to insert a new Motion clip with its document.
 * Returns ops to: register the document + add the clip to the timeline.
 */
export function createMotionClipOps(params: {
  doc: MotionDocument;
  sequenceId: string;
  trackId: string;
  startTimeSecs: number;
  fps: number;
}): OpEnvelope[] {
  const { doc, sequenceId, trackId, startTimeSecs, fps } = params;
  const durationSecs = toSeconds(doc.duration);

  const clip: import('./schema').Clip = {
    id: generateId('clip'),
    kind: 'motion',
    trackId,
    name: doc.name,
    startTime: fromSeconds(startTimeSecs, 30000),
    duration: fromSeconds(durationSecs, 30000),
    sourceIn: fromSeconds(0, 30000),
    sourceOut: fromSeconds(durationSecs, 30000),
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0 },
    keyframes: [],
    effects: [],
    masks: [],
    gain: 0,
    fadeIn: fromSeconds(0, 30000),
    fadeOut: fromSeconds(0, 30000),
    speed: 1,
    reverse: false,
    freeze: false,
    disabled: false,
    motionDocumentId: doc.id,
    motionBundleId: doc.id,
    zOrder: 10,
  };

  return [
    makeOp('motion.document.register', { document: doc }, 'system'),
    makeOp('clip.add', { sequenceId, clip }, 'user'),
  ];
}

// ── Signal Engine (singleton) ─────────────────────────────────

export class SimpleSignalEngine {
  evaluateSignals(
    signals: Record<string, import('./motion-document').MotionSignal>,
    _localTimeSecs: number
  ): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [id, sig] of Object.entries(signals)) {
      const val = sig.currentValue ?? sig.defaultValue;
      if (typeof val === 'number') result[id] = val;
    }
    return result;
  }
}

export const studioSignalEngine = new SimpleSignalEngine();

// ── Evaluate Motion Clip (for inspector/preview use) ──────────

/**
 * Evaluate a motion clip at Studio sequence time.
 * Returns a simple frame state for inspector display.
 * Uses engine/motion-document.ts evaluateMotionTransform.
 */
export function evaluateMotionClip(
  project: ProjectData,
  clip: Clip,
  sequenceTimeSecs: number,
  _signalValues?: Record<string, number>
): { localTimeSecs: number; objects: Array<{ objectId: string; transform: import('./motion-document').MotionTransform; opacity: number }> } | null {
  const doc = resolveClipMotionDocument(project, clip);
  if (!doc) return null;

  const localTimeSecs = studioTimeToMotionTime(sequenceTimeSecs, clip);

  const objects = Object.values(doc.objects).map((obj) => {
    const mt = evaluateMotionTransform(obj, localTimeSecs);
    return { objectId: obj.id, transform: mt, opacity: mt.opacity };
  });

  return { localTimeSecs, objects };
}