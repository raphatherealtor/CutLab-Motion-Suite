/**
 * CutLab Workspace Context
 * Shared state for Studio ↔ Motion Animator workspace switching.
 *
 * ONE application. TWO specialized workspaces.
 * ONE canonical project. ONE history. ONE time truth.
 *
 * This module defines:
 * - WorkspaceKind: which workspace is active
 * - WorkspaceHandoff: context passed when switching workspaces
 * - WorkspaceSession: ephemeral session state for workspace management
 *
 * The canonical project (ProjectData) and undo/redo history live in the Engine store.
 * WorkspaceSession is ephemeral — never persisted, never increments revision.
 */



// ── Workspace Identity ────────────────────────────────────────

export type WorkspaceKind = 'studio' | 'motion-animator';

// ── Handoff Context ───────────────────────────────────────────

/**
 * Context passed from Studio → Motion Animator when opening a Motion clip.
 * All values derived from the canonical Studio project state at switch time.
 * No copies. No exports. The MotionDocument is referenced by ID in ProjectData.
 */
export interface WorkspaceHandoff {
  /** The MotionDocument ID to open — references ProjectData.motionDocuments[id] */
  motionDocumentId: string;
  /** The Studio clip ID that references this document */
  clipId: string;
  /** Studio sequence ID */
  sequenceId: string;
  /** Studio playhead converted to clip-local Motion time (seconds) */
  clipLocalTimeSecs: number;
  /** Studio playhead frame */
  studioPlayheadFrame: number;
  /** Clip start time in sequence (seconds) */
  clipStartSecs: number;
  /** Clip duration (seconds) */
  clipDurationSecs: number;
  /** Sequence format */
  sequenceFormat: {
    width: number;
    height: number;
    fps: number;
  };
  /** Selected Motion object ID (if any was selected in MotionInspector) */
  selectedMotionObjectId?: string;
  /** Available signal channel IDs at switch time */
  availableSignalIds?: string[];
  /** Active speaker at playhead (from transcript) */
  activeSpeaker?: string;
  /** Active transcript word ID at playhead */
  activeWordId?: string;
  /** Scene Script region label at playhead */
  sceneRegionLabel?: string;
  /** Renderer tier requirement */
  rendererTier?: 'canvas2d' | 'hybrid' | 'spatial';
}

/**
 * Context passed from Motion Animator → Studio when returning.
 * Preserves useful selection state where practical.
 */
export interface ReturnHandoff {
  /** The MotionDocument ID that was edited */
  motionDocumentId: string;
  /** The Studio clip ID */
  clipId: string;
  /** Selected Motion object ID to restore in MotionInspector */
  selectedMotionObjectId?: string;
  /** Whether any edits were committed (for UI feedback) */
  hadEdits: boolean;
}

// ── Workspace Session ─────────────────────────────────────────

/**
 * Ephemeral workspace session state.
 * Lives in SessionState — never persisted, never increments revision.
 */
export interface WorkspaceSession {
  /** Which workspace is currently active */
  activeWorkspace: WorkspaceKind;
  /** Handoff context when Motion Animator is active */
  motionAnimatorHandoff: WorkspaceHandoff | null;
  /** Return handoff when coming back to Studio */
  returnHandoff: ReturnHandoff | null;
  /** Whether Motion Animator has uncommitted edits (for UI warning) */
  motionAnimatorDirty: boolean;
  /** Motion Animator local playhead (clip-local seconds) — for authoring convenience only */
  motionAnimatorPlayheadSecs: number;
  /** Motion Animator selected object ID */
  motionAnimatorSelectedObjectId: string | null;
  /** Motion Animator active tab */
  motionAnimatorActiveTab: string;
}

export const DEFAULT_WORKSPACE_SESSION: WorkspaceSession = {
  activeWorkspace: 'studio',
  motionAnimatorHandoff: null,
  returnHandoff: null,
  motionAnimatorDirty: false,
  motionAnimatorPlayheadSecs: 0,
  motionAnimatorSelectedObjectId: null,
  motionAnimatorActiveTab: 'objects',
};

// ── Workspace Switch Helpers ──────────────────────────────────

/**
 * Build a WorkspaceHandoff from Studio state.
 * Called when user clicks "Open in Motion Animator" on a Motion clip.
 */
export function buildWorkspaceHandoff(params: {
  motionDocumentId: string;
  clipId: string;
  sequenceId: string;
  studioPlayheadFrame: number;
  clipStartSecs: number;
  clipDurationSecs: number;
  fps: number;
  sequenceWidth: number;
  sequenceHeight: number;
  selectedMotionObjectId?: string;
  availableSignalIds?: string[];
  activeSpeaker?: string;
  activeWordId?: string;
  sceneRegionLabel?: string;
  rendererTier?: 'canvas2d' | 'hybrid' | 'spatial';
}): WorkspaceHandoff {
  const {
    motionDocumentId, clipId, sequenceId,
    studioPlayheadFrame, clipStartSecs, clipDurationSecs,
    fps, sequenceWidth, sequenceHeight,
    selectedMotionObjectId, availableSignalIds,
    activeSpeaker, activeWordId, sceneRegionLabel, rendererTier,
  } = params;

  const studioTimeSecs = studioPlayheadFrame / fps;
  const clipLocalTimeSecs = Math.max(0, Math.min(clipDurationSecs, studioTimeSecs - clipStartSecs));

  return {
    motionDocumentId,
    clipId,
    sequenceId,
    clipLocalTimeSecs,
    studioPlayheadFrame,
    clipStartSecs,
    clipDurationSecs,
    sequenceFormat: { width: sequenceWidth, height: sequenceHeight, fps },
    selectedMotionObjectId,
    availableSignalIds,
    activeSpeaker,
    activeWordId,
    sceneRegionLabel,
    rendererTier: rendererTier ?? 'hybrid',
  };
}

/**
 * Build a ReturnHandoff when returning from Motion Animator to Studio.
 */
export function buildReturnHandoff(params: {
  motionDocumentId: string;
  clipId: string;
  selectedMotionObjectId?: string;
  hadEdits: boolean;
}): ReturnHandoff {
  return {
    motionDocumentId: params.motionDocumentId,
    clipId: params.clipId,
    selectedMotionObjectId: params.selectedMotionObjectId,
    hadEdits: params.hadEdits,
  };
}
