/**
 * CutLab Motion UI Adapter
 *
 * Pure adapter / view-model layer.
 * Maps canonical CutLab MotionDocument data into the shapes
 * expected by the original Motion Animator UI panels.
 *
 * RULES:
 * - No canonical state mutation here.
 * - No mock / demo data.
 * - No second canonical model.
 * - All persistent edits still go through MotionOp → MotionTransaction → Studio history.
 * - This file only produces VIEW MODELS for display.
 */

import type { MotionDocument, MotionObject, MotionKeyframe } from './motion-document';
import { toSeconds } from './time';
import type { FrameState, MotionObjectState } from './motion-document-utils';

// ─────────────────────────────────────────────────────────────
// TRACK VIEW MODEL
// Used by: timeline rows, object hierarchy, dope sheet
// ─────────────────────────────────────────────────────────────

export type TrackKind = 'object' | 'camera' | 'signal' | 'group';

export interface TrackViewModel {
  /** Stable ID — matches canonical MotionObject.id or camera/signal id */
  id: string;
  kind: TrackKind;
  label: string;
  objectKind?: MotionObject['kind'];
  depth: number;
  /** Indentation level in hierarchy */
  hierarchyDepth: number;
  parentId?: string;
  /** Whether this track is currently selected */
  selected: boolean;
  /** Canonical visible flag */
  visible: boolean;
  /** Canonical locked flag */
  locked: boolean;
  /**
   * mute / solo are ephemeral workspace states only.
   * They have no canonical equivalent and are NOT persisted.
   */
  ephemeralMuted: boolean;
  ephemeralSoloed: boolean;
  /** Keyframe count for display */
  keyframeCount: number;
  /** Behavior count for display */
  behaviorCount: number;
  /** Whether this track has any keyframes in the current view window */
  hasKeyframesInView: boolean;
  /** Children track IDs */
  childIds: string[];
  /** Collapsed state (ephemeral) */
  collapsed: boolean;
}

export interface MotionAnimatorTrackViewModelList {
  tracks: Record<string, TrackViewModel>;
  /** Flat ordered list for rendering (respects hierarchy + collapse) */
  flatOrder: string[];
  /** Total keyframe count across all tracks */
  totalKeyframes: number;
}

/**
 * Build the full track view model list from a canonical MotionDocument.
 *
 * canonical MotionDocument
 * → MotionAnimatorTrackViewModel[]
 */
export function buildTrackViewModels(
  doc: MotionDocument,
  selectedObjectId: string | null,
  ephemeralState: EphemeralTrackState
): MotionAnimatorTrackViewModelList {
  const tracks: Record<string, TrackViewModel> = {};
  let totalKeyframes = 0;

  // Build object tracks
  for (const obj of Object.values(doc.objects)) {
    const kfCount = obj.keyframes?.length ?? 0;
    totalKeyframes += kfCount;
    tracks[obj.id] = {
      id: obj.id,
      kind: 'object',
      label: obj.name,
      objectKind: obj.kind,
      depth: obj.depth,
      hierarchyDepth: 0, // filled below
      parentId: obj.parentId,
      selected: obj.id === selectedObjectId,
      visible: obj.visible,
      locked: obj.locked,
      ephemeralMuted: ephemeralState.mutedIds.has(obj.id),
      ephemeralSoloed: ephemeralState.soloedIds.has(obj.id),
      keyframeCount: kfCount,
      behaviorCount: obj.behaviors?.length ?? 0,
      hasKeyframesInView: kfCount > 0,
      childIds: [],
      collapsed: ephemeralState.collapsedIds.has(obj.id),
    };
  }

  // Wire children
  for (const obj of Object.values(doc.objects)) {
    if (obj.parentId && tracks[obj.parentId]) {
      tracks[obj.parentId].childIds.push(obj.id);
    }
  }

  // Camera tracks — engine uses cameras Record (plural)
  for (const cam of Object.values(doc.cameras ?? {})) {
    const camKfCount = cam.keyframes?.length ?? 0;
    totalKeyframes += camKfCount;
    tracks[cam.id] = {
      id: cam.id,
      kind: 'camera',
      label: cam.name,
      depth: 0,
      hierarchyDepth: 0,
      selected: cam.id === selectedObjectId,
      visible: true,
      locked: false,
      ephemeralMuted: false,
      ephemeralSoloed: false,
      keyframeCount: camKfCount,
      behaviorCount: 0,
      hasKeyframesInView: camKfCount > 0,
      childIds: [],
      collapsed: false,
    };
  }

  // Signal tracks
  for (const signal of Object.values(doc.signals ?? {})) {
    tracks[signal.id] = {
      id: signal.id,
      kind: 'signal',
      label: signal.name,
      depth: 0,
      hierarchyDepth: 0,
      selected: false,
      visible: true,
      locked: false,
      ephemeralMuted: false,
      ephemeralSoloed: false,
      keyframeCount: 0,
      behaviorCount: 0,
      hasKeyframesInView: false,
      childIds: [],
      collapsed: false,
    };
  }

  // Compute hierarchy depths
  const computeDepth = (id: string, depth: number) => {
    if (tracks[id]) {
      tracks[id].hierarchyDepth = depth;
      for (const childId of tracks[id].childIds) computeDepth(childId, depth + 1);
    }
  };
  const rootIds = doc.rootObjectIds ?? Object.values(doc.objects).filter((o) => !o.parentId).map((o) => o.id);
  for (const id of rootIds) computeDepth(id, 0);

  // Build flat order (DFS, respecting collapse)
  const flatOrder: string[] = [];
  const visit = (id: string) => {
    flatOrder.push(id);
    const track = tracks[id];
    if (track && !track.collapsed) {
      for (const childId of track.childIds) visit(childId);
    }
  };
  for (const id of rootIds) visit(id);
  for (const cam of Object.values(doc.cameras ?? {})) flatOrder.push(cam.id);
  for (const signal of Object.values(doc.signals ?? {})) flatOrder.push(signal.id);

  return {
    tracks,
    flatOrder,
    totalKeyframes,
  };
}

