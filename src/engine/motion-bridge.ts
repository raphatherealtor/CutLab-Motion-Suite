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
    // Preserve provenance across the Studio boundary: an AI-authored transaction
    // is recorded as an 'ai' op in Studio history, not silently as 'user'.
    const actor = deriveStudioActor(motionOps);
    ops.push(makeOp('motion.document.patch', { documentId: docId, transaction: tx }, actor));
  }

  return ops;
}

function deriveStudioActor(motionOps: MotionOpLike[]): OpEnvelope['actor'] {
  const actors = new Set(
    motionOps
      .map((op) => (op as { actor?: string }).actor)
      .filter((a): a is string => typeof a === 'string')
  );
  if (actors.has('ai')) return 'ai';
  if (actors.has('template')) return 'system';
  if (actors.size === 1 && actors.has('system')) return 'system';
  return 'user';
}

// ── Motion Document Persistence Helpers ──────────────────────

/**
 * Convert a legacy src/motion/types MotionDocument (demo compositions, SVG
 * possibilities, templates) into the canonical engine MotionDocument.
 * Migrates nested transforms → flat, inline material → materials map + materialId,
 * single camera → cameras map, motion/types signals → canonical signals.
 * This is a load/ingest-time migration — canonical representation afterwards.
 */

// Structural input type — avoids importing the legacy type system at runtime.
interface LegacyMotionDocInput {
  id: string;
  name: string;
  schemaVersion?: number;
  duration: { value: number; timescale: number };
  fps: number;
  width: number;
  height: number;
  objects: Record<string, Record<string, unknown>>;
  rootObjectIds: string[];
  camera?: Record<string, unknown> | null;
  signals?: Record<string, Record<string, unknown>>;
  rigs?: Array<Record<string, unknown>>;
  templateId?: string;
  templateParams?: Record<string, string | number | boolean>;
  svgSource?: string;
  contributionTrace?: MotionDocument['contributionTrace'];
  backgroundColor?: string;
  createdAt: number;
  updatedAt: number;
}

function mapLegacyKind(kind: unknown): MotionDocument['objects'][string]['kind'] {
  switch (kind) {
    case 'text': return 'text';
    case 'shape': case 'path': case 'particle': return 'shape';
    case 'image': return 'image';
    case 'video': return 'video';
    case 'group': return 'group';
    case 'camera': return 'camera';
    case 'svg': return 'svg';
    case 'text-segment': return 'text-segment';
    default: return 'null-object';
  }
}

function legacyVec3ToFlat(t: Record<string, unknown> | undefined): MotionDocument['objects'][string]['transform'] {
  const pos = (t?.['position'] ?? {}) as Record<string, number>;
  const rot = (t?.['rotation'] ?? {}) as Record<string, number>;
  const scale = (t?.['scale'] ?? {}) as Record<string, number>;
  const anchor = (t?.['anchor'] ?? {}) as Record<string, number>;
  return {
    x: pos.x ?? 0, y: pos.y ?? 0, z: pos.z ?? 0,
    scaleX: scale.x ?? 1, scaleY: scale.y ?? 1, scaleZ: scale.z ?? 1,
    rotationX: rot.x ?? 0, rotationY: rot.y ?? 0, rotationZ: rot.z ?? 0,
    anchorX: anchor.x ?? 0, anchorY: anchor.y ?? 0, anchorZ: anchor.z ?? 0,
    opacity: typeof t?.['opacity'] === 'number' ? (t['opacity'] as number) : 1,
  };
}

