'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { EngineProvider, useEngine } from '@/engine/store';
import EditorTopBar from './EditorTopBar';
import ViewerPanel from './ViewerPanel';
import AiPanel from './AiPanel';
import InspectorLibraryPanel from './InspectorLibraryPanel';
import EditorFooter from './EditorFooter';
import { makeOp } from '@/engine/operations';
import { fromSeconds, toSeconds } from '@/engine/time';
import { generateId } from '@/engine/schema';
import { buildWorkspaceHandoff } from '@/engine/workspace-context';
import type { WorkspaceHandoff, ReturnHandoff } from '@/engine/workspace-context';

const TimelinePanel = dynamic(() => import('./TimelinePanel'), { ssr: false });
// Production Motion workspace: MotionAnimatorWorkspace (rich UI) hosted on canonical bridge
const MotionAnimatorWorkspace = dynamic(() => import('./MotionAnimatorWorkspace'), { ssr: false });

export type ToolMode = 'select' | 'razor';
export type RightPanelTab = 'inspector' | 'library';

export interface PlaybackState {
  playing: boolean;
  timecode: string;
  frameIndex: number;
  totalFrames: number;
}

export interface ProjectState {
  name: string;
  dirty: boolean;
  savedAgo: string;
  revision: number;
  undoDepth: number;
  redoDepth: number;
}

