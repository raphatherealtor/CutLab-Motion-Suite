/**
 * CutLab Engine Store v2
 * React context + useReducer wrapping ProjectData + SessionState.
 * ONE canonical dispatcher. ONE undo/redo stack. ONE playhead truth.
 * 
 * ProjectState: persistent, versioned, serializable
 * SessionState: ephemeral, never increments revision
 */

'use client';

import React, { createContext, useContext, useReducer, useCallback, useRef, useEffect } from 'react';
import type { ProjectData } from './schema';
import { createDefaultProject } from './schema';
import type { OpEnvelope } from './operations';
import { applyOp, applyOps } from './reducer';
import { toTimecode, fromFrameIndex } from './time';
import { saveProject, loadProject, listRecents, type RecentEntry } from './persistence';
import type { SourceMonitorState } from './source-monitor';
import { DEFAULT_SOURCE_MONITOR } from './source-monitor';

// ── Session State ─────────────────────────────────────────────

export interface SessionState {
  playheadFrame: number;
  playing: boolean;
  zoom: number;
  scrollX: number;
  scrollY: number;
  selectedClipIds: Set<string>;
  activeTool: 'select' | 'razor';
  dragDraft: DragDraft | null;
  trimDraft: TrimDraft | null;
  viewerDraft: ViewerDraft | null;
  rightPanelTab: 'inspector' | 'library';
  snapEnabled: boolean;
  rippleEnabled: boolean;
  parkedOps: OpEnvelope[] | null;
  parkedDescription: string | null;
  inPoint: number | null;
  outPoint: number | null;
  /** Source monitor state — ephemeral */
  sourceMonitor: SourceMonitorState;
  /** Active panel: 'timeline' | 'transcript' | 'captions' | 'effects' | 'keyframes' */
  activePanel: string;
  /** Selected keyframe IDs */
  selectedKeyframeIds: Set<string>;
  /** Selected caption IDs */
  selectedCaptionIds: Set<string>;
  /** Transcript search query */
  transcriptSearch: string;
  /** Selected transcript word IDs */
  selectedWordIds: Set<string>;
  /** Timeline fit-to-window flag */
  timelineFit: boolean;
  /** Viewer safe areas visible */
  safeAreasVisible: boolean;
  /** Viewer guides visible */
  guidesVisible: boolean;
  /** Viewer overlay: 'none' | 'thirds' | 'center' */
  viewerOverlay: 'none' | 'thirds' | 'center';
  /** Source monitor playback */
  sourceMonitorPlaying: boolean;
  /** Override active sequence (for entering precomps) — null = use project.activeSequenceId */
  activeSequenceOverride: string | null;
}

export interface DragDraft {
  clipId: string;
  originalStartFrame: number;
  originalTrackId: string;
  currentStartFrame: number;
  currentTrackId: string;
  startRevision: number;
}

export interface TrimDraft {
  clipId: string;
  edge: 'in' | 'out';
  originalFrame: number;
  currentFrame: number;
  startRevision: number;
}

export interface ViewerDraft {
  clipId: string;
  property: string;
  originalValue: number;
  currentValue: number;
  startRevision: number;
}

const DEFAULT_SESSION: SessionState = {
  playheadFrame: 0,
  playing: false,
  zoom: 1.0,
  scrollX: 0,
  scrollY: 0,
  selectedClipIds: new Set(),
  activeTool: 'select',
  dragDraft: null,
  trimDraft: null,
  viewerDraft: null,
  rightPanelTab: 'library',
  snapEnabled: true,
  rippleEnabled: false,
  parkedOps: null,
  parkedDescription: null,
  inPoint: null,
  outPoint: null,
  sourceMonitor: { ...DEFAULT_SOURCE_MONITOR },
  activePanel: 'timeline',
  selectedKeyframeIds: new Set(),
  selectedCaptionIds: new Set(),
  transcriptSearch: '',
  selectedWordIds: new Set(),
  timelineFit: false,
  safeAreasVisible: false,
  guidesVisible: true,
  viewerOverlay: 'none',
  sourceMonitorPlaying: false,
  activeSequenceOverride: null,
};

// ── Undo/Redo History ─────────────────────────────────────────

