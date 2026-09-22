/**
 * CutLab Canonical Operation Model v2
 * Every persistent edit is an Operation envelope.
 * (state, op) → new state
 * One mutation door. Idempotent opId. expectedRevision stale-state protection.
 */

import type {
  Clip, Track, Asset, Marker, Caption, Sequence, Keyframe, Effect,
  TranscriptWord, Transition, Precomp, SemanticCue, Mask
} from './schema';
import type { RationalTime } from './time';
import type { MotionDocument, MotionTransaction } from './motion-document';
import { generateId } from './schema';

// ── Operation envelope ────────────────────────────────────────

export interface OpEnvelope {
  opId: string;
  type: OpType;
  payload: OpPayload;
  expectedRevision?: number; // stale-state protection
  actor?: 'user' | 'skill' | 'ai' | 'system';
  createdAt?: number;
}

export type OpType =
  // Assets
  | 'asset.register' | 'asset.setProps' | 'asset.remove' | 'asset.relink'
  // Clips
  | 'clip.add' | 'clip.move' | 'clip.trim' | 'clip.split' | 'clip.delete'
  | 'clip.rippleDelete'| 'clip.link' | 'clip.unlink' | 'clip.duplicate' |'clip.setProps' | 'clip.setTransform' | 'clip.setGain' | 'clip.setSpeed'
  | 'clip.setFreeze'| 'clip.addEffect' | 'clip.removeEffect' | 'clip.setEffect' |'clip.reorderEffect'| 'clip.addMask' | 'clip.removeMask' | 'clip.setMask' |'clip.enable' | 'clip.disable'
  // Keyframes
  | 'keyframe.upsert' | 'keyframe.remove' | 'keyframe.move' | 'keyframe.setEasing'
  // Tracks
  | 'track.add' | 'track.set' | 'track.reorder'
  // Sequences
  | 'sequence.create' | 'sequence.setFormat' | 'sequence.setInOut' | 'sequence.duplicate'
  // Timeline
  | 'timeline.rippleDeleteRange' | 'timeline.insertGap' | 'timeline.closeGap'
  | 'timeline.insertEdit' | 'timeline.overwriteEdit'
  // Transitions
  | 'transition.upsert' | 'transition.remove' | 'transition.setProps'
  // Precomps
  | 'precomp.create' | 'precomp.dissolve' | 'precomp.duplicate'
  // Markers
  | 'marker.add' | 'marker.remove' | 'marker.set'
  // Captions
  | 'caption.upsert' | 'caption.remove' | 'caption.split' | 'caption.merge' |'caption.setStyle'
  // Transcript
  | 'transcript.upsert'
  // Graphics
  | 'graphic.place' | 'graphic.setParam' | 'graphic.setType'
  // Cues
  | 'cue.upsert' | 'cue.remove'
  // Versions
  | 'version.create' | 'version.restore'
  // Motion documents — canonical MotionDocuments stored in ProjectData.motionDocuments
  | 'motion.document.register' | 'motion.document.patch' | 'motion.document.remove'
  /** @deprecated legacy alias for motion.document.register (accepted by reducer, compared by e2e) */
  | 'motionDocument.upsert'
  // Settings
  | 'settings.patch'
  // Session-only (never increment revision)
  | 'playhead.set' | 'sourceMonitor.set';

// ── Payload types ─────────────────────────────────────────────

export type OpPayload =
  | AssetRegisterPayload | AssetSetPropsPayload | AssetRemovePayload | AssetRelinkPayload
  | ClipAddPayload | ClipMovePayload | ClipTrimPayload | ClipSplitPayload
  | ClipDeletePayload | ClipRippleDeletePayload | ClipLinkPayload | ClipUnlinkPayload
  | ClipDuplicatePayload | ClipSetPropsPayload | ClipSetTransformPayload
  | ClipSetGainPayload | ClipSetSpeedPayload | ClipSetFreezePayload
  | ClipEffectPayload | ClipReorderEffectPayload
  | ClipMaskPayload | ClipSetMaskPayload | ClipRemoveMaskPayload
  | ClipEnablePayload
  | KeyframeUpsertPayload | KeyframeRemovePayload | KeyframeMovePayload | KeyframeSetEasingPayload
  | TrackAddPayload | TrackSetPayload | TrackReorderPayload
  | SequenceCreatePayload | SequenceSetFormatPayload | SequenceSetInOutPayload | SequenceDuplicatePayload
  | RippleDeleteRangePayload | InsertGapPayload | CloseGapPayload
  | InsertEditPayload | OverwriteEditPayload
  | TransitionUpsertPayload | TransitionRemovePayload | TransitionSetPropsPayload
  | PrecompCreatePayload | PrecompDissolvePayload | PrecompDuplicatePayload
  | MarkerAddPayload | MarkerRemovePayload | MarkerSetPayload
  | CaptionUpsertPayload | CaptionRemovePayload | CaptionSplitPayload | CaptionMergePayload | CaptionSetStylePayload
  | TranscriptUpsertPayload
  | GraphicPlacePayload | GraphicSetParamPayload | GraphicSetTypePayload
  | CueUpsertPayload | CueRemovePayload
  | VersionCreatePayload | VersionRestorePayload
  | MotionDocumentRegisterPayload | MotionDocumentPatchPayload | MotionDocumentRemovePayload
  | LegacyMotionDocumentUpsertPayload
  | SettingsPatchPayload
  | PlayheadSetPayload | SourceMonitorSetPayload;

