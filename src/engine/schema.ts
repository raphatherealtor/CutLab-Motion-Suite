/**
 * CutLab ProjectState Schema v2 — Extended with MotionDocuments
 * Adds motionDocuments to ProjectData and motion.document.patch to reducer.
 */

import type { RationalTime } from './time';

export const SCHEMA_VERSION = 2;

// ── Asset ──────────────────────────────────────────────────────

export type AssetCaste =
  | 'original' | 'proxy' | 'relinked' | 'plate' | 'missing' | 'failed' | 'stub';

export interface Asset {
  id: string;
  name: string;
  kind: 'video' | 'audio' | 'image' | 'motion-bundle' | 'graphic';
  caste: AssetCaste;
  /** Stable identity — NOT a blob URL. Could be a file path, UUID, or content hash. */
  sourceRef: string;
  /** Runtime-only handle, not persisted as canonical identity */
  runtimeUrl?: string;
  durationFrames?: number;
  fps?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  sampleRate?: number;
  channels?: number;
  /** File size in bytes */
  fileSize?: number;
  /** MIME type */
  mimeType?: string;
  /** Waveform peak data — optional, computed separately, NOT in undo ops */
  waveformPeaks?: number[];
  /** Transcript word timings */
  transcriptWords?: TranscriptWord[];
  /** Tags for search/sort */
  tags?: string[];
  /** User-assigned color label */
  colorLabel?: string;
  /** When ingested */
  ingestedAt?: number;
}

// ── Transcript ─────────────────────────────────────────────────

export interface TranscriptWord {
  id: string;
  text: string;
  startTime: RationalTime;
  endTime: RationalTime;
  confidence?: number;
  speaker?: string;
  speakerLabel?: string;
  isFiller?: boolean;
  isDeadAir?: boolean;
  /** Stable word index within asset */
  wordIndex?: number;
}

// ── Keyframe ───────────────────────────────────────────────────

export type EasingType = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold';

export interface Keyframe {
  id: string;
  time: RationalTime; // relative to clip start
  property: string;
  value: number | string;
  easing: EasingType;
}

// ── Effect ─────────────────────────────────────────────────────

export type EffectType =
  | 'transform' | 'crop' | 'opacity' | 'blur' | 'brightness'
  | 'contrast'| 'saturation' | 'vignette' | 'sharpen' |'color-temperature' | 'tint' | 'exposure' | 'custom';

export interface Effect {
  id: string;
  type: EffectType | string;
  enabled: boolean;
  params: Record<string, number | string | boolean>;
  order: number;
  /** Region/mask ID this effect targets (optional) */
  maskId?: string;
  /** Whether params are keyframe-eligible */
  keyframeEligible?: boolean;
}

// ── Mask / Region ──────────────────────────────────────────────

export type MaskShape = 'rectangle' | 'ellipse';

export interface Mask {
  id: string;
  shape: MaskShape;
  x: number;
  y: number;
  width: number;
  height: number;
  feather: number;
  invert: boolean;
  /** Rotation in degrees */
  rotation?: number;
}

// ── Transform ─────────────────────────────────────────────────

export interface Transform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  cropLeft: number;
  cropRight: number;
  cropTop: number;
  cropBottom: number;
}

export const DEFAULT_TRANSFORM: Transform = {
  x: 0, y: 0,
  scaleX: 1, scaleY: 1,
  rotation: 0,
  opacity: 1,
  cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0,
};

// ── Audio Fade ─────────────────────────────────────────────────

export interface AudioFade {
  type: 'linear' | 'exponential' | 'logarithmic';
  duration: RationalTime;
}

// ── Caption Style ──────────────────────────────────────────────

export interface CaptionStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  backgroundColor?: string;
  backgroundOpacity?: number;
  position?: 'bottom' | 'top' | 'middle' | 'custom';
  customX?: number;
  customY?: number;
  textAlign?: 'left' | 'center' | 'right';
  /** Style preset reference */
  presetId?: string;
}

// ── Clip ──────────────────────────────────────────────────────

export type ClipKind = 'video' | 'audio' | 'caption' | 'graphic' | 'motion';