interface HistoryEntry {
  state: ProjectData;
  description: string;
}

interface EngineState {
  project: ProjectData;
  session: SessionState;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  dirty: boolean;
  savedAgo: string;
  lastSavedRevision: number;
}

// ── Actions ───────────────────────────────────────────────────

type EngineAction =
  | { type: 'DISPATCH_OP'; envelope: OpEnvelope; description?: string }
  | { type: 'DISPATCH_BATCH'; envelopes: OpEnvelope[]; description?: string }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'SESSION_UPDATE'; patch: Partial<SessionState> }
  | { type: 'PARK_OPS'; ops: OpEnvelope[]; description: string }
  | { type: 'CONFIRM_PARKED' }
  | { type: 'DISCARD_PARKED' }
  | { type: 'MARK_SAVED'; revision: number }
  | { type: 'LOAD_PROJECT'; project: ProjectData }
  | { type: 'NEW_PROJECT'; name?: string };

function engineReducer(state: EngineState, action: EngineAction): EngineState {
  switch (action.type) {
    case 'DISPATCH_OP': {
      const result = applyOp(state.project, action.envelope);
      if (!result.didMutate) return state;
      return {
        ...state,
        project: result.state,
        undoStack: [...state.undoStack, { state: state.project, description: action.description || action.envelope.type }],
        redoStack: [],
        dirty: true,
      };
    }
    case 'DISPATCH_BATCH': {
      const result = applyOps(state.project, action.envelopes);
      if (!result.didMutate) return state;
      return {
        ...state,
        project: result.state,
        undoStack: [...state.undoStack, { state: state.project, description: action.description || 'batch' }],
        redoStack: [],
        dirty: true,
      };
    }
    case 'UNDO': {
      if (state.undoStack.length === 0) return state;
      const prev = state.undoStack[state.undoStack.length - 1];
      return {
        ...state,
        project: prev.state,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, { state: state.project, description: prev.description }],
        dirty: prev.state.revision !== state.lastSavedRevision,
      };
    }
    case 'REDO': {
      if (state.redoStack.length === 0) return state;
      const next = state.redoStack[state.redoStack.length - 1];
      return {
        ...state,
        project: next.state,
        redoStack: state.redoStack.slice(0, -1),
        undoStack: [...state.undoStack, { state: state.project, description: next.description }],
        dirty: next.state.revision !== state.lastSavedRevision,
      };
    }
    case 'SESSION_UPDATE': {
      return { ...state, session: { ...state.session, ...action.patch } };
    }
    case 'PARK_OPS': {
      return {
        ...state,
        session: { ...state.session, parkedOps: action.ops, parkedDescription: action.description },
      };
    }
    case 'CONFIRM_PARKED': {
      if (!state.session.parkedOps) return state;
      const result = applyOps(state.project, state.session.parkedOps);
      if (!result.didMutate) {
        return { ...state, session: { ...state.session, parkedOps: null, parkedDescription: null } };
      }
      return {
        ...state,
        project: result.state,
        undoStack: [...state.undoStack, { state: state.project, description: state.session.parkedDescription || 'ai-ops' }],
        redoStack: [],
        dirty: true,
        session: { ...state.session, parkedOps: null, parkedDescription: null },
      };
    }
    case 'DISCARD_PARKED': {
      return { ...state, session: { ...state.session, parkedOps: null, parkedDescription: null } };
    }
    case 'MARK_SAVED': {
      return { ...state, dirty: false, lastSavedRevision: action.revision, savedAgo: 'just now' };
    }
    case 'LOAD_PROJECT': {
      return {
        ...state,
        project: action.project,
        undoStack: [],
        redoStack: [],
        dirty: false,
        lastSavedRevision: action.project.revision,
        session: { ...DEFAULT_SESSION },
      };
    }
    case 'NEW_PROJECT': {
      const proj = createDefaultProject(action.name);
      return {
        ...state,
        project: proj,
        undoStack: [],
        redoStack: [],
        dirty: false,
        lastSavedRevision: 0,
        session: { ...DEFAULT_SESSION },
      };
    }
    default:
      return state;
  }
}