// Asset payloads
export interface AssetRegisterPayload { asset: Asset }
export interface AssetSetPropsPayload { assetId: string; props: Partial<Asset> }
export interface AssetRemovePayload { assetId: string }
export interface AssetRelinkPayload { assetId: string; newSourceRef: string; newRuntimeUrl?: string }

// Clip payloads
export interface ClipAddPayload { sequenceId: string; clip: Clip }
export interface ClipMovePayload { sequenceId: string; clipId: string; newStartTime: RationalTime; newTrackId?: string }
export interface ClipTrimPayload { sequenceId: string; clipId: string; edge: 'in' | 'out'; newTime: RationalTime; ripple?: boolean }
export interface ClipSplitPayload { sequenceId: string; clipId: string; splitTime: RationalTime }
export interface ClipDeletePayload { sequenceId: string; clipIds: string[] }
export interface ClipRippleDeletePayload { sequenceId: string; clipIds: string[] }
export interface ClipLinkPayload { sequenceId: string; clipIds: string[]; groupId?: string }
export interface ClipUnlinkPayload { sequenceId: string; clipId: string }
export interface ClipDuplicatePayload { sequenceId: string; clipId: string; newClipId: string }
export interface ClipSetPropsPayload { sequenceId: string; clipId: string; props: Partial<Clip> }
export interface ClipSetTransformPayload { sequenceId: string; clipId: string; transform: Partial<import('./schema').Transform> }
export interface ClipSetGainPayload { sequenceId: string; clipId: string; gain: number }
export interface ClipSetSpeedPayload { sequenceId: string; clipId: string; speed: number; reverse?: boolean }
export interface ClipSetFreezePayload { sequenceId: string; clipId: string; freeze: boolean; freezeFrame?: RationalTime }
export interface ClipEffectPayload { sequenceId: string; clipId: string; effect?: Effect; effectId?: string; props?: Partial<Effect> }
export interface ClipReorderEffectPayload { sequenceId: string; clipId: string; effectId: string; newOrder: number }
export interface ClipMaskPayload { sequenceId: string; clipId: string; mask: Mask }
export interface ClipSetMaskPayload { sequenceId: string; clipId: string; maskId: string; props: Partial<Mask> }
export interface ClipRemoveMaskPayload { sequenceId: string; clipId: string; maskId: string }
export interface ClipEnablePayload { sequenceId: string; clipId: string; enabled: boolean }

// Keyframe payloads
export interface KeyframeUpsertPayload { sequenceId: string; clipId: string; keyframe: Keyframe }
export interface KeyframeRemovePayload { sequenceId: string; clipId: string; keyframeId: string }
export interface KeyframeMovePayload { sequenceId: string; clipId: string; keyframeId: string; newTime: RationalTime }
export interface KeyframeSetEasingPayload { sequenceId: string; clipId: string; keyframeId: string; easing: import('./schema').EasingType }

// Track payloads
export interface TrackAddPayload { sequenceId: string; track: Track }
export interface TrackSetPayload { sequenceId: string; trackId: string; props: Partial<Track> }
export interface TrackReorderPayload { sequenceId: string; trackId: string; order: number }

// Sequence payloads
export interface SequenceCreatePayload { sequence: Sequence }
export interface SequenceSetFormatPayload { sequenceId: string; format: Partial<import('./schema').SequenceFormat> }
export interface SequenceSetInOutPayload { sequenceId: string; inPoint?: RationalTime; outPoint?: RationalTime }
export interface SequenceDuplicatePayload { sequenceId: string; newSequenceId: string; newName: string }