export interface Clip {
  id: string;
  kind: ClipKind;
  trackId: string;
  assetId?: string;
  name: string;
  /** Position on timeline (sequence time) */
  startTime: RationalTime;
  /** Duration on timeline */
  duration: RationalTime;
  /** Source in-point */
  sourceIn: RationalTime;
  /** Source out-point */
  sourceOut: RationalTime;
  transform: Transform;
  keyframes: Keyframe[];
  effects: Effect[];
  masks: Mask[];
  /** Gain in dB (audio) */
  gain: number;
  /** Pan -1 to 1 */
  pan?: number;
  /** Fade in */
  fadeIn: RationalTime;
  /** Fade out */
  fadeOut: RationalTime;
  /** Fade curve types */
  fadeInType?: AudioFade['type'];
  fadeOutType?: AudioFade['type'];
  speed: number;
  reverse: boolean;
  freeze: boolean;
  freezeFrame?: RationalTime;
  /** Linked A/V group ID */
  linkGroupId?: string;
  /** Graphic/motion params */
  graphicParams?: Record<string, string | number | boolean>;
  /** Motion bundle ID */
  motionBundleId?: string;
  /** Canonical MotionDocument ID — preferred over motionBundleId */
  motionDocumentId?: string;
  /** Caption text (for caption clips) */
  captionText?: string;
  /** Caption style */
  captionStyle?: CaptionStyle;
  /** Transcript word IDs this clip covers */
  transcriptWordIds?: string[];
  disabled: boolean;
  /** Whether clip is part of a precomp */
  precompId?: string;
  /** Graphic type for graphic clips */
  graphicType?: 'title' | 'lower-third' | 'callout' | 'image' | 'shape' | 'stat-card' | 'logo';
  /** Cue references */
  cueIds?: string[];
  /** Z-order for graphics */
  zOrder?: number;
  /** Transition IDs attached to this clip */
  transitionInId?: string;
  transitionOutId?: string;
}

// ── Transition ────────────────────────────────────────────────

export type TransitionType =
  | 'cut' | 'cross-dissolve' | 'dip-to-black' | 'dip-to-white' |'fade-to-black' | 'fade-from-black' | 'audio-crossfade' | 'wipe';

export interface Transition {
  id: string;
  type: TransitionType;
  duration: RationalTime;
  /** Clip A (outgoing) */
  clipAId: string;
  /** Clip B (incoming) */
  clipBId: string;
  /** Which edge: 'out' of clipA / 'in' of clipB */
  edge: 'cut-point';
  params?: Record<string, number | string | boolean>;
}

// ── Precomp / Nested Sequence ──────────────────────────────────

export interface Precomp {
  id: string;
  name: string;
  /** The child sequence ID */
  sequenceId: string;
  /** Parent sequence ID */
  parentSequenceId: string;
  /** Clip ID in parent sequence that represents this precomp */
  parentClipId: string;
  createdAt: number;
}

// ── Semantic Cue ──────────────────────────────────────────────

export type CueSemanticType =
  | 'emphasis' | 'beat' | 'statistic' | 'chapter' | 'speaker-change' |'callout' | 'highlight' | 'transition-point' | 'custom';

export interface SemanticCue {
  id: string;
  type: CueSemanticType;
  /** Time range this cue covers */
  timeRange: { start: RationalTime; end: RationalTime };
  /** Optional references to other entities */
  transcriptWordId?: string;
  transcriptRangeStart?: string; // word ID
  transcriptRangeEnd?: string;   // word ID
  markerId?: string;
  clipId?: string;
  graphicId?: string;
  captionId?: string;
  /** Structured semantic payload */
  data?: Record<string, string | number | boolean>;
  label?: string;
}

// ── Track ─────────────────────────────────────────────────────

export type TrackKind = 'video' | 'audio' | 'caption' | 'motion' | 'graphic';

export interface Track {
  id: string;
  kind: TrackKind;
  label: string;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  hidden?: boolean;
  height: number;
  gain: number;
  pan?: number;
  order: number;
  /** Target track for insert operations */
  targeted: boolean;
  /** Audio role */
  audioRole?: 'dialogue' | 'music' | 'sfx' | 'ambient';
}

// ── Marker ────────────────────────────────────────────────────

export interface Marker {
  id: string;
  time: RationalTime;
  label: string;
  color?: string;
  /** Duration for range markers */
  duration?: RationalTime;
  /** Cue reference */
  cueId?: string;
}