// ─────────────────────────────────────────────────────────────
// EPHEMERAL TRACK STATE
// Workspace-only, never persisted, never canonical
// ─────────────────────────────────────────────────────────────

export interface EphemeralTrackState {
  /** Muted track IDs — ephemeral workspace state only */
  mutedIds: Set<string>;
  /** Soloed track IDs — ephemeral workspace state only */
  soloedIds: Set<string>;
  /** Collapsed track IDs — ephemeral workspace state only */
  collapsedIds: Set<string>;
}

export function createEphemeralTrackState(): EphemeralTrackState {
  return {
    mutedIds: new Set(),
    soloedIds: new Set(),
    collapsedIds: new Set(),
  };
}

export function toggleEphemeralMute(state: EphemeralTrackState, id: string): EphemeralTrackState {
  const mutedIds = new Set(state.mutedIds);
  if (mutedIds.has(id)) mutedIds.delete(id); else mutedIds.add(id);
  return { ...state, mutedIds };
}

export function toggleEphemeralSolo(state: EphemeralTrackState, id: string): EphemeralTrackState {
  const next = new Set(state.soloedIds);
  if (next.has(id)) next.delete(id); else next.add(id);
  return { ...state, soloedIds: next };
}

export function toggleEphemeralCollapse(state: EphemeralTrackState, id: string): EphemeralTrackState {
  const collapsedIds = new Set(state.collapsedIds);
  if (collapsedIds.has(id)) collapsedIds.delete(id); else collapsedIds.add(id);
  return { ...state, collapsedIds };
}

// ─────────────────────────────────────────────────────────────
// GRAPH CURVE EDITOR VIEW MODELS
// Used by: GraphCurveEditor
// ─────────────────────────────────────────────────────────────

export interface CurveKeyframeViewModel {
  id: string;
  timeSecs: number;
  value: number;
  easing: MotionKeyframe['easing'];
  /** Normalized x position [0..1] relative to document duration */
  normalizedX: number;
  /** Normalized y position [0..1] relative to track value range */
  normalizedY: number;
  selected: boolean;
}

export interface GraphCurveTrackViewModel {
  /** Unique track ID: `${objectId}::${property}` */
  id: string;
  objectId: string;
  objectName: string;
  property: string;
  /** Display label e.g. "Position X" */
  label: string;
  /** Accent color for this property */
  color: string;
  keyframes: CurveKeyframeViewModel[];
  /** Value range for normalization */
  valueMin: number;
  valueMax: number;
  /** Whether this track is visible in the graph editor */
  visible: boolean;
  /** Whether this track is selected */
  selected: boolean;
}

