'use client';

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { ToolMode, PlaybackState } from './EditorClient';
import { useEngine } from '@/engine/store';
import { makeOp } from '@/engine/operations';
import { fromSeconds, toSeconds } from '@/engine/time';
import type { Clip as EngineClip, Track as EngineTrack, Marker, Transition } from '@/engine/schema';
import { generateId } from '@/engine/schema';

interface TimelinePanelProps {
  tool: ToolMode;
  selectedClipId: string | null;
  onSelectClip: (id: string | null) => void;
  playback: PlaybackState;
  snapEnabled: boolean;
  rippleEnabled: boolean;
  zoom: number;
  onSnapToggle: () => void;
  onRippleToggle: () => void;
  onZoomChange: (z: number) => void;
}

const TRACK_HEADER_W = 136;

const KIND_BG: Record<string, string> = {
  video: 'rgba(59,130,255,0.18)',
  audio: 'rgba(34,211,238,0.15)',
  caption: 'rgba(74,222,128,0.15)',
  motion: 'rgba(139,92,246,0.18)',
  graphic: 'rgba(251,191,36,0.15)',
};
const KIND_BORDER: Record<string, string> = {
  video: 'rgba(59,130,255,0.45)',
  audio: 'rgba(34,211,238,0.4)',
  caption: 'rgba(74,222,128,0.4)',
  motion: 'rgba(139,92,246,0.5)',
  graphic: 'rgba(251,191,36,0.4)',
};