function EditorInner() {
  const engine = useEngine();
  const { project, session, undoDepth, redoDepth, dirty, savedAgo, timecode, totalFrames, activeSequence } = engine;

  // Motion Animator overlay state — uses WorkspaceHandoff for the rich workspace
  const [motionHandoff, setMotionHandoff] = useState<WorkspaceHandoff | null>(null);

  const handleOpenMotionAnimator = useCallback((documentId: string, clipId: string) => {
    if (!activeSequence) return;
    const clip = activeSequence.clips.find((c) => c.id === clipId);
    if (!clip) return;
    const fps = activeSequence.format.fps ?? 29.97;
    const clipStartSecs = toSeconds(clip.startTime);
    const clipDurationSecs = toSeconds(clip.duration);

    const handoff = buildWorkspaceHandoff({
      motionDocumentId: documentId,
      clipId,
      sequenceId: activeSequence.id,
      studioPlayheadFrame: session.playheadFrame,
      clipStartSecs,
      clipDurationSecs,
      fps,
      sequenceWidth: activeSequence.format.width ?? 1920,
      sequenceHeight: activeSequence.format.height ?? 1080,
      rendererTier: 'hybrid',
    });
    setMotionHandoff(handoff);
  }, [activeSequence, session.playheadFrame]);

  const handleReturnToStudio = useCallback((_returnHandoff: ReturnHandoff) => {
    setMotionHandoff(null);
  }, []);

  // Keyboard shortcuts — all call canonical ops
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when Motion Animator is open
      if (motionHandoff) return;

      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // ── Global shortcuts ──
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        engine.undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        engine.redo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        engine.save();
        return;
      }

      if (isInput) return;

      const fps = activeSequence?.format.fps ?? 29.97;
      const seqId = activeSequence?.id;

      // ── Playback ──
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        engine.updateSession({ playing: !session.playing });
        return;
      }
      if (e.key === 'j') {
        e.preventDefault();
        engine.updateSession({ playing: false, playheadFrame: Math.max(0, session.playheadFrame - Math.round(fps)) });
        return;
      }
      if (e.key === 'l') {
        e.preventDefault();
        engine.updateSession({ playing: false, playheadFrame: Math.min(totalFrames, session.playheadFrame + Math.round(fps)) });
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const step = e.shiftKey ? Math.round(fps) : 1;
        engine.updateSession({ playheadFrame: Math.max(0, session.playheadFrame - step) });
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const step = e.shiftKey ? Math.round(fps) : 1;
        engine.updateSession({ playheadFrame: Math.min(totalFrames, session.playheadFrame + step) });
        return;
      }
      if (e.key === 'Home') {
        e.preventDefault();
        engine.updateSession({ playheadFrame: 0 });
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        engine.updateSession({ playheadFrame: totalFrames });
        return;
      }

      // ── Tools ──
      if (e.key === 'v' || e.key === 'V') { engine.updateSession({ activeTool: 'select' }); return; }
      if (e.key === 'c' || e.key === 'C') { engine.updateSession({ activeTool: 'razor' }); return; }

      // ── In/Out markers ──
      if (e.key === 'i' || e.key === 'I') {
        engine.updateSession({ inPoint: session.playheadFrame });
        if (activeSequence) {
          const inPoint = fromSeconds(session.playheadFrame / fps, 30000);
          engine.dispatch(makeOp('sequence.setInOut', { sequenceId: activeSequence.id, inPoint }), 'Mark In');
        }
        return;
      }
      if (e.key === 'o' || e.key === 'O') {
        engine.updateSession({ outPoint: session.playheadFrame });
        if (activeSequence) {
          const outPoint = fromSeconds(session.playheadFrame / fps, 30000);
          engine.dispatch(makeOp('sequence.setInOut', { sequenceId: activeSequence.id, outPoint }), 'Mark Out');
        }
        return;
      }
      if (e.key === 'x' || e.key === 'X') {
        engine.updateSession({ inPoint: null, outPoint: null });
        return;
      }

      // ── Split at playhead (S) ──
      if ((e.key === 's' || e.key === 'S') && !e.shiftKey) {
        if (!activeSequence || !seqId) return;
        const splitTime = fromSeconds(session.playheadFrame / fps, 30000);
        const clipsToSplit = session.selectedClipIds.size > 0
          ? activeSequence.clips.filter((c) => session.selectedClipIds.has(c.id))
          : activeSequence.clips.filter((c) => {
              const start = c.startTime.value / c.startTime.timescale;
              const end = start + c.duration.value / c.duration.timescale;
              const t = session.playheadFrame / fps;
              return t > start && t < end;
            });
        if (clipsToSplit.length > 0) {
          const ops = clipsToSplit.map((clip) => makeOp('clip.split', { sequenceId: seqId, clipId: clip.id, splitTime }));
          engine.dispatchBatch(ops, 'Split at playhead');
        }
        return;
      }

      // ── Delete / Ripple delete ──
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (session.selectedClipIds.size > 0 && activeSequence && seqId) {
          e.preventDefault();
          const clipIds = Array.from(session.selectedClipIds);
          if (session.rippleEnabled || e.shiftKey) {
            engine.dispatch(makeOp('clip.rippleDelete', { sequenceId: seqId, clipIds }), 'Ripple delete');
          } else {
            engine.dispatch(makeOp('clip.delete', { sequenceId: seqId, clipIds }), 'Delete clips');
          }
          engine.updateSession({ selectedClipIds: new Set() });
        }
        return;
      }

      // ── Add marker (M) ──
      if (e.key === 'm' || e.key === 'M') {
        if (!activeSequence || !seqId) return;
        const marker = { id: generateId('marker'), time: fromSeconds(session.playheadFrame / fps, 30000), label: 'Marker', color: '#3b82ff' };
        engine.dispatch(makeOp('marker.add', { sequenceId: seqId, marker }), 'Add marker');
        return;
      }

      // ── Snap toggle (N) ──
      if (e.key === 'n' || e.key === 'N') {
        engine.updateSession({ snapEnabled: !session.snapEnabled });
        return;
      }

      // ── Ripple toggle (R) ──
      if (e.key === 'r' || e.key === 'R') {
        engine.updateSession({ rippleEnabled: !session.rippleEnabled });
        return;
      }

      // ── Zoom in/out (+/-) ──
      if (e.key === '=' || e.key === '+') {
        engine.updateSession({ zoom: Math.min(10, session.zoom * 1.25) });
        return;
      }
      if (e.key === '-' || e.key === '_') {
        engine.updateSession({ zoom: Math.max(0.1, session.zoom * 0.8) });
        return;
      }

      // ── Fit timeline (backslash) ──
      if (e.key === '\\') {
        engine.updateSession({ zoom: 1.0, scrollX: 0 });
        return;
      }

      // ── Select all (Cmd+A) ──
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        if (activeSequence) {
          engine.updateSession({ selectedClipIds: new Set(activeSequence.clips.map((c) => c.id)) });
        }
        return;
      }

      // ── Deselect (Escape) ──
      if (e.key === 'Escape') {
        engine.updateSession({ selectedClipIds: new Set(), dragDraft: null, trimDraft: null, viewerDraft: null });
        return;
      }

      // ── Duplicate (D) ──
      if (e.key === 'd' || e.key === 'D') {
        if (session.selectedClipIds.size > 0 && activeSequence && seqId) {
          const ops = Array.from(session.selectedClipIds).map((clipId) =>
            makeOp('clip.duplicate', { sequenceId: seqId, clipId, newClipId: generateId('clip') })
          );
          engine.dispatchBatch(ops, 'Duplicate clips');
        }
        return;
      }

      // ── Safe areas toggle (Shift+S) ──
      if (e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        engine.updateSession({ safeAreasVisible: !session.safeAreasVisible });
        return;
      }

      // ── Guides toggle (G) ──
      if (e.key === 'g' || e.key === 'G') {
        engine.updateSession({ guidesVisible: !session.guidesVisible });
        return;
      }

      // ── Next/Prev marker ──
      if (e.key === 'ArrowDown' && e.shiftKey && activeSequence) {
        e.preventDefault();
        const markers = [...(activeSequence.markers ?? [])].sort((a, b) => (a.time.value / a.time.timescale) - (b.time.value / b.time.timescale));
        const playheadSecs = session.playheadFrame / fps;
        const next = markers.find((m) => (m.time.value / m.time.timescale) > playheadSecs + 0.01);
        if (next) engine.updateSession({ playheadFrame: Math.round((next.time.value / next.time.timescale) * fps) });
        return;
      }
      if (e.key === 'ArrowUp' && e.shiftKey && activeSequence) {
        e.preventDefault();
        const markers = [...(activeSequence.markers ?? [])].sort((a, b) => (b.time.value / b.time.timescale) - (a.time.value / a.time.timescale));
        const playheadSecs = session.playheadFrame / fps;
        const prev = markers.find((m) => (m.time.value / m.time.timescale) < playheadSecs - 0.01);
        if (prev) engine.updateSession({ playheadFrame: Math.round((prev.time.value / prev.time.timescale) * fps) });
        return;
      }

      // ── Next/Prev keyframe (Alt+Arrow) ──
      if (e.altKey && e.key === 'ArrowRight' && activeSequence && seqId) {
        e.preventDefault();
        const selectedId = Array.from(session.selectedClipIds)[0];
        if (selectedId) {
          const clip = activeSequence.clips.find((c) => c.id === selectedId);
          if (clip) {
            const clipStartSecs = clip.startTime.value / clip.startTime.timescale;
            const localSecs = session.playheadFrame / fps - clipStartSecs;
            const sorted = [...clip.keyframes].sort((a, b) => (a.time.value / a.time.timescale) - (b.time.value / b.time.timescale));
            const next = sorted.find((k) => (k.time.value / k.time.timescale) > localSecs + 0.01);
            if (next) engine.updateSession({ playheadFrame: Math.round((clipStartSecs + next.time.value / next.time.timescale) * fps) });
          }
        }
        return;
      }
      if (e.altKey && e.key === 'ArrowLeft' && activeSequence && seqId) {
        e.preventDefault();
        const selectedId = Array.from(session.selectedClipIds)[0];
        if (selectedId) {
          const clip = activeSequence.clips.find((c) => c.id === selectedId);
          if (clip) {
            const clipStartSecs = clip.startTime.value / clip.startTime.timescale;
            const localSecs = session.playheadFrame / fps - clipStartSecs;
            const sorted = [...clip.keyframes].sort((a, b) => (b.time.value / b.time.timescale) - (a.time.value / a.time.timescale));
            const prev = sorted.find((k) => (k.time.value / k.time.timescale) < localSecs - 0.01);
            if (prev) engine.updateSession({ playheadFrame: Math.round((clipStartSecs + prev.time.value / prev.time.timescale) * fps) });
          }
        }
        return;
      }

      // ── Add cross dissolve (Cmd+D) ──
      if ((e.metaKey || e.ctrlKey) && e.key === 'd' && !e.shiftKey) {
        e.preventDefault();
        if (session.selectedClipIds.size >= 1 && activeSequence && seqId) {
          const clipIds = Array.from(session.selectedClipIds);
          const clipA = activeSequence.clips.find((c) => c.id === clipIds[0]);
          const clipB = clipIds.length > 1 ? activeSequence.clips.find((c) => c.id === clipIds[1]) : clipA;
          if (clipA && clipB) {
            const transition = {
              id: generateId('tr'),
              type: 'cross-dissolve' as const,
              duration: fromSeconds(0.5, 30000),
              clipAId: clipA.id,
              clipBId: clipB.id,
              edge: 'cut-point' as const,
            };
            engine.dispatch(makeOp('transition.upsert', { sequenceId: seqId, transition }), 'Add cross dissolve');
          }
        }
        return;
      }

      // ── Close gap (W) ──
      if ((e.key === 'w' || e.key === 'W') && activeSequence && seqId) {
        const targetTrack = activeSequence.tracks.find((t) => t.targeted && (t.kind === 'video' || t.kind === 'audio'));
        if (targetTrack) {
          const gapStartTime = fromSeconds(session.playheadFrame / fps, 30000);
          engine.dispatch(makeOp('timeline.closeGap', { sequenceId: seqId, trackId: targetTrack.id, gapStartTime }), 'Close gap');
        }
        return;
      }

      // ── Insert edit (,) ──
      if (e.key === ',' && activeSequence && seqId) {
        const sm = session.sourceMonitor;
        if (sm.assetId) {
          const asset = engine.project.assets[sm.assetId];
          const targetTrack = activeSequence.tracks.find((t) => t.kind === (asset?.kind === 'audio' ? 'audio' : 'video') && t.targeted);
          if (asset && targetTrack) {
            const sourceInSecs = (sm.inFrame ?? 0) / fps;
            const sourceOutSecs = (sm.outFrame ?? (asset.durationFrames ?? 0)) / fps;
            const duration = fromSeconds(Math.max(0.1, sourceOutSecs - sourceInSecs), 30000);
            const insertTime = fromSeconds(session.playheadFrame / fps, 30000);
            const clip = {
              id: generateId('clip'),
              kind: (asset.kind === 'audio' ? 'audio' : 'video') as 'video' | 'audio',
              trackId: targetTrack.id,
              assetId: asset.id,
              name: asset.name,
              startTime: insertTime,
              duration,
              sourceIn: fromSeconds(sourceInSecs, 30000),
              sourceOut: fromSeconds(sourceOutSecs, 30000),
              transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0 },
              keyframes: [], effects: [], masks: [],
              gain: 0, fadeIn: fromSeconds(0, 30000), fadeOut: fromSeconds(0, 30000),
              speed: 1, reverse: false, freeze: false, disabled: false,
            };
            engine.dispatch(makeOp('timeline.insertEdit', { sequenceId: seqId, clip, insertTime, targetTrackId: targetTrack.id }), 'Insert edit');
          }
        }
        return;
      }

      // ── Overwrite edit (.) ──
      if (e.key === '.' && activeSequence && seqId) {
        const sm = session.sourceMonitor;
        if (sm.assetId) {
          const asset = engine.project.assets[sm.assetId];
          const targetTrack = activeSequence.tracks.find((t) => t.kind === (asset?.kind === 'audio' ? 'audio' : 'video') && t.targeted);
          if (asset && targetTrack) {
            const sourceInSecs = (sm.inFrame ?? 0) / fps;
            const sourceOutSecs = (sm.outFrame ?? (asset.durationFrames ?? 0)) / fps;
            const duration = fromSeconds(Math.max(0.1, sourceOutSecs - sourceInSecs), 30000);
            const startTime = fromSeconds(session.playheadFrame / fps, 30000);
            const clip = {
              id: generateId('clip'),
              kind: (asset.kind === 'audio' ? 'audio' : 'video') as 'video' | 'audio',
              trackId: targetTrack.id,
              assetId: asset.id,
              name: asset.name,
              startTime,
              duration,
              sourceIn: fromSeconds(sourceInSecs, 30000),
              sourceOut: fromSeconds(sourceOutSecs, 30000),
              transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0 },
              keyframes: [], effects: [], masks: [],
              gain: 0, fadeIn: fromSeconds(0, 30000), fadeOut: fromSeconds(0, 30000),
              speed: 1, reverse: false, freeze: false, disabled: false,
            };
            engine.dispatch(makeOp('timeline.overwriteEdit', { sequenceId: seqId, clip, startTime, targetTrackId: targetTrack.id }), 'Overwrite edit');
          }
        }
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [engine, session, totalFrames, activeSequence, motionHandoff]);

  const playback: PlaybackState = {
    playing: session.playing,
    timecode,
    frameIndex: session.playheadFrame,
    totalFrames,
  };

  const projectState: ProjectState = {
    name: project.name,
    dirty,
    savedAgo,
    revision: project.revision,
    undoDepth,
    redoDepth,
  };

  const handlePlay = useCallback(() => {
    engine.updateSession({ playing: !session.playing });
  }, [engine, session.playing]);

  const handleSeek = useCallback((frame: number) => {
    engine.updateSession({ playheadFrame: frame, playing: false });
  }, [engine]);

  const handleUndo = useCallback(() => engine.undo(), [engine]);
  const handleRedo = useCallback(() => engine.redo(), [engine]);
  const handleSave = useCallback(() => engine.save(), [engine]);

  const handleParkOp = useCallback((description: string) => {
    engine.parkOps([], description);
  }, [engine]);

  const handleConfirmParked = useCallback(() => engine.confirmParked(), [engine]);
  const handleDiscardParked = useCallback(() => engine.discardParked(), [engine]);

  const selectedClipId = session.selectedClipIds.size > 0
    ? Array.from(session.selectedClipIds)[0]
    : null;

  const handleSelectClip = useCallback((id: string | null) => {
    engine.updateSession({ selectedClipIds: id ? new Set([id]) : new Set() });
  }, [engine]);

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--color-bg)', overflow: 'hidden' }}>
      <EditorTopBar
        project={projectState}
        tool={session.activeTool}
        onToolChange={(t) => engine.updateSession({ activeTool: t })}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onSave={handleSave}
      />

      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        <AiPanel
          parkedOp={session.parkedDescription}
          onParkOp={handleParkOp}
          onConfirmParked={handleConfirmParked}
          onDiscardParked={handleDiscardParked}
        />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          <ViewerPanel
            playback={playback}
            onPlay={handlePlay}
            onSeek={handleSeek}
          />
          <TimelinePanel
            tool={session.activeTool}
            selectedClipId={selectedClipId}
            onSelectClip={handleSelectClip}
            playback={playback}
            snapEnabled={session.snapEnabled}
            rippleEnabled={session.rippleEnabled}
            zoom={session.zoom}
            onSnapToggle={() => engine.updateSession({ snapEnabled: !session.snapEnabled })}
            onRippleToggle={() => engine.updateSession({ rippleEnabled: !session.rippleEnabled })}
            onZoomChange={(z) => engine.updateSession({ zoom: z })}
          />
        </div>

        <InspectorLibraryPanel
          tab={session.rightPanelTab}
          onTabChange={(t) => engine.updateSession({ rightPanelTab: t })}
          selectedClipId={selectedClipId}
          onOpenMotionAnimator={handleOpenMotionAnimator}
        />
      </div>

      <EditorFooter project={projectState} playback={playback} />

      {/* Production Motion Animator workspace overlay
          Uses MotionAnimatorWorkspace (rich UI) hosted on the canonical bridge.
          Same MotionDocument ID — no copy, no shadow document.
          Edits go to Studio undo stack via dispatchBatch.
      */}
      {motionHandoff && (
        <MotionAnimatorWorkspace
          handoff={motionHandoff}
          onReturnToStudio={handleReturnToStudio}
        />
      )}
    </div>
  );
}

export default function EditorClient() {
  return (
    <EngineProvider>
      <EditorInner />
    </EngineProvider>
  );
}