/** Canonical property → display label + color */
const PROPERTY_META: Record<string, { label: string; color: string }> = {
  'x':          { label: 'Position X',  color: '#ef4444' },
  'y':          { label: 'Position Y',  color: '#22c55e' },
  'z':          { label: 'Position Z',  color: '#3b82f6' },
  'rotationX':  { label: 'Rotation X',  color: '#f97316' },
  'rotationY':  { label: 'Rotation Y',  color: '#84cc16' },
  'rotationZ':  { label: 'Rotation Z',  color: '#06b6d4' },
  'scaleX':     { label: 'Scale X',     color: '#a855f7' },
  'scaleY':     { label: 'Scale Y',     color: '#ec4899' },
  'scaleZ':     { label: 'Scale Z',     color: '#8b5cf6' },
  'opacity':    { label: 'Opacity',     color: '#f59e0b' },
  'depth':      { label: 'Depth',       color: '#14b8a6' },
  'camera.fov': { label: 'Camera FOV',  color: '#64748b' },
  // Legacy aliases
  'position.x': { label: 'Position X',  color: '#ef4444' },
  'position.y': { label: 'Position Y',  color: '#22c55e' },
  'position.z': { label: 'Position Z',  color: '#3b82f6' },
  'rotation.z': { label: 'Rotation Z',  color: '#06b6d4' },
  'scale.x':    { label: 'Scale X',     color: '#a855f7' },
  'scale.y':    { label: 'Scale Y',     color: '#ec4899' },
};

function getPropertyMeta(prop: string): { label: string; color: string } {
  return PROPERTY_META[prop] ?? { label: prop, color: '#94a3b8' };
}

/**
 * Build GraphCurveEditor track view models from a selected MotionObject.
 *
 * MotionObject keyframes
 * → GraphCurveTrackViewModel[]
 */
export function buildGraphCurveTracks(
  obj: MotionObject,
  durationSecs: number,
  selectedTrackIds: Set<string>
): GraphCurveTrackViewModel[] {
  if (!obj.keyframes || obj.keyframes.length === 0) return [];

  // Group keyframes by property
  const byProp = new Map<string, MotionKeyframe[]>();
  for (const kf of obj.keyframes) {
    const arr = byProp.get(kf.property) ?? [];
    arr.push(kf);
    byProp.set(kf.property, arr);
  }

  const tracks: GraphCurveTrackViewModel[] = [];

  for (const [prop, kfs] of byProp) {
    const sorted = [...kfs].sort((a, b) => toSeconds(a.time) - toSeconds(b.time));
    const numericKfs = sorted.filter((k) => typeof k.value === 'number');
    if (numericKfs.length === 0) continue;

    const values = numericKfs.map((k) => k.value as number);
    const valueMin = Math.min(...values);
    const valueMax = Math.max(...values);
    const valueRange = valueMax - valueMin || 1;

    const trackId = `${obj.id}::${prop}`;
    const meta = getPropertyMeta(prop);

    const keyframeVMs: CurveKeyframeViewModel[] = numericKfs.map((kf) => {
      const timeSecs = toSeconds(kf.time);
      const value = kf.value as number;
      return {
        id: kf.id,
        timeSecs,
        value,
        easing: kf.easing,
        normalizedX: durationSecs > 0 ? timeSecs / durationSecs : 0,
        normalizedY: (value - valueMin) / valueRange,
        selected: false,
      };
    });

    tracks.push({
      id: trackId,
      objectId: obj.id,
      objectName: obj.name,
      property: prop,
      label: meta.label,
      color: meta.color,
      keyframes: keyframeVMs,
      valueMin,
      valueMax,
      visible: true,
      selected: selectedTrackIds.has(trackId),
    });
  }

  return tracks;
}

/**
 * Build GraphCurveEditor tracks for the camera.
 */
