/**
 * CutLab Motion Transaction System
 * applyMotionOps → updated MotionDocument
 * Integrates with Studio undo/redo via Studio canonical ops.
 */

import type {
  MotionDocument, MotionOp, MotionTransaction, MotionObject,
  MotionKeyframe, MotionBehavior, MotionMask, MotionRig,
  MotionSignal, MotionCamera, MotionMaterial, MotionTextSegment,
} from './types';
import { generateMotionId } from './utils';

// ── Apply a single Motion op ──────────────────────────────────

export function applyMotionOp(doc: MotionDocument, op: MotionOp): MotionDocument {
  const p = op.payload as Record<string, unknown>;

  switch (op.type) {
    case 'motion.setDocumentProp': {
      return { ...doc, ...(p.props as Partial<MotionDocument>), updatedAt: Date.now() };
    }

    case 'motion.setObjectProp': {
      const objId = p.objectId as string;
      const obj = doc.objects[objId];
      if (!obj) return doc;
      return {
        ...doc,
        objects: { ...doc.objects, [objId]: { ...obj, ...(p.props as Partial<MotionObject>) } },
        updatedAt: Date.now(),
      };
    }

    case 'motion.setObjectTransform': {
      const objId = p.objectId as string;
      const obj = doc.objects[objId];
      if (!obj) return doc;
      return {
        ...doc,
        objects: {
          ...doc.objects,
          [objId]: { ...obj, transform: { ...obj.transform, ...(p.transform as Partial<MotionObject['transform']>) } },
        },
        updatedAt: Date.now(),
      };
    }

    case 'motion.addObject': {
      const newObj = p.object as MotionObject;
      const rootObjectIds = p.addToRoot
        ? [...doc.rootObjectIds, newObj.id]
        : doc.rootObjectIds;
      return {
        ...doc,
        objects: { ...doc.objects, [newObj.id]: newObj },
        rootObjectIds,
        updatedAt: Date.now(),
      };
    }

    case 'motion.removeObject': {
      const objId = p.objectId as string;
      const { [objId]: _removed, ...restObjects } = doc.objects;
      return {
        ...doc,
        objects: restObjects,
        rootObjectIds: doc.rootObjectIds.filter((id) => id !== objId),
        updatedAt: Date.now(),
      };
    }

    case 'motion.reorderObjects': {
      const newOrder = p.rootObjectIds as string[];
      return { ...doc, rootObjectIds: newOrder, updatedAt: Date.now() };
    }

    case 'motion.upsertKeyframe': {
      const objId = p.objectId as string;
      const kf = p.keyframe as MotionKeyframe;
      const obj = doc.objects[objId];
      if (!obj) return doc;
      const existingIdx = obj.keyframes.findIndex((k) => k.id === kf.id);
      const newKeyframes = existingIdx >= 0
        ? obj.keyframes.map((k) => k.id === kf.id ? kf : k)
        : [...obj.keyframes, kf];
      return {
        ...doc,
        objects: { ...doc.objects, [objId]: { ...obj, keyframes: newKeyframes } },
        updatedAt: Date.now(),
      };
    }

    case 'motion.removeKeyframe': {
      const objId = p.objectId as string;
      const kfId = p.keyframeId as string;
      const obj = doc.objects[objId];
      if (!obj) return doc;
      return {
        ...doc,
        objects: { ...doc.objects, [objId]: { ...obj, keyframes: obj.keyframes.filter((k) => k.id !== kfId) } },
        updatedAt: Date.now(),
      };
    }

    case 'motion.addBehavior': {
      const objId = p.objectId as string;
      const behavior = p.behavior as MotionBehavior;
      const obj = doc.objects[objId];
      if (!obj) return doc;
      return {
        ...doc,
        objects: { ...doc.objects, [objId]: { ...obj, behaviors: [...obj.behaviors, behavior] } },
        updatedAt: Date.now(),
      };
    }

    case 'motion.removeBehavior': {
      const objId = p.objectId as string;
      const behaviorId = p.behaviorId as string;
      const obj = doc.objects[objId];
      if (!obj) return doc;
      return {
        ...doc,
        objects: { ...doc.objects, [objId]: { ...obj, behaviors: obj.behaviors.filter((b) => b.id !== behaviorId) } },
        updatedAt: Date.now(),
      };
    }

    case 'motion.setBehaviorParam': {
      const objId = p.objectId as string;
      const behaviorId = p.behaviorId as string;
      const key = p.key as string;
      const value = p.value as string | number | boolean;
      const obj = doc.objects[objId];
      if (!obj) return doc;
      return {
        ...doc,
        objects: {
          ...doc.objects,
          [objId]: {
            ...obj,
            behaviors: obj.behaviors.map((b) =>
              b.id === behaviorId ? { ...b, params: { ...b.params, [key]: value } } : b
            ),
          },
        },
        updatedAt: Date.now(),
      };
    }

    case 'motion.setMaterial': {
      const objId = p.objectId as string;
      const material = p.material as MotionMaterial;
      const obj = doc.objects[objId];
      if (!obj) return doc;
      return {
        ...doc,
        objects: { ...doc.objects, [objId]: { ...obj, material } },
        updatedAt: Date.now(),
      };
    }

    case 'motion.addMask': {
      const objId = p.objectId as string;
      const mask = p.mask as MotionMask;
      const obj = doc.objects[objId];
      if (!obj) return doc;
      return {
        ...doc,
        objects: { ...doc.objects, [objId]: { ...obj, masks: [...obj.masks, mask] } },
        updatedAt: Date.now(),
      };
    }

    case 'motion.removeMask': {
      const objId = p.objectId as string;
      const maskId = p.maskId as string;
      const obj = doc.objects[objId];
      if (!obj) return doc;
      return {
        ...doc,
        objects: { ...doc.objects, [objId]: { ...obj, masks: obj.masks.filter((m) => m.id !== maskId) } },
        updatedAt: Date.now(),
      };
    }

    case 'motion.setMask': {
      const objId = p.objectId as string;
      const maskId = p.maskId as string;
      const props = p.props as Partial<MotionMask>;
      const obj = doc.objects[objId];
      if (!obj) return doc;
      return {
        ...doc,
        objects: {
          ...doc.objects,
          [objId]: { ...obj, masks: obj.masks.map((m) => m.id === maskId ? { ...m, ...props } : m) },
        },
        updatedAt: Date.now(),
      };
    }

    case 'motion.addRig': {
      const rig = p.rig as MotionRig;
      return { ...doc, rigs: [...doc.rigs, rig], updatedAt: Date.now() };
    }

    case 'motion.removeRig': {
      const rigId = p.rigId as string;
      return { ...doc, rigs: doc.rigs.filter((r) => r.id !== rigId), updatedAt: Date.now() };
    }

    case 'motion.upsertSignal': {
      const signal = p.signal as MotionSignal;
      return { ...doc, signals: { ...doc.signals, [signal.id]: signal }, updatedAt: Date.now() };
    }

    case 'motion.removeSignal': {
      const signalId = p.signalId as string;
      const { [signalId]: _removed, ...restSignals } = doc.signals;
      return { ...doc, signals: restSignals, updatedAt: Date.now() };
    }

    case 'motion.setTextSegment': {
      const objId = p.objectId as string;
      const segment = p.segment as MotionTextSegment;
      const obj = doc.objects[objId];
      if (!obj || obj.kind !== 'text') return doc;
      const existing = obj.textSegments ?? [];
      const idx = existing.findIndex((s) => s.id === segment.id);
      const newSegments = idx >= 0
        ? existing.map((s) => s.id === segment.id ? segment : s)
        : [...existing, segment];
      return {
        ...doc,
        objects: { ...doc.objects, [objId]: { ...obj, textSegments: newSegments } },
        updatedAt: Date.now(),
      };
    }

    case 'motion.setCamera': {
      const camera = p.camera as MotionCamera;
      return { ...doc, camera, updatedAt: Date.now() };
    }

    case 'motion.upsertDocument': {
      // Replace entire document (used for template instantiation)
      const newDoc = p.document as MotionDocument;
      return { ...newDoc, updatedAt: Date.now() };
    }

    default:
      return doc;
  }
}