// Timeline payloads
export interface RippleDeleteRangePayload { sequenceId: string; startTime: RationalTime; endTime: RationalTime }
export interface InsertGapPayload { sequenceId: string; trackId: string; startTime: RationalTime; duration: RationalTime }
export interface CloseGapPayload { sequenceId: string; trackId: string; gapStartTime: RationalTime }
export interface InsertEditPayload { sequenceId: string; clip: Clip; insertTime: RationalTime; targetTrackId: string }
export interface OverwriteEditPayload { sequenceId: string; clip: Clip; startTime: RationalTime; targetTrackId: string }

// Transition payloads
export interface TransitionUpsertPayload { sequenceId: string; transition: Transition }
export interface TransitionRemovePayload { sequenceId: string; transitionId: string }
export interface TransitionSetPropsPayload { sequenceId: string; transitionId: string; props: Partial<Transition> }

// Precomp payloads
export interface PrecompCreatePayload { precomp: Precomp; childSequence: Sequence; parentClip: Clip; sourceClipIds?: string[] }
export interface PrecompDissolvePayload { precompId: string; sequenceId: string }
export interface PrecompDuplicatePayload { precompId: string; newPrecompId: string; newSequenceId: string }

// Marker payloads
export interface MarkerAddPayload { sequenceId: string; marker: Marker }
export interface MarkerRemovePayload { sequenceId: string; markerId: string }
export interface MarkerSetPayload { sequenceId: string; markerId: string; props: Partial<Marker> }

// Caption payloads
export interface CaptionUpsertPayload { sequenceId: string; caption: Caption }
export interface CaptionRemovePayload { sequenceId: string; captionId: string }
export interface CaptionSplitPayload { sequenceId: string; captionId: string; splitTime: RationalTime; newCaptionId: string }
export interface CaptionMergePayload { sequenceId: string; captionIdA: string; captionIdB: string }
export interface CaptionSetStylePayload { sequenceId: string; captionId: string; style: Partial<import('./schema').CaptionStyle> }

// Transcript payloads
export interface TranscriptUpsertPayload { assetId: string; words: TranscriptWord[] }

// Graphic payloads
export interface GraphicPlacePayload { sequenceId: string; clip: Clip }
export interface GraphicSetParamPayload { sequenceId: string; clipId: string; key: string; value: string | number | boolean }
export interface GraphicSetTypePayload { sequenceId: string; clipId: string; graphicType: Clip['graphicType'] }

// Cue payloads
export interface CueUpsertPayload { sequenceId: string; cue: SemanticCue }
export interface CueRemovePayload { sequenceId: string; cueId: string }

// Version payloads
export interface VersionCreatePayload { label: string; snapshotJson: string }
export interface VersionRestorePayload { versionId: string; snapshotJson: string }

// Motion document payloads — the ONE canonical path for Motion edits into Studio history.
// A MotionTransaction is packed as a single op so one AI/manual Motion edit = one history entry.
export interface MotionDocumentRegisterPayload { document: MotionDocument }
export interface MotionDocumentPatchPayload { documentId: string; transaction: MotionTransaction }
export interface MotionDocumentRemovePayload { documentId: string }
/** @deprecated legacy resource-shaped payload accepted by the reducer for old saves/scripts */
export interface LegacyMotionDocumentUpsertPayload {
  resource: { id: string; documentJson?: string; [key: string]: unknown };
}

// Settings payloads
export interface SettingsPatchPayload { settings: Partial<import('./schema').ProjectSettings> }

// Session-only payloads
export interface PlayheadSetPayload { frame: number }
export interface SourceMonitorSetPayload {
  assetId?: string | null;
  inFrame?: number | null;
  outFrame?: number | null;
  playheadFrame?: number;
}

// ── Op factory helpers ────────────────────────────────────────

export function makeOp(type: OpType, payload: OpPayload, actor: OpEnvelope['actor'] = 'user'): OpEnvelope {
  return {
    opId: generateId('op'),
    type,
    payload,
    actor,
    createdAt: Date.now(),
  };
}

export function makeBatch(ops: OpEnvelope[]): OpEnvelope[] {
  return ops;
}

/** SESSION-ONLY ops that never increment revision */
export const SESSION_ONLY_OPS: Set<OpType> = new Set([
  'playhead.set',
  'sourceMonitor.set',
]);