export function buildCameraGraphCurveTracks(
  camera: MotionDocument['cameras'][string],
  durationSecs: number,
  selectedTrackIds: Set<string>
): GraphCurveTrackViewModel[] {
  if (!camera.keyframes || camera.keyframes.length === 0) return [];

  const byProp = new Map<string, MotionKeyframe[]>();
  for (const kf of camera.keyframes) {
    const arr = byProp.get(kf.property) ?? [];
    arr.push(kf);
    byProp.set(kf.property, arr);
  }

  const tracks: GraphCurveTrackViewModel[] = [];
  for (const [prop, kfs] of byProp) {
    const sorted = [...kfs].sort((a, b) => toSeconds(a.time) - toSeconds(b.time));
    const numericKfs = sorted.filter((k) => typeof k.value === 'number');
    if (numericKfs.length === 0) continue;

    const values = numericKfs.map((k) => k.value as number);
    const valueMin = Math.min(...values);
    const valueMax = Math.max(...values);
    const valueRange = valueMax - valueMin || 1;
    const trackId = `${camera.id}::${prop}`;
    const meta = getPropertyMeta(`camera.${prop}`);

    tracks.push({
      id: trackId,
      objectId: camera.id,
      objectName: camera.name,
      property: prop,
      label: meta.label,
      color: meta.color,
      keyframes: numericKfs.map((kf) => {
        const timeSecs = toSeconds(kf.time);
        const value = kf.value as number;
        return {
          id: kf.id,
          timeSecs,
          value,
          easing: kf.easing,
          normalizedX: durationSecs > 0 ? timeSecs / durationSecs : 0,
          normalizedY: (value - valueMin) / valueRange,
          selected: false,
        };
      }),
      valueMin,
      valueMax,
      visible: true,
      selected: selectedTrackIds.has(trackId),
    });
  }
  return tracks;
}

// ─────────────────────────────────────────────────────────────
// DOPE SHEET VIEW MODELS
// Used by: DopeSheet
// ─────────────────────────────────────────────────────────────

export interface DopeKeyframeViewModel {
  id: string;
  timeSecs: number;
  property: string;
  /** Normalized x position [0..1] */
  normalizedX: number;
  selected: boolean;
  easing: MotionKeyframe['easing'];
}

export interface DopeBehaviorViewModel {
  id: string;
  type: string;
  startSecs: number;
  endSecs: number;
  normalizedStart: number;
  normalizedEnd: number;
  color: string;
}

export interface DopeTrackViewModel {
  id: string;
  objectId: string;
  label: string;
  kind: TrackKind;
  objectKind?: MotionObject['kind'];
  hierarchyDepth: number;
  keyframes: DopeKeyframeViewModel[];
  behaviors: DopeBehaviorViewModel[];
  selected: boolean;
  visible: boolean;
  locked: boolean;
}

const BEHAVIOR_COLORS: Record<string, string> = {
  'fade-in': '#3b82f6',
  'fade-out': '#3b82f6',
  'slide-in': '#10b981',
  'slide-out': '#10b981',
  'scale-in': '#f59e0b',
  'scale-out': '#f59e0b',
  'bounce-in': '#f97316',
  'word-by-word': '#8b5cf6',
  'char-by-char': '#a855f7',
  'wave': '#06b6d4',
  'pulse': '#ef4444',
  'signal-reactive': '#22c55e',
  'typewriter': '#8b5cf6',
  'custom': '#94a3b8',
};

/**
 * Build DopeSheet track view models from a canonical MotionDocument.
 *
 * MotionObject[] + keyframes + behaviors
 * → DopeTrackViewModel[]
 */