// ── Context ───────────────────────────────────────────────────

export interface EngineContextValue {
  project: ProjectData;
  session: SessionState;
  undoDepth: number;
  redoDepth: number;
  dirty: boolean;
  savedAgo: string;
  /** Dispatch a single canonical op */
  dispatch: (envelope: OpEnvelope, description?: string) => void;
  /** Dispatch an atomic batch (one undo step) */
  dispatchBatch: (envelopes: OpEnvelope[], description?: string) => void;
  undo: () => void;
  redo: () => void;
  /** Update session state — never increments revision */
  updateSession: (patch: Partial<SessionState>) => void;
  /** Park AI/skill ops for user confirmation */
  parkOps: (ops: OpEnvelope[], description: string) => void;
  confirmParked: () => void;
  discardParked: () => void;
  save: () => Promise<void>;
  loadProjectById: (id: string) => Promise<void>;
  newProject: (name?: string) => void;
  recents: RecentEntry[];
  /** Active sequence derived from project */
  activeSequence: import('./schema').Sequence | null;
  /** Playback timecode string */
  timecode: string;
  /** Total frames in active sequence */
  totalFrames: number;
}

const EngineContext = createContext<EngineContextValue | null>(null);

export function useEngine(): EngineContextValue {
  const ctx = useContext(EngineContext);
  if (!ctx) throw new Error('useEngine must be used within EngineProvider');
  return ctx;
}

// ── Provider ──────────────────────────────────────────────────

interface EngineProviderProps {
  children: React.ReactNode;
  initialProjectName?: string;
}

