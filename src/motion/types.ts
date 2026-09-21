/**
 * CutLab Motion Core Types
 * Canonical type definitions for the Motion engine.
 * These types are the contract between Studio and Motion.
 */

// ── Rational Time ─────────────────────────────────────────────

export interface MotionRationalTime {
  value: number;
  timescale: number;
}

export function motionTimeToSeconds(t: MotionRationalTime): number {
  return t.value / t.timescale;
}

export function secondsToMotionTime(secs: number, timescale = 30000): MotionRationalTime {
  return { value: Math.round(secs * timescale), timescale };
}

export function motionTimeAdd(a: MotionRationalTime, b: MotionRationalTime): MotionRationalTime {
  const ts = Math.max(a.timescale, b.timescale);
  return { value: Math.round(a.value * (ts / a.timescale)) + Math.round(b.value * (ts / b.timescale)), timescale: ts };
}

export function motionTimeSub(a: MotionRationalTime, b: MotionRationalTime): MotionRationalTime {
  const ts = Math.max(a.timescale, b.timescale);
  return { value: Math.round(a.value * (ts / a.timescale)) - Math.round(b.value * (ts / b.timescale)), timescale: ts };
}

export function motionTimeNormalize(t: MotionRationalTime, durationSecs: number): number {
  if (durationSecs <= 0) return 0;
  return Math.max(0, Math.min(1, motionTimeToSeconds(t) / durationSecs));
}

// ── Motion Object Types ───────────────────────────────────────

export type MotionObjectKind =
  | 'text' | 'shape' | 'image' | 'video' | 'group' | 'camera' |'light' | 'particle' | 'path' | 'mask' | 'null' | 'svg';

export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' |'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light' | 'difference'
  | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';

export interface MotionVec2 { x: number; y: number }
export interface MotionVec3 { x: number; y: number; z: number }
export interface MotionColor { r: number; g: number; b: number; a: number }

export function hexToMotionColor(hex: string): MotionColor {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return { r, g, b, a: 1 };
}