export function buildDopeSheetTracks(
  doc: MotionDocument,
  selectedObjectId: string | null,
  durationSecs: number,
  ephemeralState: EphemeralTrackState
): DopeTrackViewModel[] {
  const tracks: DopeTrackViewModel[] = [];

  const processObject = (obj: MotionObject, hierarchyDepth: number) => {
    const kfs: DopeKeyframeViewModel[] = (obj.keyframes ?? []).map((kf) => {
      const timeSecs = toSeconds(kf.time);
      return {
        id: kf.id,
        timeSecs,
        property: kf.property,
        normalizedX: durationSecs > 0 ? timeSecs / durationSecs : 0,
        selected: false,
        easing: kf.easing,
      };
    });

    const behs: DopeBehaviorViewModel[] = (obj.behaviors ?? []).map((beh) => {
      const startSecs = toSeconds(beh.startTime);
      const durSecs = toSeconds(beh.duration);
      const endSecs = startSecs + durSecs;
      return {
        id: beh.id,
        type: beh.type,
        startSecs,
        endSecs,
        normalizedStart: durationSecs > 0 ? startSecs / durationSecs : 0,
        normalizedEnd: durationSecs > 0 ? endSecs / durationSecs : 0,
        color: BEHAVIOR_COLORS[beh.type] ?? '#94a3b8',
      };
    });

    tracks.push({
      id: obj.id,
      objectId: obj.id,
      label: obj.name,
      kind: 'object',
      objectKind: obj.kind,
      hierarchyDepth,
      keyframes: kfs,
      behaviors: behs,
      selected: obj.id === selectedObjectId,
      visible: obj.visible,
      locked: obj.locked,
    });

    // Process children
    const children = Object.values(doc.objects).filter((o) => o.parentId === obj.id);
    for (const child of children) processObject(child, hierarchyDepth + 1);
  };

  const rootIds = doc.rootObjectIds ?? Object.values(doc.objects).filter((o) => !o.parentId).map((o) => o.id);
  for (const id of rootIds) {
    const obj = doc.objects[id];
    if (obj) processObject(obj, 0);
  }

  // Camera tracks — engine uses cameras Record (plural)
  for (const cam of Object.values(doc.cameras ?? {})) {
    const camKfs: DopeKeyframeViewModel[] = (cam.keyframes ?? []).map((kf) => {
      const timeSecs = toSeconds(kf.time);
      return {
        id: kf.id,
        timeSecs,
        property: kf.property,
        normalizedX: durationSecs > 0 ? timeSecs / durationSecs : 0,
        selected: false,
        easing: kf.easing,
      };
    });
    tracks.push({
      id: cam.id,
      objectId: cam.id,
      label: cam.name,
      kind: 'camera',
      hierarchyDepth: 0,
      keyframes: camKfs,
      behaviors: [],
      selected: cam.id === selectedObjectId,
      visible: true,
      locked: false,
    });
  }

  return tracks;
}

// ─────────────────────────────────────────────────────────────
// PROPERTY INSPECTOR VIEW MODELS
// Used by: PropertiesPanel / PropertyInspector
// ─────────────────────────────────────────────────────────────

export type PropertyGroupKind =
  | 'transform' | 'depth' | 'material' | 'text' | 'behaviors' | 'masks' | 'signals' | 'camera' | 'rig';

export interface PropertyViewModel {
  key: string;
  label: string;
  value: number | string | boolean;
  type: 'number' | 'string' | 'boolean' | 'color' | 'select';
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  /** Whether this property has keyframes */
  hasKeyframes: boolean;
  /** Op type to dispatch when changed */
  opType: string;
  /** Additional payload fields */
  opPayload: Record<string, unknown>;
}

export interface PropertyGroupViewModel {
  id: string;
  kind: PropertyGroupKind;
  label: string;
  properties: PropertyViewModel[];
  collapsed: boolean;
}

/**
 * Build property inspector view models from a canonical MotionObject.
 *
 * MotionObject
 * → PropertyGroupViewModel[]
 */