function legacyColorToHex(c: unknown): string | undefined {
  if (typeof c === 'string') return c;
  if (c && typeof c === 'object') {
    const col = c as { r: number; g: number; b: number };
    const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${toHex(col.r ?? 1)}${toHex(col.g ?? 1)}${toHex(col.b ?? 1)}`;
  }
  return undefined;
}

export function motionTypesDocToEngineDoc(legacy: LegacyMotionDocInput): MotionDocument {
  const materials: MotionDocument['materials'] = {};
  const objects: MotionDocument['objects'] = {};

  for (const [objId, rawObj] of Object.entries(legacy.objects ?? {})) {
    const obj = rawObj as Record<string, unknown>;
    const transform = legacyVec3ToFlat(obj.transform as Record<string, unknown> | undefined);

    // Inline material → materials map + materialId
    let materialId: string | undefined;
    const rawMaterial = obj.material as Record<string, unknown> | undefined;
    if (rawMaterial && typeof rawMaterial.id === 'string') {
      materialId = rawMaterial.id;
      const rawStops = rawMaterial.gradientStops as Array<{ color?: unknown; position?: number }> | undefined;
      materials[materialId] = {
        id: materialId,
        name: (rawMaterial.type as string) ?? 'Material',
        type: (rawMaterial.type as MotionDocument['materials'][string]['type']) ?? 'solid',
        color: legacyColorToHex(rawMaterial.color),
        gradientStops: rawStops?.map((s) => ({ offset: s.position ?? 0, color: legacyColorToHex(s.color) ?? '#ffffff' })),
        opacity: typeof rawMaterial.opacity === 'number' ? rawMaterial.opacity : undefined,
        params: rawMaterial.params as Record<string, number | string | boolean> | undefined,
      };
    }

    // Masks: bounds → x/y/width/height
    const rawMasks = obj.masks as Array<Record<string, unknown>> | undefined;
    const masks = (rawMasks ?? []).map((m) => {
      const bounds = m.bounds as Record<string, number> | undefined;
      return {
        id: (m.id as string) ?? generateId('mask'),
        shape: ((m.shape as string) === 'ellipse' ? 'ellipse' : (m.shape as string) === 'path' ? 'path' : 'rectangle') as 'ellipse' | 'path' | 'rectangle',
        pathData: m.pathData as string | undefined,
        x: bounds?.x ?? 0,
        y: bounds?.y ?? 0,
        width: bounds?.width ?? 0,
        height: bounds?.height ?? 0,
        feather: (m.feather as number) ?? 0,
        invert: (m.inverted as boolean) ?? (m.invert as boolean) ?? false,
        rotation: 0,
        opacity: (m.opacity as number) ?? 1,
      };
    });

    // Text segments: drop legacy char/word animation wrappers, keep segment fields
    const rawSegments = obj.textSegments as Array<Record<string, unknown>> | undefined;
    const textSegments = rawSegments?.map((s) => ({
      id: (s.id as string) ?? generateId('seg'),
      text: (s.text as string) ?? '',
      startTime: (s.startTime as MotionDocument['duration']) ?? { value: 0, timescale: 30000 },
      endTime: (s.endTime as MotionDocument['duration']) ?? { value: 30000, timescale: 30000 },
      fontFamily: s.fontFamily as string | undefined,
      fontSize: s.fontSize as number | undefined,
      fontWeight: s.fontWeight as number | undefined,
      letterSpacing: s.letterSpacing as number | undefined,
      lineHeight: s.lineHeight as number | undefined,
      textAlign: s.textAlign as 'left' | 'center' | 'right' | undefined,
    }));

    objects[objId] = {
      id: (obj.id as string) ?? objId,
      kind: mapLegacyKind(obj.kind),
      name: (obj.name as string) ?? objId,
      parentId: obj.parentId as string | undefined,
      depth: (obj.depth as number) ?? 0,
      transform,
      keyframes: (obj.keyframes as MotionDocument['objects'][string]['keyframes']) ?? [],
      behaviors: (obj.behaviors as MotionDocument['objects'][string]['behaviors']) ?? [],
      masks,
      blendMode: ((obj.blendMode as string) === 'normal' || !obj.blendMode ? 'normal' : obj.blendMode as MotionDocument['objects'][string]['blendMode']),
      visible: (obj.visible as boolean) ?? true,
      solo: false,
      locked: (obj.locked as boolean) ?? false,
      materialId,
      text: obj.text as string | undefined,
      textSegments: textSegments?.length ? textSegments : undefined,
      assetRef: obj.assetRef as string | undefined,
      svgData: obj.svgData as string | undefined,
      childIds: (obj.children as string[]) ?? (obj.childIds as string[] | undefined),
      occlusionRole: obj.occlusionRole as MotionDocument['objects'][string]['occlusionRole'],
      tags: obj.tags as string[] | undefined,
    };
  }

  // Signals: legacy {id, kind, name, sourceRef?, range?} → canonical engine
  // MotionSignal. kind/sourceRef/range survive the conversion (signal identity
  // law); defaultValue is deliberately NOT fabricated — channel signals (kind
  // set) evaluate live from their channel, and forcing a numeric default here
  // used to short-circuit evaluation and pin every converted signal at 0.
  const signals: MotionDocument['signals'] = {};
  for (const [sigId, rawSig] of Object.entries(legacy.signals ?? {})) {
    const rawRange = rawSig.range as { min?: unknown; max?: unknown } | undefined;
    const rawDefault = rawSig.defaultValue as unknown;
    signals[sigId] = {
      id: (rawSig.id as string) ?? sigId,
      name: (rawSig.name as string) ?? sigId,
      type: 'number',
      // Pass through an explicit static default when the source carries one;
      // never fabricate one (fabricated 0 used to pin channel signals at 0).
      defaultValue:
        typeof rawDefault === 'number' || typeof rawDefault === 'boolean' || typeof rawDefault === 'string'
          ? rawDefault
          : undefined,
      expression: rawSig.expression as string | undefined,
      kind: rawSig.kind as string | undefined,
      sourceRef: rawSig.sourceRef as string | undefined,
      range:
        rawRange && typeof rawRange.min === 'number' && typeof rawRange.max === 'number'
          ? { min: rawRange.min, max: rawRange.max }
          : undefined,
    };
  }

  // Camera: legacy single camera → cameras map
  const cameras: MotionDocument['cameras'] = {};
  let activeCameraId: string | undefined;
  if (legacy.camera && typeof legacy.camera['id'] === 'string') {
    const cam = legacy.camera as Record<string, unknown>;
    const camId: string = legacy.camera['id'];
    cameras[camId] = {
      id: camId,
      name: (cam.name as string) ?? 'Camera',
      transform: legacyVec3ToFlat(cam.transform as Record<string, unknown> | undefined),
      fov: (cam.fov as number) ?? 60,
      near: (cam.near as number) ?? 1,
      far: (cam.far as number) ?? 10000,
      keyframes: (cam.keyframes as MotionDocument['cameras'][string]['keyframes']) ?? [],
      active: true,
    };
    activeCameraId = camId;
  }

  return {
    id: legacy.id,
    name: legacy.name,
    duration: legacy.duration,
    fps: legacy.fps,
    width: legacy.width,
    height: legacy.height,
    objects,
    rootObjectIds: legacy.rootObjectIds ?? Object.keys(objects),
    materials,
    cameras,
    activeCameraId,
    signals,
    rigs: legacy.rigs as MotionDocument['rigs'],
    schemaVersion: legacy.schemaVersion,
    templateId: legacy.templateId,
    templateParams: legacy.templateParams,
    svgSource: legacy.svgSource,
    contributionTrace: legacy.contributionTrace,
    backgroundColor: legacy.backgroundColor,
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt,
  };
}

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