export function motionColorToHex(c: MotionColor): string {
  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`;
}

// ── Motion Transform ──────────────────────────────────────────

export interface MotionTransform {
  position: MotionVec3;
  rotation: MotionVec3;
  scale: MotionVec3;
  anchor: MotionVec3;
  opacity: number;
}

export const DEFAULT_MOTION_TRANSFORM: MotionTransform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  anchor: { x: 0, y: 0, z: 0 },
  opacity: 1,
};

// ── Motion Keyframe ───────────────────────────────────────────

export type MotionEasing =
  | 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold' |'spring' | 'bounce' | 'elastic';

export interface MotionKeyframe {
  id: string;
  time: MotionRationalTime;
  property: string;
  value: number | string | MotionVec2 | MotionVec3 | MotionColor;
  easing: MotionEasing;
  easingParams?: { tension?: number; friction?: number; amplitude?: number };
}

// ── Motion Material ───────────────────────────────────────────

export type MaterialType = 'flat' | 'gradient' | 'image' | 'video' | 'procedural' | 'glass' | 'metal' | 'neon';

export interface MotionMaterial {
  id: string;
  type: MaterialType;
  color?: MotionColor;
  gradientStops?: Array<{ color: MotionColor; position: number }>;
  gradientAngle?: number;
  imageRef?: string;
  opacity?: number;
  blendMode?: BlendMode;
  /** Procedural material params */
  params?: Record<string, number | string | boolean>;
}

// ── Motion Text ───────────────────────────────────────────────

export interface MotionTextSegment {
  id: string;
  text: string;
  /** Word-level timing for choreography */
  wordTimings?: Array<{
    wordId: string;
    text: string;
    startTime: MotionRationalTime;
    endTime: MotionRationalTime;
    emphasis?: number;
  }>;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  letterSpacing?: number;
  lineHeight?: number;
  textAlign?: 'left' | 'center' | 'right';
  material?: MotionMaterial;
  /** Per-character animation */
  charAnimation?: MotionBehavior;
  /** Per-word animation */
  wordAnimation?: MotionBehavior;
}

// ── Motion Behavior ───────────────────────────────────────────

export type BehaviorType =
  | 'fade-in' | 'fade-out' | 'slide-in' | 'slide-out' | 'scale-in' | 'scale-out' |'wipe-in'| 'wipe-out' | 'blur-in' | 'blur-out' | 'bounce-in' | 'typewriter' |'word-by-word'| 'char-by-char' | 'wave' | 'shake' | 'pulse' | 'spin' |'signal-reactive' | 'custom';

export interface MotionBehavior {
  id: string;
  type: BehaviorType;
  startTime: MotionRationalTime;
  duration: MotionRationalTime;
  params: Record<string, number | string | boolean>;
  /** Signal binding — which signal drives this behavior */
  signalBinding?: string;
  /** Easing for the behavior */
  easing?: MotionEasing;
}

// ── Motion Mask ───────────────────────────────────────────────

export type MotionMaskShape = 'rectangle' | 'ellipse' | 'path' | 'subject' | 'luma' | 'alpha';

export interface MotionMask {
  id: string;
  shape: MotionMaskShape;
  inverted: boolean;
  feather: number;
  opacity: number;
  /** For rectangle/ellipse */
  bounds?: { x: number; y: number; width: number; height: number };
  /** For path masks */
  pathData?: string;
  /** For subject masks — references a subject tracking resource */
  subjectRef?: string;
  /** Animated via keyframes */
  keyframes?: MotionKeyframe[];
}

// ── Motion Rig / Relation ─────────────────────────────────────

export type RigType =
  | 'parent-child' | 'look-at' | 'path-follow' | 'expression' |'spring-constraint' | 'aim-constraint' | 'position-constraint';

export interface MotionRig {
  id: string;
  type: RigType;
  sourceObjectId: string;
  targetObjectId: string;
  params: Record<string, number | string | boolean>;
}

// ── Motion Object ─────────────────────────────────────────────

export interface MotionObject {
  id: string;
  kind: MotionObjectKind;
  name: string;
  parentId?: string;
  /** Z-depth for 2.5D layering */
  depth: number;
  transform: MotionTransform;
  keyframes: MotionKeyframe[];
  behaviors: MotionBehavior[];
  masks: MotionMask[];
  material?: MotionMaterial;
  /** For text objects */
  textSegments?: MotionTextSegment[];
  /** For image/video objects */
  assetRef?: string;
  /** For SVG objects */
  svgData?: string;
  /** For group objects */
  children?: string[]; // child object IDs
  /** Blend mode */
  blendMode?: BlendMode;
  /** Whether this object casts/receives occlusion */
  occlusionRole?: 'subject' | 'foreground' | 'background' | 'none';
  /** Subject tracking reference */
  subjectRef?: string;
  /** Visibility */
  visible: boolean;
  /** Lock */
  locked: boolean;
  /** Tags */
  tags?: string[];
}

// ── Motion Camera ─────────────────────────────────────────────

export interface MotionCamera {
  id: string;
  name: string;
  transform: MotionTransform;
  keyframes: MotionKeyframe[];
  fov: number;
  near: number;
  far: number;
  /** Depth-of-field */
  dof?: { enabled: boolean; focalDistance: number; aperture: number; blurRadius: number };
}

// ── Motion Signal ─────────────────────────────────────────────

export type SignalKind =
  | 'audio-rms' | 'audio-low' | 'audio-mid' | 'audio-high' |'audio-beat'| 'audio-onset' | 'audio-transient' | 'audio-tempo' |'speech-timing'| 'semantic-emphasis' |'subject-bounds'| 'subject-matte' | 'subject-tracking' |'marker' | 'cue' | 'manual' | 'expression';

export interface MotionSignal {
  id: string;
  kind: SignalKind;
  name: string;
  /** Source resource reference (e.g. asset ID for audio signals) */
  sourceRef?: string;
  /** Normalization range */
  range?: { min: number; max: number };
  /** Sample data for deterministic testing */
  sampleData?: number[];
  /** Expression for computed signals */
  expression?: string;
}

// ── Motion Document ───────────────────────────────────────────

export interface MotionDocument {
  /** Stable ID — referenced by Studio Clip.motionDocumentId */
  id: string;
  /** Human name */
  name: string;
  /** Schema version */
  schemaVersion: number;
  /** Duration in rational time */
  duration: MotionRationalTime;
  /** Frame rate */
  fps: number;
  /** Canvas size */
  width: number;
  height: number;
  /** All objects in this document */
  objects: Record<string, MotionObject>;
  /** Root object order (z-sorted) */
  rootObjectIds: string[];
  /** Camera */
  camera?: MotionCamera;
  /** Signals available to this document */
  signals: Record<string, MotionSignal>;
  /** Rigs / relations */
  rigs: MotionRig[];
  /** Template generator ID if created from template */
  templateId?: string;
  /** Template parameters used at creation */
  templateParams?: Record<string, string | number | boolean>;
  /** SVG source if imported */
  svgSource?: string;
  /** Authoring metadata */
  createdAt: number;
  updatedAt: number;
  /** Contribution trace for AI/diagnostics */
  contributionTrace?: MotionContributionTrace;
}

export const MOTION_SCHEMA_VERSION = 1;

// ── Frame State ───────────────────────────────────────────────

export interface MotionObjectState {
  objectId: string;
  kind: MotionObjectKind;
  /** Evaluated world transform */
  worldTransform: MotionTransform;
  /** Evaluated opacity (0..1) */
  opacity: number;
  /** Evaluated material */
  material?: MotionMaterial;
  /** Evaluated text content */
  textContent?: string;
  /** Evaluated text segments with word states */
  textSegments?: Array<{
    text: string;
    opacity: number;
    transform: MotionTransform;
    material?: MotionMaterial;
  }>;
  /** Evaluated masks */
  masks: MotionMask[];
  /** Depth for compositor */
  depth: number;
  /** Blend mode */
  blendMode?: BlendMode;
  /** Occlusion role */
  occlusionRole?: MotionObject['occlusionRole'];
  /** Asset reference for image/video */
  assetRef?: string;
  /** SVG data for svg objects */
  svgData?: string;
  /** Children (for groups) */
  children?: MotionObjectState[];
  /** Visibility */
  visible: boolean;
}

export interface FrameState {
  /** Clip-local time in seconds */
  localTimeSecs: number;
  /** Normalized tau [0..1] */
  tau: number;
  /** Evaluated object states */
  objects: MotionObjectState[];
  /** Camera state */
  camera?: {
    transform: MotionTransform;
    fov: number;
    dof?: { enabled: boolean; focalDistance: number; aperture: number; blurRadius: number };
  };
  /** Active signal values at this frame */
  signalValues: Record<string, number>;
  /** Evaluation diagnostics */
  diagnostics?: MotionEvalDiagnostics;
}

// ── Motion Transaction ────────────────────────────────────────

export type MotionOpType =
  | 'motion.setObjectProp' |'motion.setObjectTransform' |'motion.addObject' |'motion.removeObject' |'motion.reorderObjects' |'motion.upsertKeyframe' |'motion.removeKeyframe' |'motion.addBehavior' |'motion.removeBehavior' |'motion.setBehaviorParam' |'motion.setMaterial' |'motion.addMask' |'motion.removeMask' |'motion.setMask' |'motion.addRig' |'motion.removeRig' |'motion.upsertSignal' |'motion.removeSignal' |'motion.setDocumentProp' |'motion.setTextSegment' |'motion.setCamera' |'motion.upsertDocument';

export interface MotionOp {
  opId: string;
  type: MotionOpType;
  documentId: string;
  payload: Record<string, unknown>;
  actor?: 'user' | 'ai' | 'system' | 'template';
  createdAt: number;
}

export interface MotionTransaction {
  id: string;
  description: string;
  ops: MotionOp[];
  /** Snapshot before this transaction (for undo) */
  beforeSnapshot?: MotionDocument;
  /** Snapshot after this transaction */
  afterSnapshot?: MotionDocument;
  createdAt: number;
}

// ── Evaluation Trace ──────────────────────────────────────────

export interface MotionEvalDiagnostics {
  evaluationTimeMs: number;
  objectCount: number;
  keyframeCount: number;
  behaviorCount: number;
  signalCount: number;
  warnings: string[];
  errors: string[];
}

export interface MotionContributionTrace {
  entries: Array<{
    timestamp: number;
    actor: string;
    description: string;
    opsApplied: number;
  }>;
}

// ── Capability Tool ───────────────────────────────────────────

export interface MotionCapabilityTool {
  id: string;
  name: string;
  description: string;
  category: 'text' | 'shape' | 'camera' | 'signal' | 'template' | 'behavior' | 'material' | 'mask' | 'rig' | 'utility';
  /** Parameter schema */
  params: Array<{
    key: string;
    type: 'string' | 'number' | 'boolean' | 'color' | 'vec2' | 'vec3' | 'select';
    label: string;
    defaultValue: string | number | boolean;
    options?: string[];
    min?: number;
    max?: number;
  }>;
  /** Execute the tool — returns MotionOps to apply */
  execute: (doc: MotionDocument, params: Record<string, unknown>) => MotionOp[];
}

// ── Template Generator ────────────────────────────────────────

export interface MotionTemplateGenerator {
  id: string;
  name: string;
  family: string;
  description: string;
  tags: string[];
  defaultDurationSecs: number;
  /** Generate a MotionDocument from params */
  generate: (params: MotionTemplateParams) => MotionDocument;
  /** Preview thumbnail gradient */
  previewGradient?: string;
  /** Accent color */
  accentColor?: string;
}

export interface MotionTemplateParams {
  id: string;
  name?: string;
  durationSecs?: number;
  width?: number;
  height?: number;
  fps?: number;
  /** Text content */
  text?: string;
  subText?: string;
  /** Colors */
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  /** Signal bindings */
  signalBindings?: Record<string, string>;
  /** Custom params */
  custom?: Record<string, string | number | boolean>;
}