export function buildPropertyGroups(
  obj: MotionObject,
  docId: string
): PropertyGroupViewModel[] {
  const groups: PropertyGroupViewModel[] = [];
  const t = obj.transform;
  const keyframedProps = new Set(obj.keyframes?.map((k) => k.property) ?? []);

  // Transform group — uses engine flat transform (x, y, z, scaleX, scaleY, rotationZ, opacity)
  groups.push({
    id: 'transform',
    kind: 'transform',
    label: 'Transform',
    collapsed: false,
    properties: [
      { key: 'x', label: 'Position X', value: t.x ?? 0, type: 'number', step: 0.1, hasKeyframes: keyframedProps.has('x'), opType: 'motion.setObjectTransform', opPayload: { objectId: obj.id } },
      { key: 'y', label: 'Position Y', value: t.y ?? 0, type: 'number', step: 0.1, hasKeyframes: keyframedProps.has('y'), opType: 'motion.setObjectTransform', opPayload: { objectId: obj.id } },
      { key: 'z', label: 'Position Z', value: t.z ?? 0, type: 'number', step: 0.01, min: -100, max: 100, hasKeyframes: keyframedProps.has('z'), opType: 'motion.setObjectTransform', opPayload: { objectId: obj.id } },
      { key: 'rotationZ', label: 'Rotation Z', value: t.rotationZ ?? 0, type: 'number', step: 0.5, min: -360, max: 360, hasKeyframes: keyframedProps.has('rotationZ'), opType: 'motion.setObjectTransform', opPayload: { objectId: obj.id } },
      { key: 'scaleX', label: 'Scale X', value: t.scaleX ?? 1, type: 'number', step: 0.01, min: 0, max: 10, hasKeyframes: keyframedProps.has('scaleX'), opType: 'motion.setObjectTransform', opPayload: { objectId: obj.id } },
      { key: 'scaleY', label: 'Scale Y', value: t.scaleY ?? 1, type: 'number', step: 0.01, min: 0, max: 10, hasKeyframes: keyframedProps.has('scaleY'), opType: 'motion.setObjectTransform', opPayload: { objectId: obj.id } },
      { key: 'opacity', label: 'Opacity', value: t.opacity ?? 1, type: 'number', step: 0.01, min: 0, max: 1, hasKeyframes: keyframedProps.has('opacity'), opType: 'motion.setObjectTransform', opPayload: { objectId: obj.id } },
    ],
  });

  // Depth group
  groups.push({
    id: 'depth',
    kind: 'depth',
    label: '2.5D Depth',
    collapsed: false,
    properties: [
      { key: 'depth', label: 'Depth', value: obj.depth ?? 0, type: 'number', step: 0.01, min: -1, max: 1, hasKeyframes: keyframedProps.has('depth'), opType: 'motion.setObjectProp', opPayload: { objectId: obj.id } },
      { key: 'visible', label: 'Visible', value: obj.visible, type: 'boolean', hasKeyframes: false, opType: 'motion.setObjectProp', opPayload: { objectId: obj.id } },
      { key: 'locked', label: 'Locked', value: obj.locked, type: 'boolean', hasKeyframes: false, opType: 'motion.setObjectProp', opPayload: { objectId: obj.id } },
    ],
  });

  // Material group — engine uses materialId reference, show if materialId set
  if (obj.materialId) {
    groups.push({
      id: 'material',
      kind: 'material',
      label: 'Material',
      collapsed: false,
      properties: [
        { key: 'materialId', label: 'Material ID', value: obj.materialId, type: 'string', hasKeyframes: false, opType: 'motion.setObjectProp', opPayload: { objectId: obj.id } },
      ],
    });
  }

  // Behaviors group
  if (obj.behaviors && obj.behaviors.length > 0) {
    groups.push({
      id: 'behaviors',
      kind: 'behaviors',
      label: `Behaviors (${obj.behaviors.length})`,
      collapsed: true,
      properties: obj.behaviors.map((beh) => ({
        key: `beh.${beh.id}.type`,
        label: beh.type,
        value: `${toSeconds(beh.startTime).toFixed(1)}s → ${(toSeconds(beh.startTime) + toSeconds(beh.duration)).toFixed(1)}s`,
        type: 'string' as const,
        hasKeyframes: false,
        opType: 'motion.setBehaviorParam',
        opPayload: { objectId: obj.id, behaviorId: beh.id },
      })),
    });
  }

  // Masks group
  if (obj.masks && obj.masks.length > 0) {
    groups.push({
      id: 'masks',
      kind: 'masks',
      label: `Masks (${obj.masks.length})`,
      collapsed: true,
      properties: obj.masks.map((mask) => ({
        key: `mask.${mask.id}.shape`,
        label: mask.shape,
        value: `feather: ${mask.feather.toFixed(1)} opacity: ${(mask.opacity * 100).toFixed(0)}%`,
        type: 'string' as const,
        hasKeyframes: false,
        opType: 'motion.setMask',
        opPayload: { objectId: obj.id, maskId: mask.id },
      })),
    });
  }

  return groups;
}

// ─────────────────────────────────────────────────────────────
// CONTRIBUTION TRACE VIEW MODELS
// Used by: ContributionTracePanel
// ─────────────────────────────────────────────────────────────

export interface ContributionTraceNodeViewModel {
  id: string;
  timestamp: number;
  actor: string;
  description: string;
  opsApplied: number;
  /** Relative time label */
  timeLabel: string;
  /** Actor color */
  actorColor: string;
  /** Whether this is the most recent entry */
  isLatest: boolean;
}