function formatTimecode(frames: number, fps: number): string {
  const secs = frames / fps;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  let f = Math.round((secs % 1) * fps);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(f).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}.${String(f).padStart(2,'0')}`;
}

function snapFrame(frame: number, snapPoints: number[], threshold: number, enabled: boolean): number {
  if (!enabled) return frame;
  let best = frame;
  let bestDist = threshold;
  for (const sp of snapPoints) {
    const d = Math.abs(sp - frame);
    if (d < bestDist) { bestDist = d; best = sp; }
  }
  return best;
}

export default function TimelinePanel({
  tool,
  selectedClipId,
  onSelectClip,
  playback,
  snapEnabled,
  rippleEnabled,
  zoom,
  onSnapToggle,
  onRippleToggle,
  onZoomChange,
}: TimelinePanelProps) {
  const engine = useEngine();
  const { activeSequence, dispatch, dispatchBatch, updateSession, session } = engine;
  const timelineRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const dragRef = useRef<{
    clipId: string;
    startX: number;
    startFrame: number;
    startTrackId: string;
    startRevision: number;
    isLinked: boolean;
    linkedClipIds: string[];
  } | null>(null);

  const trimRef = useRef<{
    clipId: string;
    edge: 'in' | 'out';
    startX: number;
    startFrame: number;
    startRevision: number;
  } | null>(null);

  const rangeSelectRef = useRef<{
    startX: number;
    startFrame: number;
    active: boolean;
  } | null>(null);

  const [rangeSelect, setRangeSelect] = useState<{ startPx: number; endPx: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; clipId: string } | null>(null);
  const [selectedTransitionId, setSelectedTransitionId] = useState<string | null>(null);

  const tracks = activeSequence?.tracks ?? [];
  const clips = activeSequence?.clips ?? [];
  const markers = activeSequence?.markers ?? [];
  const fps = activeSequence?.format.fps ?? 29.97;
  const totalFrames = Math.max(playback.totalFrames, 300);

  const pxPerFrame = zoom * 0.12;
  const totalWidth = Math.max(totalFrames * pxPerFrame + 200, 800);
  const playheadPx = playback.frameIndex * pxPerFrame;

  const sortedTracks = useMemo(() => [...tracks].sort((a, b) => a.order - b.order), [tracks]);

  // Snap points: clip edges + playhead + markers
  const snapPoints = useMemo(() => {
    const pts: number[] = [playback.frameIndex];
    for (const c of clips) {
      const start = Math.round(toSeconds(c.startTime) * fps);
      const end = start + Math.round(toSeconds(c.duration) * fps);
      pts.push(start, end);
    }
    for (const m of markers) {
      pts.push(Math.round(toSeconds(m.time) * fps));
    }
    return pts;
  }, [clips, markers, playback.frameIndex, fps]);

  const snapThreshold = Math.max(3, Math.round(8 / pxPerFrame));

  function toggleMute(id: string) {
    if (!activeSequence) return;
    const track = tracks.find((t) => t.id === id);
    if (!track) return;
    dispatch(makeOp('track.set', { sequenceId: activeSequence.id, trackId: id, props: { muted: !track.muted } }), 'Toggle mute');
  }
  function toggleSolo(id: string) {
    if (!activeSequence) return;
    const track = tracks.find((t) => t.id === id);
    if (!track) return;
    dispatch(makeOp('track.set', { sequenceId: activeSequence.id, trackId: id, props: { solo: !track.solo } }), 'Toggle solo');
  }
  function toggleLock(id: string) {
    if (!activeSequence) return;
    const track = tracks.find((t) => t.id === id);
    if (!track) return;
    dispatch(makeOp('track.set', { sequenceId: activeSequence.id, trackId: id, props: { locked: !track.locked } }), 'Toggle lock');
  }
  function toggleTarget(id: string) {
    if (!activeSequence) return;
    const track = tracks.find((t) => t.id === id);
    if (!track) return;
    dispatch(makeOp('track.set', { sequenceId: activeSequence.id, trackId: id, props: { targeted: !track.targeted } }), 'Toggle target');
  }
  function toggleHide(id: string) {
    if (!activeSequence) return;
    const track = tracks.find((t) => t.id === id);
    if (!track) return;
    dispatch(makeOp('track.set', { sequenceId: activeSequence.id, trackId: id, props: { hidden: !track.hidden } }), 'Toggle hide');
  }

  const handleTimelinePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (tool !== 'select') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + (bodyRef.current?.scrollLeft ?? 0);
    const frame = Math.round(x / pxPerFrame);
    // Start range select if clicking empty area
    rangeSelectRef.current = { startX: x, startFrame: frame, active: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [tool, pxPerFrame]);

  const handleTimelinePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!rangeSelectRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + (bodyRef.current?.scrollLeft ?? 0);
    rangeSelectRef.current.active = true;
    setRangeSelect({ startPx: rangeSelectRef.current.startX, endPx: x });
  }, []);

  const handleTimelinePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!rangeSelectRef.current) return;
    if (!rangeSelectRef.current.active) {
      // Simple click — seek playhead
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left + (bodyRef.current?.scrollLeft ?? 0);
      const frame = Math.max(0, Math.min(totalFrames, Math.round(x / pxPerFrame)));
      updateSession({ playheadFrame: frame });
    } else {
      // Range select — select clips in range
      if (activeSequence) {
        const startFrame = rangeSelectRef.current.startFrame;
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left + (bodyRef.current?.scrollLeft ?? 0);
        const endFrame = Math.round(x / pxPerFrame);
        const [lo, hi] = startFrame < endFrame ? [startFrame, endFrame] : [endFrame, startFrame];
        const selected = activeSequence.clips.filter((c) => {
          const cs = Math.round(toSeconds(c.startTime) * fps);
          const ce = cs + Math.round(toSeconds(c.duration) * fps);
          return cs < hi && ce > lo;
        }).map((c) => c.id);
        updateSession({ selectedClipIds: new Set(selected) });
        if (selected.length === 1) onSelectClip(selected[0]);
        else if (selected.length === 0) onSelectClip(null);
      }
    }
    rangeSelectRef.current = null;
    setRangeSelect(null);
  }, [pxPerFrame, totalFrames, updateSession, activeSequence, fps, onSelectClip]);

  // ── Clip drag ─────────────────────────────────────────────

  const handleClipPointerDown = useCallback((e: React.PointerEvent, clip: EngineClip) => {
    if (tool !== 'select') return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    const isLinked = !!clip.linkGroupId;
    const linkedClipIds = isLinked && activeSequence
      ? activeSequence.clips.filter((c) => c.linkGroupId === clip.linkGroupId).map((c) => c.id)
      : [clip.id];

    dragRef.current = {
      clipId: clip.id,
      startX: e.clientX,
      startFrame: Math.round(toSeconds(clip.startTime) * fps),
      startTrackId: clip.trackId,
      startRevision: engine.project.revision,
      isLinked,
      linkedClipIds,
    };

    // Multi-select: shift-click adds to selection
    if (e.shiftKey) {
      const next = new Set(session.selectedClipIds);
      if (next.has(clip.id)) next.delete(clip.id); else next.add(clip.id);
      // Also add linked clips
      if (isLinked) linkedClipIds.forEach((id) => next.add(id));
      updateSession({ selectedClipIds: next });
    } else if (!session.selectedClipIds.has(clip.id)) {
      // Select this clip (and linked)
      const next = new Set(linkedClipIds);
      updateSession({ selectedClipIds: next });
      onSelectClip(clip.id);
    }
  }, [tool, fps, engine.project.revision, session.selectedClipIds, updateSession, onSelectClip, activeSequence]);

  const handleClipPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const frameDelta = Math.round(dx / pxPerFrame);
    const rawFrame = Math.max(0, dragRef.current.startFrame + frameDelta);
    const snapped = snapFrame(rawFrame, snapPoints, snapThreshold, snapEnabled);
    updateSession({
      dragDraft: {
        clipId: dragRef.current.clipId,
        originalStartFrame: dragRef.current.startFrame,
        originalTrackId: dragRef.current.startTrackId,
        currentStartFrame: snapped,
        currentTrackId: dragRef.current.startTrackId,
        startRevision: dragRef.current.startRevision,
      }
    });
  }, [pxPerFrame, updateSession, snapPoints, snapThreshold, snapEnabled]);

  const handleClipPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current || !activeSequence) {
      dragRef.current = null;
      updateSession({ dragDraft: null });
      return;
    }

    const dx = e.clientX - dragRef.current.startX;
    const frameDelta = Math.round(dx / pxPerFrame);

    if (Math.abs(frameDelta) > 0) {
      const rawFrame = Math.max(0, dragRef.current.startFrame + frameDelta);
      const snapped = snapFrame(rawFrame, snapPoints, snapThreshold, snapEnabled);
      const newStartTime = fromSeconds(snapped / fps, 30000);
      // Pass newTrackId if the clip was dragged to a different track
      const newTrackId = session.dragDraft?.currentTrackId !== dragRef.current.startTrackId
        ? session.dragDraft?.currentTrackId
        : undefined;
      dispatch(
        makeOp('clip.move', { sequenceId: activeSequence.id, clipId: dragRef.current.clipId, newStartTime, newTrackId }),
        'Move clip'
      );
    }

    dragRef.current = null;
    updateSession({ dragDraft: null });
  }, [pxPerFrame, fps, activeSequence, dispatch, updateSession, snapPoints, snapThreshold, snapEnabled]);

  // ── Trim ──────────────────────────────────────────────────

  const handleTrimPointerDown = useCallback((e: React.PointerEvent, clip: EngineClip, edge: 'in' | 'out') => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const edgeFrame = edge === 'in'
      ? Math.round(toSeconds(clip.startTime) * fps)
      : Math.round((toSeconds(clip.startTime) + toSeconds(clip.duration)) * fps);
    trimRef.current = { clipId: clip.id, edge, startX: e.clientX, startFrame: edgeFrame, startRevision: engine.project.revision };
  }, [fps, engine.project.revision]);

  const handleTrimPointerMove = useCallback((e: React.PointerEvent) => {
    if (!trimRef.current) return;
    const dx = e.clientX - trimRef.current.startX;
    const rawFrame = Math.max(0, trimRef.current.startFrame + Math.round(dx / pxPerFrame));
    const snapped = snapFrame(rawFrame, snapPoints, snapThreshold, snapEnabled);
    updateSession({
      trimDraft: {
        clipId: trimRef.current.clipId,
        edge: trimRef.current.edge,
        originalFrame: trimRef.current.startFrame,
        currentFrame: snapped,
        startRevision: trimRef.current.startRevision,
      }
    });
  }, [pxPerFrame, updateSession, snapPoints, snapThreshold, snapEnabled]);

  const handleTrimPointerUp = useCallback((e: React.PointerEvent) => {
    if (!trimRef.current || !activeSequence) {
      trimRef.current = null;
      updateSession({ trimDraft: null });
      return;
    }
    const dx = e.clientX - trimRef.current.startX;
    const rawFrame = Math.max(0, trimRef.current.startFrame + Math.round(dx / pxPerFrame));
    const snapped = snapFrame(rawFrame, snapPoints, snapThreshold, snapEnabled);
    if (Math.abs(snapped - trimRef.current.startFrame) > 0) {
      const newTime = fromSeconds(snapped / fps, 30000);
      dispatch(
        makeOp('clip.trim', { sequenceId: activeSequence.id, clipId: trimRef.current.clipId, edge: trimRef.current.edge, newTime, ripple: rippleEnabled }),
        `Trim ${trimRef.current.edge}`
      );
    }
    trimRef.current = null;
    updateSession({ trimDraft: null });
  }, [pxPerFrame, fps, activeSequence, dispatch, updateSession, rippleEnabled, snapPoints, snapThreshold, snapEnabled]);

  // ── Razor ─────────────────────────────────────────────────

  const handleRazorClick = useCallback((e: React.MouseEvent, clip: EngineClip) => {
    if (tool !== 'razor' || !activeSequence) return;
    e.stopPropagation();
    const splitTime = fromSeconds(playback.frameIndex / fps, 30000);
    // Split linked clips together
    const linkedIds = clip.linkGroupId
      ? activeSequence.clips.filter((c) => c.linkGroupId === clip.linkGroupId).map((c) => c.id)
      : [clip.id];
    const ops = linkedIds.map((id) => makeOp('clip.split', { sequenceId: activeSequence.id, clipId: id, splitTime }));
    dispatchBatch(ops, 'Split clip(s)');
  }, [tool, activeSequence, playback.frameIndex, fps, dispatchBatch]);

  // ── Context menu ──────────────────────────────────────────

  const handleClipContextMenu = useCallback((e: React.MouseEvent, clip: EngineClip) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, clipId: clip.id });
  }, []);

  const handleContextAction = useCallback((action: string) => {
    if (!activeSequence || !contextMenu) return;
    const clipId = contextMenu.clipId;
    const clip = activeSequence.clips.find((c) => c.id === clipId);
    setContextMenu(null);
    if (!clip) return;
    const seqId = activeSequence.id;

    switch (action) {
      case 'split': {
        const splitTime = fromSeconds(playback.frameIndex / fps, 30000);
        dispatch(makeOp('clip.split', { sequenceId: seqId, clipId, splitTime }), 'Split');
        break;
      }
      case 'delete':
        dispatch(makeOp('clip.delete', { sequenceId: seqId, clipIds: [clipId] }), 'Delete');
        updateSession({ selectedClipIds: new Set() });
        break;
      case 'ripple-delete':
        dispatch(makeOp('clip.rippleDelete', { sequenceId: seqId, clipIds: [clipId] }), 'Ripple delete');
        updateSession({ selectedClipIds: new Set() });
        break;
      case 'duplicate': {
        const newId = generateId('clip');
        dispatch(makeOp('clip.duplicate', { sequenceId: seqId, clipId, newClipId: newId }), 'Duplicate');
        break;
      }
      case 'enable': dispatch(makeOp('clip.enable', { sequenceId: seqId, clipId, enabled: !clip.disabled }), clip.disabled ? 'Enable' : 'Disable');
        break;
      case 'unlink': dispatch(makeOp('clip.unlink', { sequenceId: seqId, clipId }), 'Unlink');
        break;
      case 'add-marker': {
        const marker: Marker = { id: generateId('marker'), time: fromSeconds(playback.frameIndex / fps, 30000), label: 'Marker', color: '#3b82ff' };
        dispatch(makeOp('marker.add', { sequenceId: seqId, marker }), 'Add marker');
        break;
      }
      case 'cross-dissolve': {
        const transition = {
          id: generateId('tr'),
          type: 'cross-dissolve' as const,
          duration: fromSeconds(0.5, 30000),
          clipAId: clipId,
          clipBId: clipId,
          edge: 'cut-point' as const,
        };
        dispatch(makeOp('transition.upsert', { sequenceId: seqId, transition }), 'Add cross dissolve');
        break;
      }
      case 'open-precomp': {
        if (clip.precompId) {
          engine.updateSession({ activeSequenceOverride: engine.project.precomps[clip.precompId]?.sequenceId ?? null } as any);
        }
        break;
      }
      case 'dissolve-precomp': {
        if (clip.precompId) {
          dispatch(makeOp('precomp.dissolve', { precompId: clip.precompId, sequenceId: seqId }), 'Dissolve precomp');
        }
        break;
      }
    }
  }, [activeSequence, contextMenu, playback.frameIndex, fps, dispatch, updateSession, engine]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener('pointerdown', handler);
    return () => window.removeEventListener('pointerdown', handler);
  }, [contextMenu]);

  // ── Marker add ────────────────────────────────────────────

  const handleAddMarker = useCallback(() => {
    if (!activeSequence) return;
    const marker: Marker = {
      id: generateId('marker'),
      time: fromSeconds(playback.frameIndex / fps, 30000),
      label: 'Marker',
      color: '#3b82ff',
    };
    dispatch(makeOp('marker.add', { sequenceId: activeSequence.id, marker }), 'Add marker');
  }, [activeSequence, playback.frameIndex, fps, dispatch]);

  // ── Close gap ─────────────────────────────────────────────

  const handleCloseGap = useCallback(() => {
    if (!activeSequence) return;
    const targetTrack = activeSequence.tracks.find((t) => t.targeted && (t.kind === 'video' || t.kind === 'audio'));
    if (!targetTrack) return;
    const gapStartTime = fromSeconds(playback.frameIndex / fps, 30000);
    dispatch(makeOp('timeline.closeGap', { sequenceId: activeSequence.id, trackId: targetTrack.id, gapStartTime }), 'Close gap');
  }, [activeSequence, playback.frameIndex, fps, dispatch]);

  // ── Fit timeline ──────────────────────────────────────────

  const handleFitTimeline = useCallback(() => {
    if (!bodyRef.current || totalFrames === 0) return;
    const containerWidth = bodyRef.current.clientWidth - 20;
    const newZoom = containerWidth / (totalFrames * 0.12);
    onZoomChange(Math.max(0.1, Math.min(10, newZoom)));
    updateSession({ scrollX: 0 });
  }, [totalFrames, onZoomChange, updateSession]);

  return (
    <div
      style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--color-bg)', borderTop: '1px solid var(--color-border)', minHeight: 0, overflow: 'hidden' }}
    >
      {/* Precomp breadcrumb — shown when inside a nested sequence */}
      {activeSequence?.isPrecomp && (
        <div style={{ height: '24px', display: 'flex', alignItems: 'center', gap: '6px', padding: '0 10px', background: 'rgba(139,92,246,0.08)', borderBottom: '1px solid rgba(139,92,246,0.2)', flexShrink: 0 }}>
          <button
            onClick={() => updateSession({ activeSequenceOverride: null } as any)}
            style={{ fontSize: '10px', color: 'var(--color-accent-2)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: '3px', display: 'flex', alignItems: 'center', gap: '3px' }}
            title="Return to parent sequence"
            aria-label="Return to parent sequence"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M6 2L2 5l4 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Parent
          </button>
          <span style={{ fontSize: '10px', color: 'var(--color-subtle)' }}>/</span>
          <span style={{ fontSize: '10px', color: 'var(--color-accent-2)', fontWeight: 500 }}>⬡ {activeSequence.name}</span>
        </div>
      )}

      {/* Timeline toolbar */}
      <div style={{ height: '32px', display: 'flex', alignItems: 'center', gap: '4px', padding: '0 8px', backgroundColor: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        {/* Zoom controls */}
        <button className="btn-icon" onClick={() => onZoomChange(Math.max(0.1, zoom * 0.8))} title="Zoom out (-)" aria-label="Zoom out" style={{ padding: '3px' }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.3" /><path d="M3 5h4M8 8l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
        </button>
        <input type="range" min={0.1} max={8} step={0.05} value={zoom} onChange={(e) => onZoomChange(parseFloat(e.target.value))} className="range-slider" style={{ width: '56px' }} aria-label="Timeline zoom" />
        <button className="btn-icon" onClick={() => onZoomChange(Math.min(10, zoom * 1.25))} title="Zoom in (+)" aria-label="Zoom in" style={{ padding: '3px' }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.3" /><path d="M5 3v4M3 5h4M8 8l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
        </button>
        <button className="btn-icon" onClick={handleFitTimeline} title="Fit timeline (\\)" aria-label="Fit timeline" style={{ padding: '3px', fontSize: '10px', color: 'var(--color-subtle)' }}>fit</button>

        <div style={{ width: '1px', height: '16px', background: 'var(--color-border)', margin: '0 2px' }} aria-hidden="true" />

        <button
          className="btn-ghost"
          onClick={onSnapToggle}
          style={{ fontSize: '10px', padding: '2px 7px', color: snapEnabled ? 'var(--color-accent)' : 'var(--color-subtle)', background: snapEnabled ? 'rgba(59,130,255,0.1)' : 'transparent', border: `1px solid ${snapEnabled ? 'rgba(59,130,255,0.3)' : 'transparent'}` }}
          aria-pressed={snapEnabled} title="Toggle snap (N)"
        >Snap</button>

        <button
          className="btn-ghost"
          onClick={onRippleToggle}
          style={{ fontSize: '10px', padding: '2px 7px', color: rippleEnabled ? 'var(--color-accent-3)' : 'var(--color-subtle)', background: rippleEnabled ? 'rgba(34,211,238,0.1)' : 'transparent', border: `1px solid ${rippleEnabled ? 'rgba(34,211,238,0.3)' : 'transparent'}` }}
          aria-pressed={rippleEnabled} title="Toggle ripple (R)"
        >Ripple</button>

        <button className="btn-icon" onClick={handleAddMarker} title="Add marker (M)" aria-label="Add marker" style={{ padding: '3px', color: 'var(--color-accent-3)' }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M6 1v7M3 4h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><circle cx="6" cy="10" r="1.5" fill="currentColor" /></svg>
        </button>

        <button className="btn-icon" onClick={handleCloseGap} title="Close gap at playhead" aria-label="Close gap" style={{ padding: '3px', color: 'var(--color-subtle)' }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 6h3M7 6h3M5 4l2 2-2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>

        <div style={{ flex: 1 }} />
        <span className="timecode" style={{ fontSize: '10px', color: 'var(--color-subtle)', fontFamily: 'var(--font-mono)' }} aria-label="Sequence duration">
          {formatTimecode(totalFrames, fps)}
        </span>
      </div>

      {/* Timeline body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* Track headers */}
        <div style={{ width: `${TRACK_HEADER_W}px`, flexShrink: 0, borderRight: '1px solid var(--color-border)', overflowY: 'hidden', backgroundColor: 'var(--color-surface)' }}>
          <div style={{ height: '20px', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-elevated)' }} />
          {sortedTracks.map((track) => (
            <TrackHeader
              key={track.id}
              track={track}
              onMute={toggleMute}
              onSolo={toggleSolo}
              onLock={toggleLock}
              onTarget={toggleTarget}
              onHide={toggleHide}
            />
          ))}
        </div>

        {/* Scrollable track area */}
        <div
          ref={bodyRef}
          style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', position: 'relative', cursor: tool === 'razor' ? 'crosshair' : 'default' }}
          onPointerDown={handleTimelinePointerDown}
          onPointerMove={handleTimelinePointerMove}
          onPointerUp={handleTimelinePointerUp}
        >
          <div style={{ width: `${totalWidth}px`, position: 'relative', userSelect: 'none' }}>
            <TimelineRuler totalWidth={totalWidth} pxPerFrame={pxPerFrame} totalFrames={totalFrames} fps={fps} />

            {sortedTracks.map((track) => {
              const trackClips = clips.filter((c) => c.trackId === track.id);
              const trackTransitions = (activeSequence?.transitions ?? []).filter(
                (tr) => trackClips.some((c) => c.id === tr.clipAId || c.id === tr.clipBId)
              );
              return (
                <TrackLane
                  key={track.id}
                  track={track}
                  clips={trackClips}
                  pxPerFrame={pxPerFrame}
                  selectedClipIds={session.selectedClipIds}
                  onSelectClip={onSelectClip}
                  tool={tool}
                  onClipPointerDown={handleClipPointerDown}
                  onClipPointerMove={handleClipPointerMove}
                  onClipPointerUp={handleClipPointerUp}
                  onTrimPointerDown={handleTrimPointerDown}
                  onTrimPointerMove={handleTrimPointerMove}
                  onTrimPointerUp={handleTrimPointerUp}
                  onRazorClick={handleRazorClick}
                  onContextMenu={handleClipContextMenu}
                  dragDraft={session.dragDraft}
                  trimDraft={session.trimDraft}
                  transitions={trackTransitions}
                  onTransitionClick={(id) => setSelectedTransitionId(id)}
                  onDoubleClickPrecomp={(precompId) => {
                    const precomp = engine.project.precomps[precompId];
                    if (precomp) updateSession({ activeSequenceOverride: precomp.sequenceId } as any);
                  }}
                />
              );
            })}

            {/* Markers */}
            {markers.map((marker) => {
              const px = Math.round(toSeconds(marker.time) * fps) * pxPerFrame;
              return (
                <div key={marker.id} style={{ position: 'absolute', top: 0, left: `${px}px`, width: '1px', height: '100%', background: marker.color ?? 'var(--color-accent-3)', opacity: 0.7, pointerEvents: 'none', zIndex: 5 }} aria-hidden="true">
                  <div style={{ position: 'absolute', top: '20px', left: '2px', fontSize: '9px', color: marker.color ?? 'var(--color-accent-3)', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', background: 'rgba(0,0,0,0.6)', padding: '1px 3px', borderRadius: '2px' }}>{marker.label}</div>
                </div>
              );
            })}

            {/* Range select overlay */}
            {rangeSelect && (
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  top: '20px',
                  left: `${Math.min(rangeSelect.startPx, rangeSelect.endPx)}px`,
                  width: `${Math.abs(rangeSelect.endPx - rangeSelect.startPx)}px`,
                  height: 'calc(100% - 20px)',
                  background: 'rgba(59,130,255,0.08)',
                  border: '1px solid rgba(59,130,255,0.3)',
                  pointerEvents: 'none',
                  zIndex: 4,
                }}
              />
            )}

            {/* Playhead */}
            <div
              className="playhead-blade"
              style={{ left: `${playheadPx}px`, position: 'absolute', top: 0, bottom: 0, width: '1px', background: 'var(--color-danger)', zIndex: 10, pointerEvents: 'none' }}
              aria-hidden="true"
            >
              <div style={{ position: 'absolute', top: '14px', left: '-4px', width: '9px', height: '9px', background: 'var(--color-danger)', clipPath: 'polygon(50% 100%, 0 0, 100% 0)' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          role="menu"
          style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, background: 'var(--color-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 500, minWidth: '160px', overflow: 'hidden' }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {[
            { label: 'Split at Playhead', action: 'split' },
            { label: 'Duplicate', action: 'duplicate' },
            { label: '—', action: '' },
            { label: 'Delete', action: 'delete' },
            { label: 'Ripple Delete', action: 'ripple-delete' },
            { label: '—', action: '' },
            { label: 'Enable / Disable', action: 'enable' },
            { label: 'Unlink A/V', action: 'unlink' },
            { label: '—', action: '' },
            { label: 'Add Marker Here', action: 'add-marker' },
            { label: 'Add Cross Dissolve', action: 'cross-dissolve' },
            ...((() => {
              const clip = activeSequence?.clips.find((c) => c.id === contextMenu?.clipId);
              return clip?.precompId ? [
                { label: '—', action: '' },
                { label: 'Open Nested Sequence', action: 'open-precomp' },
                { label: 'Dissolve Precomp', action: 'dissolve-precomp' },
              ] : [];
            })()),
          ].map((item, i) =>
            item.label === '—' ? (
              <div key={i} style={{ height: '1px', background: 'var(--color-border)', margin: '2px 0' }} aria-hidden="true" />
            ) : (
              <button
                key={item.action}
                role="menuitem"
                onClick={() => handleContextAction(item.action)}
                style={{ display: 'block', width: '100%', padding: '6px 12px', textAlign: 'left', background: 'transparent', border: 'none', color: 'var(--color-fg)', fontSize: '12px', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(59,130,255,0.1)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {item.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────

interface TrackHeaderProps {
  track: EngineTrack;
  onMute: (id: string) => void;
  onSolo: (id: string) => void;
  onLock: (id: string) => void;
  onTarget: (id: string) => void;
  onHide: (id: string) => void;
}

function TrackHeader({ track, onMute, onSolo, onLock, onTarget, onHide }: TrackHeaderProps) {
  const TRACK_KIND_COLORS: Record<string, string> = {
    video: 'var(--color-accent)',
    audio: 'var(--color-accent-3)',
    caption: 'var(--color-success)',
    motion: 'var(--color-accent-2)',
    graphic: 'rgba(251,191,36,0.9)',
  };

  return (
    <div
      className="track-header"
      style={{
        height: `${track.height}px`,
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        gap: '3px',
        padding: '0 6px',
        opacity: track.muted ? 0.45 : 1,
        background: track.targeted ? 'rgba(59,130,255,0.04)' : 'transparent',
      }}
    >
      {/* Kind color bar */}
      <div
        style={{ width: '3px', height: '14px', borderRadius: '2px', background: TRACK_KIND_COLORS[track.kind] || 'var(--color-subtle)', flexShrink: 0, cursor: 'pointer', opacity: track.targeted ? 1 : 0.4 }}
        onClick={() => onTarget(track.id)}
        title={track.targeted ? 'Targeted (click to untarget)' : 'Click to target'}
        aria-label={`Track target: ${track.label}`}
      />
      {/* Label */}
      <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
        {track.label}
      </span>
      {/* Controls */}
      <div style={{ display: 'flex', gap: '1px', flexShrink: 0 }}>
        {(track.kind === 'video' || track.kind === 'graphic') && (
          <button
            className="btn-icon"
            onClick={() => onHide(track.id)}
            title={track.hidden ? 'Show track' : 'Hide track'}
            aria-label={track.hidden ? 'Show' : 'Hide'}
            style={{ padding: '2px', fontSize: '9px', color: track.hidden ? 'var(--color-danger)' : 'var(--color-subtle)', width: '18px', height: '18px' }}
          >
            {track.hidden ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M1 1l8 8M4.5 2.5A4 4 0 019 5c-.5.8-1.2 1.5-2 2M1 5c.5-.8 1.2-1.5 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><ellipse cx="5" cy="5" rx="4" ry="2.5" stroke="currentColor" strokeWidth="1.2" /><circle cx="5" cy="5" r="1.5" fill="currentColor" /></svg>
            )}
          </button>
        )}
        {(track.kind === 'audio') && (
          <button
            className="btn-icon"
            onClick={() => onMute(track.id)}
            title={track.muted ? 'Unmute' : 'Mute'}
            aria-label={track.muted ? 'Unmute' : 'Mute'}
            style={{ padding: '2px', fontSize: '9px', color: track.muted ? 'var(--color-danger)' : 'var(--color-subtle)', width: '18px', height: '18px' }}
          >M</button>
        )}
        {(track.kind === 'audio') && (
          <button
            className="btn-icon"
            onClick={() => onSolo(track.id)}
            title={track.solo ? 'Unsolo' : 'Solo'}
            aria-label={track.solo ? 'Unsolo' : 'Solo'}
            style={{ padding: '2px', fontSize: '9px', color: track.solo ? 'var(--color-accent-3)' : 'var(--color-subtle)', width: '18px', height: '18px' }}
          >S</button>
        )}
        <button
          className="btn-icon"
          onClick={() => onLock(track.id)}
          title={track.locked ? 'Unlock track' : 'Lock track'}
          aria-label={track.locked ? 'Unlock' : 'Lock'}
          style={{ padding: '2px', color: track.locked ? 'var(--color-accent-2)' : 'var(--color-subtle)', width: '18px', height: '18px' }}
        >
          {track.locked ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><rect x="2" y="4.5" width="6" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" /><path d="M3.5 4.5V3a1.5 1.5 0 013 0v1.5" stroke="currentColor" strokeWidth="1.2" /></svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><rect x="2" y="4.5" width="6" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" /><path d="M3.5 4.5V3a1.5 1.5 0 013 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Timeline ruler ─────────────────────────────────────────

function TimelineRuler({ totalWidth, pxPerFrame, totalFrames, fps }: { totalWidth: number; pxPerFrame: number; totalFrames: number; fps: number }) {
  const tickInterval = Math.max(1, Math.round(60 / pxPerFrame));
  const ticks: number[] = [];
  for (let f = 0; f <= totalFrames; f += tickInterval) ticks.push(f);

  return (
    <div style={{ height: '20px', position: 'relative', borderBottom: '1px solid var(--color-border)', background: 'var(--color-elevated)', overflow: 'hidden', userSelect: 'none' }} aria-hidden="true">
      {ticks.map((f) => {
        const x = f * pxPerFrame;
        const secs = f / fps;
        const m = Math.floor(secs / 60);
        const s = Math.floor(secs % 60);
        const label = `${m}:${String(s).padStart(2, '0')}`;
        return (
          <div key={f} style={{ position: 'absolute', left: `${x}px`, top: 0, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <div style={{ width: '1px', height: '6px', background: 'var(--color-border)', marginTop: '2px' }} />
            <span style={{ fontSize: '9px', color: 'var(--color-subtle)', fontFamily: 'var(--font-mono)', marginLeft: '2px', lineHeight: 1, marginTop: '1px' }}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Track lane ─────────────────────────────────────────────

interface TrackLaneProps {
  track: EngineTrack;
  clips: EngineClip[];
  pxPerFrame: number;
  selectedClipIds: Set<string>;
  onSelectClip: (id: string | null) => void;
  tool: ToolMode;
  onClipPointerDown: (e: React.PointerEvent, clip: EngineClip) => void;
  onClipPointerMove: (e: React.PointerEvent) => void;
  onClipPointerUp: (e: React.PointerEvent) => void;
  onTrimPointerDown: (e: React.PointerEvent, clip: EngineClip, edge: 'in' | 'out') => void;
  onTrimPointerMove: (e: React.PointerEvent) => void;
  onTrimPointerUp: (e: React.PointerEvent) => void;
  onRazorClick: (e: React.MouseEvent, clip: EngineClip) => void;
  onContextMenu: (e: React.MouseEvent, clip: EngineClip) => void;
  dragDraft: import('@/engine/store').DragDraft | null;
  trimDraft: import('@/engine/store').TrimDraft | null;
  transitions?: import('@/engine/schema').Transition[];
  onTransitionClick?: (transitionId: string) => void;
  onDoubleClickPrecomp?: (precompId: string) => void;
}

function TrackLane({
  track, clips, pxPerFrame, selectedClipIds, onSelectClip, tool,
  onClipPointerDown, onClipPointerMove, onClipPointerUp,
  onTrimPointerDown, onTrimPointerMove, onTrimPointerUp,
  onRazorClick, onContextMenu, dragDraft, trimDraft,
  transitions = [], onTransitionClick, onDoubleClickPrecomp,
}: TrackLaneProps) {
  if (track.hidden) {
    return <div style={{ height: `${track.height}px`, borderBottom: '1px solid var(--color-border)', background: 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(244,247,255,0.02) 4px, rgba(244,247,255,0.02) 8px)' }} />;
  }

  // Build transition map: clipId → transition
  const transitionByClipOut: Record<string, import('@/engine/schema').Transition> = {};
  for (const tr of transitions) {
    transitionByClipOut[tr.clipAId] = tr;
  }

  return (
    <div
      style={{ height: `${track.height}px`, borderBottom: '1px solid var(--color-border)', position: 'relative', background: track.locked ? 'rgba(244,247,255,0.01)' : 'transparent' }}
    >
      {clips.map((clip) => {
        const fps = 29.97;
        const startPx = (clip.startTime.value / clip.startTime.timescale) * fps * pxPerFrame;
        const widthPx = (clip.duration.value / clip.duration.timescale) * fps * pxPerFrame;

        // Apply drag draft visual offset
        let displayStartPx = startPx;
        if (dragDraft?.clipId === clip.id) {
          displayStartPx = dragDraft.currentStartFrame * pxPerFrame;
        }
        // Apply trim draft visual
        let displayWidthPx = widthPx;
        if (trimDraft?.clipId === clip.id) {
          if (trimDraft.edge === 'in') {
            const newStartPx = trimDraft.currentFrame * pxPerFrame;
            displayWidthPx = startPx + widthPx - newStartPx;
            displayStartPx = newStartPx;
          } else {
            displayWidthPx = trimDraft.currentFrame * pxPerFrame - startPx;
          }
        }

        const isSelected = selectedClipIds.has(clip.id);
        const bg = KIND_BG[clip.kind] ?? 'rgba(100,100,120,0.2)';
        const border = KIND_BORDER[clip.kind] ?? 'rgba(150,150,170,0.4)';
        const isPrecomp = !!clip.precompId;

        return (
          <div
            key={clip.id}
            style={{
              position: 'absolute',
              left: `${displayStartPx}px`,
              width: `${Math.max(displayWidthPx, 4)}px`,
              top: '2px',
              bottom: '2px',
              background: clip.disabled ? 'rgba(100,100,100,0.15)' : (isPrecomp ? 'rgba(139,92,246,0.18)' : bg),
              border: `1px solid ${isSelected ? 'var(--color-accent)' : (clip.disabled ? 'rgba(150,150,150,0.3)' : (isPrecomp ? 'rgba(139,92,246,0.5)' : border))}`,
              borderRadius: '3px',
              overflow: 'hidden',
              cursor: tool === 'razor' ? 'crosshair' : (track.locked ? 'not-allowed' : 'grab'),
              boxShadow: isSelected ? '0 0 0 1px var(--color-accent), inset 0 1px 0 rgba(255,255,255,0.08)' : 'inset 0 1px 0 rgba(255,255,255,0.05)',
              opacity: clip.disabled ? 0.45 : 1,
              userSelect: 'none',
              zIndex: isSelected ? 3 : 1,
            }}
            onPointerDown={(e) => !track.locked && onClipPointerDown(e, clip)}
            onPointerMove={onClipPointerMove}
            onPointerUp={onClipPointerUp}
            onClick={(e) => { if (tool === 'razor') onRazorClick(e, clip); else { e.stopPropagation(); onSelectClip(clip.id); } }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (clip.precompId && onDoubleClickPrecomp) {
                onDoubleClickPrecomp(clip.precompId);
              }
            }}
            onContextMenu={(e) => onContextMenu(e, clip)}
            title={`${clip.name}${clip.disabled ? ' (disabled)' : ''}${clip.linkGroupId ? ' [linked]' : ''}${isPrecomp ? ' [nested]' : ''}`}
          >
            {/* Clip label */}
            <div style={{ padding: '2px 6px', fontSize: '10px', fontWeight: 600, color: 'rgba(244,247,255,0.85)', fontFamily: 'var(--font-sans)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.4, display: 'flex', alignItems: 'center', gap: '4px' }}>
              {isPrecomp && <span style={{ fontSize: '8px', color: 'var(--color-accent-2)', flexShrink: 0 }} title="Nested sequence" aria-label="Nested sequence">⬡</span>}
              {clip.name}
              {clip.linkGroupId && <span style={{ marginLeft: '4px', opacity: 0.5, fontSize: '8px' }}>⛓</span>}
              {clip.speed !== 1 && <span style={{ marginLeft: '4px', color: 'var(--color-accent-3)', fontSize: '9px' }}>{clip.speed}×</span>}
            </div>

            {/* Waveform placeholder for audio */}
            {clip.kind === 'audio' && (
              <div style={{ position: 'absolute', bottom: '2px', left: '4px', right: '4px', height: '12px', display: 'flex', alignItems: 'center', gap: '1px', opacity: 0.4 }} aria-hidden="true">
                {Array.from({ length: Math.min(40, Math.floor(displayWidthPx / 4)) }).map((_, i) => (
                  <div key={i} style={{ flex: 1, background: 'var(--color-accent-3)', borderRadius: '1px', height: `${20 + Math.sin(i * 0.8) * 15 + Math.cos(i * 1.3) * 10}%` }} />
                ))}
              </div>
            )}

            {/* Nested sequence stripe pattern */}
            {isPrecomp && (
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(139,92,246,0.06) 6px, rgba(139,92,246,0.06) 12px)',
                  pointerEvents: 'none',
                }}
              />
            )}

            {/* Trim handles */}
            {!track.locked && tool === 'select' && (
              <>
                <div
                  style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '6px', cursor: 'ew-resize', background: 'rgba(255,255,255,0.08)', borderRight: '1px solid rgba(255,255,255,0.12)', zIndex: 2 }}
                  onPointerDown={(e) => { e.stopPropagation(); onTrimPointerDown(e, clip, 'in'); }}
                  onPointerMove={onTrimPointerMove}
                  onPointerUp={onTrimPointerUp}
                  title="Trim in"
                  aria-label="Trim in handle"
                />
                <div
                  style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '6px', cursor: 'ew-resize', background: 'rgba(255,255,255,0.08)', borderLeft: '1px solid rgba(255,255,255,0.12)', zIndex: 2 }}
                  onPointerDown={(e) => { e.stopPropagation(); onTrimPointerDown(e, clip, 'out'); }}
                  onPointerMove={onTrimPointerMove}
                  onPointerUp={onTrimPointerUp}
                  title="Trim out"
                  aria-label="Trim out handle"
                />
              </>
            )}
          </div>
        );
      })}

      {/* Transition affordances */}
      {transitions.map((tr) => {
        const clipA = clips.find((c) => c.id === tr.clipAId);
        if (!clipA) return null;
        const clipAEndSecs = (clipA.startTime.value / clipA.startTime.timescale) + (clipA.duration.value / clipA.duration.timescale);
        const trDurSecs = tr.duration.value / tr.duration.timescale;
        const trWidthPx = Math.max(trDurSecs * 29.97 * pxPerFrame, 8);
        const trCenterPx = clipAEndSecs * 29.97 * pxPerFrame;
        const trLeftPx = trCenterPx - trWidthPx / 2;

        const TRANSITION_LABELS: Record<string, string> = {
          'cut': '✂',
          'cross-dissolve': '⊕',
          'dip-to-black': '◼',
          'dip-to-white': '◻',
          'fade-to-black': '▼',
          'fade-from-black': '▲',
          'audio-crossfade': '♫',
          'wipe': '▷',
        };

        return (
          <div
            key={tr.id}
            onClick={(e) => { e.stopPropagation(); onTransitionClick?.(tr.id); }}
            title={`${tr.type} · ${(trDurSecs * 1000).toFixed(0)}ms`}
            aria-label={`Transition: ${tr.type}`}
            style={{
              position: 'absolute',
              left: `${trLeftPx}px`,
              width: `${trWidthPx}px`,
              top: '25%',
              height: '50%',
              background: 'rgba(59,130,255,0.25)',
              border: '1px solid rgba(59,130,255,0.5)',
              borderRadius: '2px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '9px',
              color: 'var(--color-accent)',
              cursor: 'pointer',
              zIndex: 6,
              pointerEvents: 'all',
            }}
          >
            {TRANSITION_LABELS[tr.type] ?? '⊕'}
          </div>
        );
      })}
    </div>
  );
}