// ── Caption ───────────────────────────────────────────────────

export interface Caption {
  id: string;
  startTime: RationalTime;
  endTime: RationalTime;
  text: string;
  speaker?: string;
  trackId: string;
  style?: CaptionStyle;
  /** Word-level timing for future dynamic presentation */
  wordTimings?: Array<{
    wordId: string;
    text: string;
    startTime: RationalTime;
    endTime: RationalTime;
    semanticMetadata?: Record<string, string | number | boolean>;
  }>;
}

// ── Sequence ──────────────────────────────────────────────────

export interface SequenceFormat {
  width: number;
  height: number;
  fps: number;
  /** fps timescale for NTSC: 30000/1001 → timescale=30000, value=1001 */
  fpsTimescale: number;
  sampleRate: number;
  channels: number;
}

export const DEFAULT_FORMAT: SequenceFormat = {
  width: 1920,
  height: 1080,
  fps: 29.97,
  fpsTimescale: 30000,
  sampleRate: 48000,
  channels: 2,
};

export interface Sequence {
  id: string;
  name: string;
  format: SequenceFormat;
  tracks: Track[];
  clips: Clip[];
  markers: Marker[];
  captions: Caption[];
  transitions: Transition[];
  cues: SemanticCue[];
  inPoint?: RationalTime;
  outPoint?: RationalTime;
  /** Precomp parent sequence ID */
  parentSequenceId?: string;
  /** Whether this sequence is a precomp child */
  isPrecomp?: boolean;
}

// ── Version ───────────────────────────────────────────────────

export interface ProjectVersion {
  id: string;
  label: string;
  revision: number;
  createdAt: number; // epoch ms
  snapshotJson: string; // serialized ProjectData at this version
}

// ── Op History ────────────────────────────────────────────────

export interface OpRecord {
  opId: string;
  type: string;
  revision: number;
  createdAt: number;
}

// ── ProjectData (the serializable canonical state) ────────────

export interface ProjectData {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  assets: Record<string, Asset>;
  sequences: Record<string, Sequence>;
  activeSequenceId: string;
  precomps: Record<string, Precomp>;
  /** MotionDocuments — keyed by id, referenced by Clip.motionDocumentId / Clip.motionBundleId */
  motionDocuments: Record<string, import('./motion-document').MotionDocument>;
  versions: ProjectVersion[];
  opHistory: OpRecord[];
  exportPresets: Record<string, ExportPreset>;
  audioPresets: Record<string, AudioPreset>;
  settings: ProjectSettings;
  /** Migration seam */
  migrations?: string[];
}

export interface ExportPreset {
  id: string;
  name: string;
  codec: string;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  audioBitrate?: number;
  audioCodec?: string;
  container?: string;
}

export interface AudioPreset {
  id: string;
  name: string;
  targetLufs: number;
  truePeak: number;
  role?: 'dialogue' | 'music' | 'sfx';
}

export interface ProjectSettings {
  autoSaveIntervalMs: number;
  defaultPadMs: number;
  snapEnabled: boolean;
  rippleEnabled: boolean;
  defaultCaptionStyle?: CaptionStyle;
  timelineZoom?: number;
}

// ── Default project factory ───────────────────────────────────