export interface ContributionTracePanelViewModel {
  nodes: ContributionTraceNodeViewModel[];
  totalOps: number;
  hasTrace: boolean;
}

const ACTOR_COLORS: Record<string, string> = {
  user: '#3b82f6',
  ai: '#a855f7',
  system: '#64748b',
  template: '#10b981',
};

/**
 * Build ContributionTracePanel view model from canonical doc metadata.
 * MotionDocument does not have a contributionTrace field — returns empty trace.
 * Trace data is derived from Studio undo history instead.
 */
export function buildContributionTraceViewModel(
  doc: MotionDocument
): ContributionTracePanelViewModel {
  // MotionDocument does not carry a contributionTrace field.
  // Trace is available via Studio undo history (engine.opHistory).
  // Return empty — ContributionTracePanel shows "No trace data yet" until edits are made.
  return { nodes: [], totalOps: 0, hasTrace: false };
}

// ─────────────────────────────────────────────────────────────
// CANVAS PREVIEW RENDER MODEL
// Used by: MAViewer / CanvasPreview
// ─────────────────────────────────────────────────────────────

export interface CanvasObjectRenderModel {
  id: string;
  kind: MotionObject['kind'];
  /** CSS-ready position as percentage of canvas */
  leftPct: number;
  topPct: number;
  /** CSS transform string */
  cssTransform: string;
  opacity: number;
  zIndex: number;
  /** For text objects */
  textContent?: string;
  /** For image/video objects */
  assetRef?: string;
  /** For SVG objects */
  svgData?: string;
  /** Material color as hex */
  materialColor?: string;
  materialType?: string;
  blendMode?: string;
}

export interface CanvasRenderModel {
  objects: CanvasObjectRenderModel[];
  camera?: {
    fov: number;
    positionX: number;
    positionY: number;
    positionZ: number;
  };
  /** Document dimensions */
  width: number;
  height: number;
  /** Whether this is a real evaluated frame or empty */
  hasContent: boolean;
}

/**
 * Build canvas render model from canonical FrameState.
 *
 * MotionDocument + FrameState
 * → CanvasRenderModel
 *
 * Uses flat engine MotionTransform (x, y, scaleX, scaleY, rotationZ, opacity).
 */
export function buildCanvasRenderModel(
  doc: MotionDocument,
  frameState: FrameState | null
): CanvasRenderModel {
  if (!frameState || frameState.objects.length === 0) {
    return { objects: [], width: doc.width, height: doc.height, hasContent: false };
  }

  const renderObjects = (states: MotionObjectState[]): CanvasObjectRenderModel[] => {
    const result: CanvasObjectRenderModel[] = [];
    for (const obj of states) {
      // Engine uses flat MotionTransform: x, y, scaleX, scaleY, rotationZ, opacity
      const t = obj.worldTransform;
      const leftPct = 50 + (t.x / doc.width) * 100;
      const topPct = 50 + (t.y / doc.height) * 100;
      const cssTransform = [
        'translate(-50%, -50%)',
        `scale(${t.scaleX}, ${t.scaleY})`,
        `rotate(${t.rotationZ}deg)`,
      ].join(' ');

      result.push({
        id: obj.objectId,
        kind: obj.kind,
        leftPct,
        topPct,
        cssTransform,
        opacity: obj.opacity,
        zIndex: 50 + Math.round(obj.depth * 10),
        textContent: obj.textContent,
        assetRef: obj.assetRef,
        svgData: obj.svgData,
        blendMode: obj.blendMode,
      });
    }
    return result;
  };

  const objects = renderObjects(frameState.objects);

  // Active camera from doc.cameras (plural Record)
  const activeCam = doc.activeCameraId ? doc.cameras?.[doc.activeCameraId] : undefined;
  const camera = activeCam
    ? {
        fov: activeCam.fov,
        positionX: activeCam.transform.x,
        positionY: activeCam.transform.y,
        positionZ: activeCam.transform.z,
      }
    : undefined;

  return { objects, camera, width: doc.width, height: doc.height, hasContent: objects.length > 0 };
}

// ─────────────────────────────────────────────────────────────
// TRANSPORT VIEW MODEL
// Used by: Motion Animator transport bar
// ─────────────────────────────────────────────────────────────