export function EngineProvider({ children, initialProjectName }: EngineProviderProps) {
  const [state, dispatch_] = useReducer(engineReducer, undefined, () => ({
    project: createDefaultProject(initialProjectName || 'Untitled Project'),
    session: { ...DEFAULT_SESSION },
    undoStack: [] as HistoryEntry[],
    redoStack: [] as HistoryEntry[],
    dirty: false,
    savedAgo: 'never',
    lastSavedRevision: 0,
  }));

  const [recents, setRecents] = React.useState<RecentEntry[]>([]);
  const [savedAgoDisplay, setSavedAgoDisplay] = React.useState<string>('never');
  const lastSaveTimeRef = useRef<number>(0);
  const audioEngineRef = useRef<import('./audio-mixer').AudioPreviewEngine | null>(null);

  // Update savedAgo display
  useEffect(() => {
    const interval = setInterval(() => {
      if (lastSaveTimeRef.current === 0) return;
      const elapsed = Math.floor((Date.now() - lastSaveTimeRef.current) / 1000);
      let ago = 'just now';
      if (elapsed > 60) ago = `${Math.floor(elapsed / 60)} min ago`;
      else if (elapsed > 5) ago = `${elapsed}s ago`;
      setSavedAgoDisplay(ago);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Audio preview — start/stop with playback
  useEffect(() => {
    const startAudio = async () => {
      try {
        const { AudioPreviewEngine } = await import('./audio-mixer');
        if (!audioEngineRef.current) {
          audioEngineRef.current = new AudioPreviewEngine();
        }
        const startSecs = state.session.playheadFrame / (state.project.sequences[state.project.activeSequenceId]?.format.fps ?? 29.97);
        await audioEngineRef.current.play(state.project, startSecs);
      } catch (e) {
        console.warn('[cutlab] audio preview failed', e);
      }
    };

    if (state.session.playing) {
      startAudio();
    } else {
      audioEngineRef.current?.stop();
    }
  }, [state.session.playing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      audioEngineRef.current?.dispose();
    };
  }, []);

  // Load project from localStorage on mount
  useEffect(() => {
    const openId = typeof window !== 'undefined' ? localStorage.getItem('cutlab-open-project') : null;
    if (openId) {
      localStorage.removeItem('cutlab-open-project');
      loadProject(openId).then((proj) => {
        if (proj) dispatch_({ type: 'LOAD_PROJECT', project: proj });
      });
    } else {
      const lastId = typeof window !== 'undefined' ? localStorage.getItem('cutlab-project') : null;
      if (lastId) {
        loadProject(lastId).then((proj) => {
          if (proj) dispatch_({ type: 'LOAD_PROJECT', project: proj });
        });
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load recents on mount
  useEffect(() => {
    setRecents(listRecents());
  }, []);

  // Auto-save
  useEffect(() => {
    if (!state.dirty) return;
    const timer = setTimeout(async () => {
      try {
        await saveProject(state.project);
        lastSaveTimeRef.current = Date.now();
        setSavedAgoDisplay('just now');
        dispatch_({ type: 'MARK_SAVED', revision: state.project.revision });
        setRecents(listRecents());
      } catch (e) {
        console.warn('[cutlab] auto-save failed', e);
      }
    }, state.project.settings.autoSaveIntervalMs);
    return () => clearTimeout(timer);
  }, [state.dirty, state.project]);

  // Dirty document title
  useEffect(() => {
    const title = state.dirty
      ? `● ${state.project.name} — CutLab Studio`
      : `${state.project.name} — CutLab Studio`;
    if (typeof document !== 'undefined') document.title = title;
  }, [state.dirty, state.project.name]);

  // beforeunload guard
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (state.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [state.dirty]);

  const dispatch = useCallback((envelope: OpEnvelope, description?: string) => {
    dispatch_({ type: 'DISPATCH_OP', envelope, description });
  }, []);

  const dispatchBatch = useCallback((envelopes: OpEnvelope[], description?: string) => {
    dispatch_({ type: 'DISPATCH_BATCH', envelopes, description });
  }, []);

  const undo = useCallback(() => dispatch_({ type: 'UNDO' }), []);
  const redo = useCallback(() => dispatch_({ type: 'REDO' }), []);

  const updateSession = useCallback((patch: Partial<SessionState>) => {
    dispatch_({ type: 'SESSION_UPDATE', patch });
  }, []);

  const parkOps = useCallback((ops: OpEnvelope[], description: string) => {
    dispatch_({ type: 'PARK_OPS', ops, description });
  }, []);

  const confirmParked = useCallback(() => dispatch_({ type: 'CONFIRM_PARKED' }), []);
  const discardParked = useCallback(() => dispatch_({ type: 'DISCARD_PARKED' }), []);

  const save = useCallback(async () => {
    try {
      await saveProject(state.project);
      lastSaveTimeRef.current = Date.now();
      setSavedAgoDisplay('just now');
      dispatch_({ type: 'MARK_SAVED', revision: state.project.revision });
      setRecents(listRecents());
    } catch (e) {
      console.warn('[cutlab] save failed', e);
    }
  }, [state.project]);

  const loadProjectById = useCallback(async (id: string) => {
    const proj = await loadProject(id);
    if (proj) dispatch_({ type: 'LOAD_PROJECT', project: proj });
  }, []);

  const newProject = useCallback((name?: string) => {
    dispatch_({ type: 'NEW_PROJECT', name });
  }, []);

  const activeSequence = state.session.activeSequenceOverride
    ? (state.project.sequences[state.session.activeSequenceOverride] ?? state.project.sequences[state.project.activeSequenceId] ?? null)
    : (state.project.sequences[state.project.activeSequenceId] ?? null);
  const fps = activeSequence?.format.fps ?? 29.97;
  const totalFrames = activeSequence && activeSequence.clips.length > 0
    ? Math.max(0, ...activeSequence.clips.map((c) => {
        const endSecs = (c.startTime.value / c.startTime.timescale) + (c.duration.value / c.duration.timescale);
        return Math.ceil(endSecs * fps);
      }))
    : 0;

  const timecode = toTimecode(
    fromFrameIndex(state.session.playheadFrame, fps),
    fps
  );

  const value: EngineContextValue = {
    project: state.project,
    session: state.session,
    undoDepth: state.undoStack.length,
    redoDepth: state.redoStack.length,
    dirty: state.dirty,
    savedAgo: state.dirty ? savedAgoDisplay : state.savedAgo,
    dispatch,
    dispatchBatch,
    undo,
    redo,
    updateSession,
    parkOps,
    confirmParked,
    discardParked,
    save,
    loadProjectById,
    newProject,
    recents,
    activeSequence,
    timecode,
    totalFrames,
  };

  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}