export function createDefaultProject(name: string = 'Untitled Project'): ProjectData {
  const now = Date.now();
  const projectId = generateId('proj');
  const seqId = generateId('seq');
  const tracks: Track[] = [
    { id: generateId('track'), kind: 'video', label: 'V1', muted: false, solo: false, locked: false, height: 56, gain: 0, order: 0, targeted: true },
    { id: generateId('track'), kind: 'video', label: 'V2', muted: false, solo: false, locked: false, height: 40, gain: 0, order: 1, targeted: false },
    { id: generateId('track'), kind: 'audio', label: 'A1', muted: false, solo: false, locked: false, height: 48, gain: 0, order: 2, targeted: true, audioRole: 'dialogue' },
    { id: generateId('track'), kind: 'audio', label: 'A2', muted: false, solo: false, locked: false, height: 40, gain: 0, order: 3, targeted: false, audioRole: 'music' },
    { id: generateId('track'), kind: 'graphic', label: 'G1', muted: false, solo: false, locked: false, height: 36, gain: 0, order: 4, targeted: false },
    { id: generateId('track'), kind: 'motion', label: 'MOT', muted: false, solo: false, locked: false, height: 36, gain: 0, order: 5, targeted: false },
    { id: generateId('track'), kind: 'caption', label: 'CAP', muted: false, solo: false, locked: false, height: 28, gain: 0, order: 6, targeted: false },
  ];

  const seq: Sequence = {
    id: seqId,
    name: 'Main Sequence',
    format: DEFAULT_FORMAT,
    tracks,
    clips: [],
    markers: [],
    captions: [],
    transitions: [],
    cues: [],
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    id: projectId,
    name,
    createdAt: now,
    updatedAt: now,
    revision: 0,
    assets: {},
    sequences: { [seqId]: seq },
    activeSequenceId: seqId,
    precomps: {},
    motionDocuments: {},
    versions: [],
    opHistory: [],
    exportPresets: {
      'preset-h264-1080p': {
        id: 'preset-h264-1080p',
        name: 'H.264 1080p',
        codec: 'h264',
        width: 1920,
        height: 1080,
        fps: 29.97,
        bitrate: 8000000,
        audioBitrate: 192000,
        audioCodec: 'aac',
        container: 'mp4',
      },
      'preset-h264-720p': {
        id: 'preset-h264-720p',
        name: 'H.264 720p',
        codec: 'h264',
        width: 1280,
        height: 720,
        fps: 29.97,
        bitrate: 4000000,
        audioBitrate: 128000,
        audioCodec: 'aac',
        container: 'mp4',
      },
      'preset-social-916': {
        id: 'preset-social-916',
        name: 'Social 9:16',
        codec: 'h264',
        width: 1080,
        height: 1920,
        fps: 29.97,
        bitrate: 6000000,
        audioBitrate: 192000,
        audioCodec: 'aac',
        container: 'mp4',
      },
      'preset-webm-1080p': {
        id: 'preset-webm-1080p',
        name: 'WebM 1080p',
        codec: 'vp9',
        width: 1920,
        height: 1080,
        fps: 29.97,
        bitrate: 6000000,
        audioBitrate: 192000,
        audioCodec: 'opus',
        container: 'webm',
      },
    },
    audioPresets: {
      'audio-dialogue': {
        id: 'audio-dialogue',
        name: 'Dialogue',
        targetLufs: -23,
        truePeak: -1,
        role: 'dialogue',
      },
    },
    settings: {
      autoSaveIntervalMs: 30000,
      defaultPadMs: 60,
      snapEnabled: true,
      rippleEnabled: false,
    },
    migrations: [],
  };
}

let _idCounter = 0;
export function generateId(prefix: string = 'id'): string {
  _idCounter++;
  return `${prefix}-${Date.now()}-${_idCounter}`;
}

// ── Schema migration ──────────────────────────────────────────

export function migrateProject(data: Partial<ProjectData>): ProjectData {
  const base = createDefaultProject(data.name || 'Untitled Project');
  const merged: ProjectData = {
    ...base,
    ...data,
    schemaVersion: SCHEMA_VERSION,
    precomps: data.precomps || {},
    motionDocuments: data.motionDocuments || {},
    migrations: [...(data.migrations || []), `migrated-to-v${SCHEMA_VERSION}`],
  };
  // Ensure all sequences have transitions and cues arrays
  for (const seqId of Object.keys(merged.sequences)) {
    const seq = merged.sequences[seqId];
    if (!seq.transitions) merged.sequences[seqId] = { ...seq, transitions: [] };
    if (!seq.cues) merged.sequences[seqId] = { ...merged.sequences[seqId], cues: [] };
    // Ensure all clips have masks array and motionDocumentId compatibility
    merged.sequences[seqId] = {
      ...merged.sequences[seqId],
      clips: merged.sequences[seqId].clips.map((c) => ({
        ...c,
        masks: c.masks || [],
        effects: c.effects || [],
        keyframes: c.keyframes || [],
        // Migrate: if motionBundleId set but motionDocumentId not, copy it
        motionDocumentId: c.motionDocumentId ?? c.motionBundleId,
      })),
    };
  }
  return merged;
}

function MotionDocumentResource(..._args: unknown[]): null {
  return null;
}

export { MotionDocumentResource };