export interface TransportViewModel {
  /** Clip-local time in seconds (derived from canonical RationalTime) */
  localTimeSecs: number;
  /** Document duration in seconds */
  durationSecs: number;
  /** Normalized progress [0..1] */
  progress: number;
  /** Formatted timecode string */
  timecode: string;
  /** Formatted duration string */
  durationTimecode: string;
  /** FPS */
  fps: number;
  /** Whether this is authoring-local (always true for Motion Animator) */
  isAuthoringLocal: true;
}

function formatTimecode(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = (secs % 60).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
}

/**
 * Build transport view model from canonical time values.
 * The localTimeSecs is always derived from Studio RationalTime → clip-local conversion.
 */
export function buildTransportViewModel(
  localTimeSecs: number,
  doc: MotionDocument
): TransportViewModel {
  const durationSecs = toSeconds(doc.duration);
  return {
    localTimeSecs,
    durationSecs,
    progress: durationSecs > 0 ? Math.max(0, Math.min(1, localTimeSecs / durationSecs)) : 0,
    timecode: formatTimecode(localTimeSecs),
    durationTimecode: formatTimecode(durationSecs),
    fps: doc.fps,
    isAuthoringLocal: true,
  };
}

// ─────────────────────────────────────────────────────────────
// EVALUATION DIAGNOSTICS VIEW MODEL
// Used by: DiagnosticsPanel / EvaluationTracePanel
// ─────────────────────────────────────────────────────────────

export interface MotionEvalDiagnostics {
  evaluationTimeMs: number;
  objectCount: number;
  keyframeCount: number;
  behaviorCount: number;
  signalCount: number;
  warnings: string[];
  errors: string[];
}

export interface EvalDiagnosticsViewModel {
  evaluationTimeMs: number;
  objectCount: number;
  keyframeCount: number;
  behaviorCount: number;
  signalCount: number;
  warnings: string[];
  errors: string[];
  hasWarnings: boolean;
  hasErrors: boolean;
  performanceLabel: 'fast' | 'ok' | 'slow';
}

export function buildEvalDiagnosticsViewModel(
  diag: MotionEvalDiagnostics | undefined
): EvalDiagnosticsViewModel {
  if (!diag) {
    return {
      evaluationTimeMs: 0,
      objectCount: 0,
      keyframeCount: 0,
      behaviorCount: 0,
      signalCount: 0,
      warnings: [],
      errors: [],
      hasWarnings: false,
      hasErrors: false,
      performanceLabel: 'fast',
    };
  }
  return {
    ...diag,
    hasWarnings: diag.warnings.length > 0,
    hasErrors: diag.errors.length > 0,
    performanceLabel:
      diag.evaluationTimeMs < 2 ? 'fast' : diag.evaluationTimeMs < 8 ? 'ok' : 'slow',
  };
}

// ─────────────────────────────────────────────────────────────
// SELECTION MODEL
// One selection truth shared by timeline/canvas/inspector/curves/dope/trace
// ─────────────────────────────────────────────────────────────

export interface MotionSelectionState {
  /** The one selected object ID — shared by all panels */
  selectedObjectId: string | null;
  /** Selected keyframe IDs (for curve editor / dope sheet) */
  selectedKeyframeIds: Set<string>;
  /** Selected graph curve track IDs */
  selectedCurveTrackIds: Set<string>;
}

export function createMotionSelectionState(
  initialObjectId: string | null = null
): MotionSelectionState {
  return {
    selectedObjectId: initialObjectId,
    selectedKeyframeIds: new Set(),
    selectedCurveTrackIds: new Set(),
  };
}

export function selectObject(
  state: MotionSelectionState,
  objectId: string | null
): MotionSelectionState {
  if (state.selectedObjectId === objectId) return state;
  return {
    selectedObjectId: objectId,
    selectedKeyframeIds: new Set(),
    selectedCurveTrackIds: new Set(),
  };
}

export function toggleKeyframeSelection(
  state: MotionSelectionState,
  keyframeId: string,
  additive: boolean
): MotionSelectionState {
  const next = additive ? new Set(state.selectedKeyframeIds) : new Set<string>();
  if (next.has(keyframeId)) next.delete(keyframeId); else next.add(keyframeId);
  return { ...state, selectedKeyframeIds: next };
}
