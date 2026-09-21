'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { PlaybackState } from './EditorClient';
import { useEngine } from '@/engine/store';
import { makeOp } from '@/engine/operations';
import { fromSeconds, toSeconds } from '@/engine/time';
import { usePlaybackClock } from '@/engine/playback-clock';
import { buildRenderPlan } from '@/engine/render-plan';
import { renderFrame, startVideoPlayback, pauseVideoPlayback,  } from '@/engine/compositor';


interface ViewerPanelProps {
  playback: PlaybackState;
  onPlay: () => void;
  onSeek: (frame: number) => void;
}

// Safe area ratios (action/title safe)
const ACTION_SAFE = 0.05;
const TITLE_SAFE = 0.1;

type ManipMode = 'move' | 'rotate' | 'scale' | 'crop-left' | 'crop-right' | 'crop-top' | 'crop-bottom';

export default function ViewerPanel({ playback, onPlay, onSeek }: ViewerPanelProps) {
  const engine = useEngine();
  const { activeSequence, session, updateSession, dispatch, project } = engine;
  const [aspect, setAspect] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const viewerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const isPlayingRef = useRef(false);
  const fps = activeSequence?.format.fps ?? 29.97;
  const totalFrames = playback.totalFrames || 300;
  const progress = totalFrames > 0 ? playback.frameIndex / totalFrames : 0;

  // Wire playback clock
  usePlaybackClock(
    session.playing,
    session.playheadFrame,
    fps,
    totalFrames,
    (frame) => updateSession({ playheadFrame: frame }),
    () => updateSession({ playing: false })
  );

  // ── Canvas rendering ──────────────────────────────────────

  const renderCurrentFrame = useCallback(async (frameIndex: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const plan = buildRenderPlan(project, frameIndex);
    if (!plan) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }

    // Resize canvas if needed
    if (canvas.width !== plan.width || canvas.height !== plan.height) {
      canvas.width = plan.width;
      canvas.height = plan.height;
    }

    await renderFrame(ctx, plan, project, { playing: isPlayingRef.current });
  }, [project]);

  // Render on playhead change (scrubbing / static)
  useEffect(() => {
    if (!session.playing) {
      renderCurrentFrame(session.playheadFrame);
    }
  }, [session.playheadFrame, session.playing, renderCurrentFrame]);

  // Playback loop — render each frame as playback clock advances
  useEffect(() => {
    isPlayingRef.current = session.playing;

    if (session.playing) {
      // Start video elements
      const plan = buildRenderPlan(project, session.playheadFrame);
      if (plan) startVideoPlayback(plan, project);

      // rAF render loop
      const loop = () => {
        if (!isPlayingRef.current) return;
        renderCurrentFrame(session.playheadFrame);
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } else {
      // Pause video elements
      pauseVideoPlayback();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [session.playing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-render when project changes (e.g. after undo/redo)
  useEffect(() => {
    if (!session.playing) {
      renderCurrentFrame(session.playheadFrame);
    }
  }, [project.revision]); // eslint-disable-line react-hooks/exhaustive-deps

  // Viewer direct manipulation
  const viewerDraftRef = useRef<{
    clipId: string;
    startX: number;
    startY: number;
    startTransformX: number;
    startTransformY: number;
    startRotation: number;
    startScaleX: number;
    startScaleY: number;
    startCropLeft: number;
    startCropRight: number;
    startCropTop: number;
    startCropBottom: number;
    startRevision: number;
    mode: ManipMode;
    viewerW: number;
    viewerH: number;
  } | null>(null);

  // Live drag preview: render frame with an in-progress transform offset applied
  const renderDragPreview = useCallback(async (
    clipId: string,
    mode: ManipMode,
    dx: number,
    dy: number,
    startTransformX: number,
    startTransformY: number,
    startRotation: number,
    startScaleX: number,
    viewerW: number,
    viewerH: number,
  ) => {
    const canvas = canvasRef.current;
    if (!canvas || !activeSequence) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const plan = buildRenderPlan(project, session.playheadFrame);
    if (!plan) return;

    if (canvas.width !== plan.width || canvas.height !== plan.height) {
      canvas.width = plan.width;
      canvas.height = plan.height;
    }

    // Compute the live transform for the dragged clip
    let liveTransform: Partial<import('@/engine/schema').Transform> | null = null;
    if (mode === 'move') {
      liveTransform = { x: startTransformX + dx, y: startTransformY + dy };
    } else if (mode === 'rotate') {
      liveTransform = { rotation: startRotation + dx * 0.5 };
    } else if (mode === 'scale') {
      const newScale = Math.max(0.05, startScaleX + dx / viewerW);
      liveTransform = { scaleX: newScale, scaleY: newScale };
    }

    // Patch the render plan layer for this clip with the live transform
    if (liveTransform) {
      const layer = plan.layers.find((l: any) => l.clipId === clipId);
      if (layer && layer.transform) {
        layer.transform = { ...layer.transform, ...liveTransform };
      }
    }

    await renderFrame(ctx, plan, project, { playing: false });
  }, [project, activeSequence, session.playheadFrame]);

  function handleScrub(e: React.ChangeEvent<HTMLInputElement>) {
    const frame = Math.round(parseFloat(e.target.value) * totalFrames);
    onSeek(frame);
  }

  function handleMarkIn() {
    updateSession({ inPoint: session.playheadFrame });
    if (activeSequence) {
      const inPoint = fromSeconds(session.playheadFrame / fps, 30000);
      dispatch(makeOp('sequence.setInOut', { sequenceId: activeSequence.id, inPoint }), 'Mark In');
    }
  }

  function handleMarkOut() {
    updateSession({ outPoint: session.playheadFrame });
    if (activeSequence) {
      const outPoint = fromSeconds(session.playheadFrame / fps, 30000);
      dispatch(makeOp('sequence.setInOut', { sequenceId: activeSequence.id, outPoint }), 'Mark Out');
    }
  }

  function handleClearInOut() {
    updateSession({ inPoint: null, outPoint: null });
    if (activeSequence) {
      dispatch(makeOp('sequence.setInOut', { sequenceId: activeSequence.id, inPoint: undefined, outPoint: undefined }), 'Clear In/Out');
    }
  }

  // Check if a property has a keyframe at the current playhead
  function getKeyframeAtPlayhead(clipId: string, property: string): string | null {
    if (!activeSequence) return null;
    const clip = activeSequence.clips.find((c) => c.id === clipId);
    if (!clip) return null;
    const playheadSecs = session.playheadFrame / fps;
    const clipStartSecs = toSeconds(clip.startTime);
    const localSecs = playheadSecs - clipStartSecs;
    const threshold = 1 / fps;
    const kf = clip.keyframes.find((k) => k.property === property && Math.abs(toSeconds(k.time) - localSecs) < threshold);
    return kf?.id ?? null;
  }

  // Commit viewer manipulation — updates keyframe if one exists at playhead, else base property
  function commitTransform(clipId: string, transform: Partial<import('@/engine/schema').Transform>) {
    if (!activeSequence) return;

    const hasKeyframeProps = Object.keys(transform).filter((prop) => getKeyframeAtPlayhead(clipId, prop) !== null);

    if (hasKeyframeProps.length > 0) {
      const ops = hasKeyframeProps.map((prop) => {
        const kfId = getKeyframeAtPlayhead(clipId, prop)!;
        const value = (transform as any)[prop] as number;
        return makeOp('keyframe.upsert', {
          sequenceId: activeSequence.id,
          clipId,
          keyframe: {
            id: kfId,
            time: fromSeconds((session.playheadFrame / fps) - toSeconds(activeSequence.clips.find((c) => c.id === clipId)!.startTime), 30000),
            property: prop,
            value,
            easing: 'linear',
          },
        });
      });
      const nonKeyedProps = Object.fromEntries(
        Object.entries(transform).filter(([p]) => !hasKeyframeProps.includes(p))
      );
      if (Object.keys(nonKeyedProps).length > 0) {
        ops.push(makeOp('clip.setTransform', { sequenceId: activeSequence.id, clipId, transform: nonKeyedProps }));
      }
      engine.dispatchBatch(ops, 'Update keyframe(s)');
    } else {
      dispatch(makeOp('clip.setTransform', { sequenceId: activeSequence.id, clipId, transform }), 'Transform in viewer');
    }
  }

  const handleViewerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>, mode: ManipMode = 'move') => {
    if (!activeSequence || session.selectedClipIds.size === 0) return;
    const clipId = Array.from(session.selectedClipIds)[0];
    const clip = activeSequence.clips.find((c) => c.id === clipId);
    if (!clip || (clip.kind !== 'video' && clip.kind !== 'graphic' && clip.kind !== 'motion')) return;

    const track = activeSequence.tracks.find((t) => t.id === clip.trackId);
    if (track?.locked) return;

    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    viewerDraftRef.current = {
      clipId,
      startX: e.clientX,
      startY: e.clientY,
      startTransformX: clip.transform.x,
      startTransformY: clip.transform.y,
      startRotation: clip.transform.rotation,
      startScaleX: clip.transform.scaleX,
      startScaleY: clip.transform.scaleY,
      startCropLeft: clip.transform.cropLeft,
      startCropRight: clip.transform.cropRight,
      startCropTop: clip.transform.cropTop,
      startCropBottom: clip.transform.cropBottom,
      startRevision: project.revision,
      mode,
      viewerW: rect.width,
      viewerH: rect.height,
    };
    updateSession({
      viewerDraft: {
        clipId,
        property: mode,
        originalValue: clip.transform.x,
        currentValue: clip.transform.x,
        startRevision: project.revision,
      }
    });
  }, [activeSequence, session.selectedClipIds, project.revision, updateSession]);

  const handleViewerPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!viewerDraftRef.current) return;
    const dx = e.clientX - viewerDraftRef.current.startX;
    const dy = e.clientY - viewerDraftRef.current.startY;
    const { mode, viewerW, viewerH, clipId, startTransformX, startTransformY, startRotation, startScaleX } = viewerDraftRef.current;
    let draftValue = startTransformX + dx;
    if (mode === 'rotate') draftValue = startRotation + dx * 0.5;
    else if (mode === 'scale') draftValue = startScaleX + dx / viewerW;
    updateSession({
      viewerDraft: {
        clipId: viewerDraftRef.current.clipId,
        property: mode,
        originalValue: startTransformX,
        currentValue: draftValue,
        startRevision: viewerDraftRef.current.startRevision,
      }
    });
    // Live canvas preview — render the frame with the in-progress transform so the element follows the cursor
    renderDragPreview(clipId, mode, dx, dy, startTransformX, startTransformY, startRotation, startScaleX, viewerW, viewerH);
  }, [updateSession, renderDragPreview]);

  const handleViewerPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!viewerDraftRef.current || !activeSequence) {
      viewerDraftRef.current = null;
      updateSession({ viewerDraft: null });
      return;
    }
    const dx = e.clientX - viewerDraftRef.current.startX;
    const dy = e.clientY - viewerDraftRef.current.startY;
    const { mode, viewerW, viewerH, clipId } = viewerDraftRef.current;

    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      let transform: Partial<import('@/engine/schema').Transform> = {};
      if (mode === 'move') {
        let newX = viewerDraftRef.current.startTransformX + dx;
        let newY = viewerDraftRef.current.startTransformY + dy;
        if (session.guidesVisible) {
          if (Math.abs(newX) < 8) newX = 0;
          if (Math.abs(newY) < 8) newY = 0;
        }
        transform = { x: newX, y: newY };
      } else if (mode === 'rotate') {
        transform = { rotation: viewerDraftRef.current.startRotation + dx * 0.5 };
      } else if (mode === 'scale') {
        const newScale = Math.max(0.05, viewerDraftRef.current.startScaleX + dx / viewerW);
        transform = { scaleX: newScale, scaleY: newScale };
      } else if (mode === 'crop-left') {
        transform = { cropLeft: Math.max(0, Math.min(0.9, viewerDraftRef.current.startCropLeft + dx / viewerW)) };
      } else if (mode === 'crop-right') {
        transform = { cropRight: Math.max(0, Math.min(0.9, viewerDraftRef.current.startCropRight - dx / viewerW)) };
      } else if (mode === 'crop-top') {
        transform = { cropTop: Math.max(0, Math.min(0.9, viewerDraftRef.current.startCropTop + dy / viewerH)) };
      } else if (mode === 'crop-bottom') {
        transform = { cropBottom: Math.max(0, Math.min(0.9, viewerDraftRef.current.startCropBottom - dy / viewerH)) };
      }
      commitTransform(clipId, transform);
    }
    viewerDraftRef.current = null;
    updateSession({ viewerDraft: null });
  }, [activeSequence, dispatch, updateSession, session.guidesVisible]);

  const viewerAspectStyle =
    aspect === '9:16'
      ? { width: '160px', aspectRatio: '9/16' as const }
      : aspect === '1:1'
      ? { width: '240px', aspectRatio: '1/1' as const }
      : { width: '100%', aspectRatio: '16/9' as const };

  const selectedClip = session.selectedClipIds.size > 0 && activeSequence
    ? activeSequence.clips.find((c) => c.id === Array.from(session.selectedClipIds)[0])
    : null;

  const isManipulable = selectedClip && (selectedClip.kind === 'video' || selectedClip.kind === 'graphic' || selectedClip.kind === 'motion');
  const isLocked = selectedClip && activeSequence?.tracks.find((t) => t.id === selectedClip.trackId)?.locked;

  return (
    <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)', minHeight: 0 }}>
      {/* Cinema well */}
      <div
        ref={viewerRef}
        className="well-inset"
        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px', minHeight: '200px', maxHeight: '320px', position: 'relative', overflow: 'hidden' }}
        onPointerDown={(e) => handleViewerPointerDown(e, 'move')}
        onPointerMove={handleViewerPointerMove}
        onPointerUp={handleViewerPointerUp}
      >
        <div
          style={{
            ...viewerAspectStyle,
            maxHeight: '100%',
            backgroundColor: '#000',
            borderRadius: '4px',
            overflow: 'hidden',
            position: 'relative',
            boxShadow: '0 0 0 1px rgba(244,247,255,0.08), 0 8px 32px rgba(0,0,0,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Real canvas compositor output */}
          <canvas
            ref={canvasRef}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
            }}
            aria-label="Video preview"
          />

          {/* Timecode overlay when no content */}
          {(!activeSequence || activeSequence.clips.length === 0) && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(244,247,255,0.08)', fontSize: '11px', fontFamily: 'var(--font-mono)', pointerEvents: 'none' }} aria-hidden="true">
              {playback.timecode}
            </div>
          )}

          {/* Safe areas overlay */}
          {session.safeAreasVisible && (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden="true">
              <div style={{ position: 'absolute', top: `${ACTION_SAFE * 100}%`, left: `${ACTION_SAFE * 100}%`, right: `${ACTION_SAFE * 100}%`, bottom: `${ACTION_SAFE * 100}%`, border: '1px solid rgba(59,130,255,0.25)', borderRadius: '1px' }} />
              <div style={{ position: 'absolute', top: `${TITLE_SAFE * 100}%`, left: `${TITLE_SAFE * 100}%`, right: `${TITLE_SAFE * 100}%`, bottom: `${TITLE_SAFE * 100}%`, border: '1px solid rgba(59,130,255,0.15)', borderRadius: '1px' }} />
              <div style={{ position: 'absolute', top: `${ACTION_SAFE * 100 + 1}%`, left: `${ACTION_SAFE * 100 + 2}%`, fontSize: '7px', color: 'rgba(59,130,255,0.4)', fontFamily: 'var(--font-mono)' }}>ACTION</div>
              <div style={{ position: 'absolute', top: `${TITLE_SAFE * 100 + 1}%`, left: `${TITLE_SAFE * 100 + 2}%`, fontSize: '7px', color: 'rgba(59,130,255,0.3)', fontFamily: 'var(--font-mono)' }}>TITLE</div>
            </div>
          )}

          {/* Center guides */}
          {session.guidesVisible && (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden="true">
              <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: '1px', background: 'rgba(59,130,255,0.12)' }} />
              <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '1px', background: 'rgba(59,130,255,0.12)' }} />
            </div>
          )}

          {/* Selected clip manipulation handles */}
          {isManipulable && !isLocked && (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden="true">
              <div style={{ position: 'absolute', inset: '15%', border: '1px solid rgba(59,130,255,0.5)', borderRadius: '2px', pointerEvents: 'none' }} />
              <div onPointerDown={(e) => { e.stopPropagation(); handleViewerPointerDown(e as any, 'crop-left'); }} style={{ position: 'absolute', left: '15%', top: '30%', bottom: '30%', width: '8px', background: 'rgba(59,130,255,0.6)', cursor: 'ew-resize', borderRadius: '2px', pointerEvents: 'all', transform: 'translateX(-50%)' }} title="Crop left" aria-label="Crop left handle" />
              <div onPointerDown={(e) => { e.stopPropagation(); handleViewerPointerDown(e as any, 'crop-right'); }} style={{ position: 'absolute', right: '15%', top: '30%', bottom: '30%', width: '8px', background: 'rgba(59,130,255,0.6)', cursor: 'ew-resize', borderRadius: '2px', pointerEvents: 'all', transform: 'translateX(50%)' }} title="Crop right" aria-label="Crop right handle" />
              <div onPointerDown={(e) => { e.stopPropagation(); handleViewerPointerDown(e as any, 'crop-top'); }} style={{ position: 'absolute', top: '15%', left: '30%', right: '30%', height: '8px', background: 'rgba(59,130,255,0.6)', cursor: 'ns-resize', borderRadius: '2px', pointerEvents: 'all', transform: 'translateY(-50%)' }} title="Crop top" aria-label="Crop top handle" />
              <div onPointerDown={(e) => { e.stopPropagation(); handleViewerPointerDown(e as any, 'crop-bottom'); }} style={{ position: 'absolute', bottom: '15%', left: '30%', right: '30%', height: '8px', background: 'rgba(59,130,255,0.6)', cursor: 'ns-resize', borderRadius: '2px', pointerEvents: 'all', transform: 'translateY(50%)' }} title="Crop bottom" aria-label="Crop bottom handle" />
              <div onPointerDown={(e) => { e.stopPropagation(); handleViewerPointerDown(e as any, 'scale'); }} style={{ position: 'absolute', right: '15%', bottom: '15%', width: '10px', height: '10px', background: 'rgba(59,130,255,0.8)', cursor: 'nwse-resize', borderRadius: '2px', pointerEvents: 'all', transform: 'translate(50%, 50%)' }} title="Scale (uniform)" aria-label="Scale handle" />
              <div onPointerDown={(e) => { e.stopPropagation(); handleViewerPointerDown(e as any, 'rotate'); }} style={{ position: 'absolute', top: '10%', left: '50%', width: '10px', height: '10px', background: 'rgba(34,211,238,0.8)', cursor: 'grab', borderRadius: '50%', pointerEvents: 'all', transform: 'translate(-50%, -50%)' }} title="Rotate" aria-label="Rotation handle" />
            </div>
          )}

          {isLocked && (
            <div style={{ position: 'absolute', top: '8px', right: '8px', fontSize: '9px', color: 'var(--color-accent-2)', background: 'rgba(139,92,246,0.15)', padding: '2px 5px', borderRadius: '3px', pointerEvents: 'none' }} aria-hidden="true">LOCKED</div>
          )}

          {session.viewerDraft && (
            <div style={{ position: 'absolute', top: '8px', right: '8px', fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--color-accent)', background: 'rgba(59,130,255,0.15)', padding: '2px 5px', borderRadius: '3px', pointerEvents: 'none' }} aria-hidden="true">
              {session.viewerDraft.property.toUpperCase()}
            </div>
          )}

          {playback.playing && (
            <div style={{ position: 'absolute', top: '8px', left: '8px', width: '5px', height: '5px', borderRadius: '50%', background: 'var(--color-danger)', boxShadow: '0 0 6px rgba(244,63,94,0.7)', animation: 'pulse 1s ease-in-out infinite' }} aria-label="Playing" role="status" />
          )}
        </div>
      </div>

      {/* Transport controls */}
      <div style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: 'var(--color-surface)', borderTop: '1px solid var(--color-border)', flexShrink: 0 }}>
        <button className="btn-icon" onClick={() => onSeek(0)} title="Go to start (Home)" aria-label="Skip to start">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true"><path d="M2 2v9M4 6.5l6-3.5v7L4 6.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>

        <button className="btn-icon" onClick={onPlay} title={playback.playing ? 'Pause (K)' : 'Play (Space / K)'} aria-label={playback.playing ? 'Pause' : 'Play'}
          style={{ width: '30px', height: '30px', background: playback.playing ? 'rgba(59,130,255,0.15)' : 'rgba(244,247,255,0.06)', border: `1px solid ${playback.playing ? 'rgba(59,130,255,0.4)' : 'var(--color-border)'}`, borderRadius: 'var(--radius-sm)', color: playback.playing ? 'var(--color-accent)' : 'var(--color-fg)' }}>
          {playback.playing ? (
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true"><rect x="2" y="2" width="3.5" height="9" rx="1" fill="currentColor" /><rect x="7.5" y="2" width="3.5" height="9" rx="1" fill="currentColor" /></svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true"><path d="M3 2l8 4.5-8 4.5V2z" fill="currentColor" /></svg>
          )}
        </button>

        <button className="btn-icon" onClick={() => onSeek(totalFrames)} title="Go to end (End)" aria-label="Skip to end">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true"><path d="M11 2v9M9 6.5L3 3v7l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>

        <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--color-muted)', minWidth: '72px', flexShrink: 0 }} aria-label={`Timecode ${playback.timecode}`}>{playback.timecode}</span>

        <div style={{ flex: 1, position: 'relative' }}>
          <input type="range" min={0} max={1} step={0.0001} value={progress} onChange={handleScrub} className="range-slider" aria-label="Playhead position" style={{ width: '100%' }} />
          {session.inPoint !== null && totalFrames > 0 && (
            <div aria-hidden="true" style={{ position: 'absolute', top: '50%', left: `${(session.inPoint / totalFrames) * 100}%`, transform: 'translateY(-50%)', width: '2px', height: '10px', background: 'var(--color-accent-3)', opacity: 0.8, borderRadius: '1px' }} />
          )}
          {session.outPoint !== null && totalFrames > 0 && (
            <div aria-hidden="true" style={{ position: 'absolute', top: '50%', left: `${(session.outPoint / totalFrames) * 100}%`, transform: 'translateY(-50%)', width: '2px', height: '10px', background: 'var(--color-accent-3)', opacity: 0.8, borderRadius: '1px' }} />
          )}
          {session.inPoint !== null && session.outPoint !== null && totalFrames > 0 && (
            <div aria-hidden="true" style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', left: `${(session.inPoint / totalFrames) * 100}%`, width: `${((session.outPoint - session.inPoint) / totalFrames) * 100}%`, height: '4px', background: 'rgba(34,211,238,0.2)', borderRadius: '2px', pointerEvents: 'none' }} />
          )}
        </div>

        <button className="btn-icon" onClick={handleMarkIn} title="Mark In (I)" aria-label="Mark In" style={{ fontSize: '10px', color: 'var(--color-subtle)', padding: '2px 5px' }}>I</button>
        <button className="btn-icon" onClick={handleMarkOut} title="Mark Out (O)" aria-label="Mark Out" style={{ fontSize: '10px', color: 'var(--color-subtle)', padding: '2px 5px' }}>O</button>
        {(session.inPoint !== null || session.outPoint !== null) && (
          <button className="btn-icon" onClick={handleClearInOut} title="Clear In/Out" aria-label="Clear In/Out" style={{ fontSize: '9px', color: 'var(--color-danger)', padding: '2px 4px' }}>✕</button>
        )}

        <div style={{ width: '1px', height: '14px', background: 'var(--color-border)' }} aria-hidden="true" />

        <button className="btn-icon" onClick={() => updateSession({ safeAreasVisible: !session.safeAreasVisible })} title="Safe areas (Shift+S)" aria-label="Toggle safe areas" aria-pressed={session.safeAreasVisible} style={{ fontSize: '9px', color: session.safeAreasVisible ? 'var(--color-accent)' : 'var(--color-subtle)', padding: '2px 5px' }}>SA</button>
        <button className="btn-icon" onClick={() => updateSession({ guidesVisible: !session.guidesVisible })} title="Center guides (G)" aria-label="Toggle guides" aria-pressed={session.guidesVisible} style={{ fontSize: '9px', color: session.guidesVisible ? 'var(--color-accent)' : 'var(--color-subtle)', padding: '2px 5px' }}>⊕</button>

        <select value={aspect} onChange={(e) => setAspect(e.target.value as typeof aspect)}
          style={{ fontSize: '10px', background: 'var(--color-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-muted)', borderRadius: '3px', padding: '2px 4px', cursor: 'pointer' }}
          aria-label="Viewer aspect ratio">
          <option value="16:9">16:9</option>
          <option value="9:16">9:16</option>
          <option value="1:1">1:1</option>
        </select>
      </div>
    </div>
  );
}