// ── Apply multiple ops ────────────────────────────────────────

export function applyMotionOps(doc: MotionDocument, ops: MotionOp[]): MotionDocument {
  let current = doc;
  for (const op of ops) {
    current = applyMotionOp(current, op);
  }
  return current;
}

// ── Create a transaction ──────────────────────────────────────

export function createMotionTransaction(
  description: string,
  ops: MotionOp[],
  beforeSnapshot?: MotionDocument
): MotionTransaction {
  return {
    id: generateMotionId('txn'),
    description,
    ops,
    beforeSnapshot,
    createdAt: Date.now(),
  };
}

// ── Apply transaction and capture after snapshot ──────────────

export function applyMotionTransaction(
  doc: MotionDocument,
  transaction: MotionTransaction
): { doc: MotionDocument; transaction: MotionTransaction } {
  const beforeSnapshot = { ...doc };
  const newDoc = applyMotionOps(doc, transaction.ops);
  const completedTransaction: MotionTransaction = {
    ...transaction,
    beforeSnapshot,
    afterSnapshot: newDoc,
  };
  return { doc: newDoc, transaction: completedTransaction };
}

// ── Op factory helpers ────────────────────────────────────────

export function makeMotionOp(
  type: MotionOp['type'],
  documentId: string,
  payload: Record<string, unknown>,
  actor: MotionOp['actor'] = 'user'
): MotionOp {
  return {
    opId: generateMotionId('mop'),
    type,
    documentId,
    payload,
    actor,
    createdAt: Date.now(),
  };
}
