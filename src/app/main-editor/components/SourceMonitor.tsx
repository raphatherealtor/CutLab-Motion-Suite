'use client';

import React, { useState, useCallback, useRef } from 'react';
import { useEngine } from '@/engine/store';
import { makeOp } from '@/engine/operations';
import { fromSeconds } from '@/engine/time';
import type { Asset } from '@/engine/schema';
import { generateId, DEFAULT_TRANSFORM } from '@/engine/schema';
import { usePlaybackClock } from '@/engine/playback-clock';

export default function SourceMonitor() {
  const engine = useEngine();
  const { project, activeSequence, dispatch, session, updateSession } = engine;
  const fps = activeSequence?.format.fps ?? 29.97;

  const sm = session.sourceMonitor;
  const asset = sm.assetId ? project.assets[sm.assetId] : null;

  const totalFrames = asset?.durationFrames ?? 0;
  const inFrame = sm.inFrame ?? 0;
  const outFrame = sm.outFrame ?? totalFrames;
  const playheadFrame = sm.playheadFrame ?? 0;

  const progress = totalFrames > 0 ? playheadFrame / totalFrames : 0;

  // Source monitor playback clock
  usePlaybackClock(
    session.sourceMonitorPlaying,
    playheadFrame,
    fps,
    totalFrames,
    (frame) => updateSession({ sourceMonitor: { ...sm, playheadFrame: frame } }),
    () => updateSession({ sourceMonitorPlaying: false })
  );

  function handleScrub(e: React.ChangeEvent<HTMLInputElement>) {
    const frame = Math.round(parseFloat(e.target.value) * totalFrames);
    updateSession({ sourceMonitor: { ...sm, playheadFrame: frame } });
  }

  function handleMarkIn() {
    updateSession({ sourceMonitor: { ...sm, inFrame: playheadFrame } });
  }

  function handleMarkOut() {
    updateSession({ sourceMonitor: { ...sm, outFrame: playheadFrame } });
  }

  function handleClearInOut() {
    updateSession({ sourceMonitor: { ...sm, inFrame: null, outFrame: null } });
  }

  function buildClip(targetTrackId: string, kind: 'video' | 'audio', linkGroupId?: string) {
    if (!asset || !activeSequence) return null;
    const sourceInSecs = (sm.inFrame ?? 0) / fps;
    const sourceOutSecs = (sm.outFrame ?? totalFrames) / fps;
    const duration = fromSeconds(Math.max(0.1, sourceOutSecs - sourceInSecs), 30000);
    return {
      id: generateId('clip'),
      kind,
      trackId: targetTrackId,
      assetId: asset.id,
      name: asset.name,
      startTime: fromSeconds(session.playheadFrame / fps, 30000),
      duration,
      sourceIn: fromSeconds(sourceInSecs, 30000),
      sourceOut: fromSeconds(sourceOutSecs, 30000),
      transform: { ...DEFAULT_TRANSFORM },
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
      linkGroupId,
    };
  }

  function handleInsert() {
    if (!asset || !activeSequence) return;
    const insertTime = fromSeconds(session.playheadFrame / fps, 30000);

    const videoTrack = activeSequence.tracks.find((t) => t.kind === 'video' && t.targeted);
    const audioTrack = activeSequence.tracks.find((t) => t.kind === 'audio' && t.targeted);

    const ops = [];
    const linkGroupId = (asset.kind === 'video' && asset.hasAudio && videoTrack && audioTrack)
      ? generateId('link') : undefined;

    if (asset.kind === 'video' && videoTrack) {
      const clip = buildClip(videoTrack.id, 'video', linkGroupId);
      if (clip) ops.push(makeOp('timeline.insertEdit', { sequenceId: activeSequence.id, clip, insertTime, targetTrackId: videoTrack.id }));
      if (asset.hasAudio && audioTrack && linkGroupId) {
        const audioClip = buildClip(audioTrack.id, 'audio', linkGroupId);
        if (audioClip) {
          audioClip.startTime = insertTime;
          ops.push(makeOp('timeline.insertEdit', { sequenceId: activeSequence.id, clip: audioClip, insertTime, targetTrackId: audioTrack.id }));
        }
      }
    } else if (asset.kind === 'audio' && audioTrack) {
      const clip = buildClip(audioTrack.id, 'audio');
      if (clip) ops.push(makeOp('timeline.insertEdit', { sequenceId: activeSequence.id, clip, insertTime, targetTrackId: audioTrack.id }));
    } else if (asset.kind === 'image' && videoTrack) {
      const clip = buildClip(videoTrack.id, 'video');
      if (clip) ops.push(makeOp('timeline.insertEdit', { sequenceId: activeSequence.id, clip, insertTime, targetTrackId: videoTrack.id }));
    }

    if (ops.length > 0) {
      engine.dispatchBatch(ops, 'Insert edit');
    }
  }

  function handleOverwrite() {
    if (!asset || !activeSequence) return;
    const startTime = fromSeconds(session.playheadFrame / fps, 30000);

    const videoTrack = activeSequence.tracks.find((t) => t.kind === 'video' && t.targeted);
    const audioTrack = activeSequence.tracks.find((t) => t.kind === 'audio' && t.targeted);

    const linkGroupId = (asset.kind === 'video' && asset.hasAudio && videoTrack && audioTrack)
      ? generateId('link') : undefined;

    if (asset.kind === 'video' && videoTrack) {
      const clip = buildClip(videoTrack.id, 'video', linkGroupId);
      if (clip) dispatch(makeOp('timeline.overwriteEdit', { sequenceId: activeSequence.id, clip, startTime, targetTrackId: videoTrack.id }), 'Overwrite edit');
      if (asset.hasAudio && audioTrack && linkGroupId) {
        const audioClip = buildClip(audioTrack.id, 'audio', linkGroupId);
        if (audioClip) dispatch(makeOp('timeline.overwriteEdit', { sequenceId: activeSequence.id, clip: audioClip, startTime, targetTrackId: audioTrack.id }), 'Overwrite audio');
      }
    } else if (asset.kind === 'audio' && audioTrack) {
      const clip = buildClip(audioTrack.id, 'audio');
      if (clip) dispatch(makeOp('timeline.overwriteEdit', { sequenceId: activeSequence.id, clip, startTime, targetTrackId: audioTrack.id }), 'Overwrite edit');
    } else if (asset.kind === 'image' && videoTrack) {
      const clip = buildClip(videoTrack.id, 'video');
      if (clip) dispatch(makeOp('timeline.overwriteEdit', { sequenceId: activeSequence.id, clip, startTime, targetTrackId: videoTrack.id }), 'Overwrite edit');
    }
  }

  // Video-only / Audio-only placement
  function handleInsertVideoOnly() {
    if (!asset || !activeSequence) return;
    const videoTrack = activeSequence.tracks.find((t) => t.kind === 'video' && t.targeted);
    if (!videoTrack) return;
    const insertTime = fromSeconds(session.playheadFrame / fps, 30000);
    const clip = buildClip(videoTrack.id, 'video');
    if (clip) dispatch(makeOp('timeline.insertEdit', { sequenceId: activeSequence.id, clip, insertTime, targetTrackId: videoTrack.id }), 'Insert video only');
  }

  function handleInsertAudioOnly() {
    if (!asset || !activeSequence) return;
    const audioTrack = activeSequence.tracks.find((t) => t.kind === 'audio' && t.targeted);
    if (!audioTrack) return;
    const insertTime = fromSeconds(session.playheadFrame / fps, 30000);
    const clip = buildClip(audioTrack.id, 'audio');
    if (clip) dispatch(makeOp('timeline.insertEdit', { sequenceId: activeSequence.id, clip, insertTime, targetTrackId: audioTrack.id }), 'Insert audio only');
  }

  if (!asset) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '24px', textAlign: 'center' }}>
        <div style={{ fontSize: '22px', marginBottom: '8px', opacity: 0.25 }} aria-hidden="true">▶</div>
        <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginBottom: '3px' }}>No source selected</div>
        <div style={{ fontSize: '11px', color: 'var(--color-subtle)', lineHeight: 1.5 }}>
          Double-click a media asset in the Media Bin to open it here.
        </div>
      </div>
    );
  }

  const isMissing = asset.caste === 'missing' || asset.caste === 'failed';
  const hasLinkedAV = asset.kind === 'video' && asset.hasAudio;

  // Targeted tracks display
  const targetedVideo = activeSequence?.tracks.find((t) => t.kind === 'video' && t.targeted);
  const targetedAudio = activeSequence?.tracks.find((t) => t.kind === 'audio' && t.targeted);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Source preview well */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', position: 'relative', minHeight: '120px', maxHeight: '200px' }}>
        {isMissing ? (
          <div style={{ textAlign: 'center', padding: '16px' }}>
            <div style={{ fontSize: '11px', color: 'var(--color-danger)', marginBottom: '4px' }}>⚠ Media missing</div>
            <div style={{ fontSize: '10px', color: 'var(--color-subtle)' }}>{asset.name}</div>
          </div>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: 'rgba(244,247,255,0.3)', fontFamily: 'var(--font-mono)' }}>
              {asset.name}
            </div>
            {asset.width && (
              <div style={{ fontSize: '9px', color: 'rgba(244,247,255,0.2)', marginTop: '4px' }}>
                {asset.width}×{asset.height} · {asset.fps?.toFixed(2) ?? '—'} fps
              </div>
            )}
          </div>
        )}

        {/* In/Out range highlight */}
        {totalFrames > 0 && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              bottom: 0,
              left: `${(inFrame / totalFrames) * 100}%`,
              width: `${((outFrame - inFrame) / totalFrames) * 100}%`,
              height: '3px',
              background: 'rgba(34,211,238,0.6)',
            }}
          />
        )}
      </div>

      {/* Transport */}
      <div style={{ padding: '6px 8px', background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)', flexShrink: 0 }}>
        {/* Scrubber */}
        <div style={{ position: 'relative', marginBottom: '6px' }}>
          <input type="range" min={0} max={1} step={0.0001} value={progress}
            onChange={handleScrub}
            className="range-slider" style={{ width: '100%' }} aria-label="Source playhead" />
          {totalFrames > 0 && (
            <>
              <div aria-hidden="true" style={{ position: 'absolute', top: '50%', left: `${(inFrame / totalFrames) * 100}%`, transform: 'translateY(-50%)', width: '2px', height: '10px', background: 'var(--color-accent-3)', borderRadius: '1px' }} />
              <div aria-hidden="true" style={{ position: 'absolute', top: '50%', left: `${(outFrame / totalFrames) * 100}%`, transform: 'translateY(-50%)', width: '2px', height: '10px', background: 'var(--color-accent-3)', borderRadius: '1px' }} />
            </>
          )}
        </div>

        {/* Controls row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button className="btn-icon"
            onClick={() => updateSession({ sourceMonitor: { ...sm, playheadFrame: 0 } })}
            title="Go to start" aria-label="Source: go to start">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 2v8M4 6l5-3v6L4 6z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button className="btn-icon"
            onClick={() => updateSession({ sourceMonitorPlaying: !session.sourceMonitorPlaying })}
            style={{ width: '26px', height: '26px', background: session.sourceMonitorPlaying ? 'rgba(59,130,255,0.15)' : 'rgba(244,247,255,0.06)', border: `1px solid ${session.sourceMonitorPlaying ? 'rgba(59,130,255,0.4)' : 'var(--color-border)'}`, borderRadius: '4px' }}
            aria-label={session.sourceMonitorPlaying ? 'Pause source' : 'Play source'}>
            {session.sourceMonitorPlaying ? (
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true"><rect x="2" y="2" width="3" height="7" rx="1" fill="currentColor" /><rect x="6" y="2" width="3" height="7" rx="1" fill="currentColor" /></svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true"><path d="M2.5 2l7 3.5-7 3.5V2z" fill="currentColor" /></svg>
            )}
          </button>

          <div style={{ flex: 1 }} />

          <button className="btn-icon" onClick={handleMarkIn} title="Mark In (I)" aria-label="Mark source In" style={{ fontSize: '10px', color: 'var(--color-subtle)', padding: '2px 5px' }}>I</button>
          <button className="btn-icon" onClick={handleMarkOut} title="Mark Out (O)" aria-label="Mark source Out" style={{ fontSize: '10px', color: 'var(--color-subtle)', padding: '2px 5px' }}>O</button>
          {(sm.inFrame !== null || sm.outFrame !== null) && (
            <button className="btn-icon" onClick={handleClearInOut} title="Clear In/Out" aria-label="Clear source In/Out" style={{ fontSize: '9px', color: 'var(--color-danger)', padding: '2px 4px' }}>✕</button>
          )}
        </div>

        {/* In/Out display */}
        {(sm.inFrame !== null || sm.outFrame !== null) && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '4px', fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--color-subtle)' }}>
            <span>In: {sm.inFrame !== null ? (sm.inFrame / fps).toFixed(2) + 's' : '—'}</span>
            <span>Out: {sm.outFrame !== null ? (sm.outFrame / fps).toFixed(2) + 's' : '—'}</span>
            {sm.inFrame !== null && sm.outFrame !== null && (
              <span>Dur: {((sm.outFrame - sm.inFrame) / fps).toFixed(2)}s</span>
            )}
          </div>
        )}
      </div>

      {/* Track targeting display */}
      {activeSequence && (
        <div style={{ padding: '4px 8px', borderTop: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', gap: '6px', alignItems: 'center' }}>
          <span style={{ fontSize: '9px', color: 'var(--color-subtle)', flexShrink: 0 }}>Target:</span>
          {targetedVideo && (
            <span style={{ fontSize: '9px', color: 'var(--color-accent)', background: 'rgba(59,130,255,0.1)', padding: '1px 5px', borderRadius: '3px' }}>
              {targetedVideo.label}
            </span>
          )}
          {targetedAudio && (
            <span style={{ fontSize: '9px', color: 'var(--color-accent-3)', background: 'rgba(34,211,238,0.1)', padding: '1px 5px', borderRadius: '3px' }}>
              {targetedAudio.label}
            </span>
          )}
          {!targetedVideo && !targetedAudio && (
            <span style={{ fontSize: '9px', color: 'var(--color-danger)' }}>No targeted tracks</span>
          )}
        </div>
      )}

      {/* Insert / Overwrite */}
      <div style={{ padding: '6px 8px', borderTop: '1px solid var(--color-border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: '5px', marginBottom: hasLinkedAV ? '4px' : '0' }}>
          <button
            className="btn-ghost"
            onClick={handleInsert}
            disabled={!activeSequence || isMissing}
            style={{ flex: 1, fontSize: '11px', padding: '5px', color: 'var(--color-accent)', border: '1px solid rgba(59,130,255,0.3)', background: 'rgba(59,130,255,0.06)', opacity: (!activeSequence || isMissing) ? 0.4 : 1 }}
            title="Insert edit at playhead (linked A/V)"
            aria-label="Insert edit"
          >
            Insert
          </button>
          <button
            className="btn-ghost"
            onClick={handleOverwrite}
            disabled={!activeSequence || isMissing}
            style={{ flex: 1, fontSize: '11px', padding: '5px', color: 'var(--color-muted)', border: '1px solid var(--color-border)', opacity: (!activeSequence || isMissing) ? 0.4 : 1 }}
            title="Overwrite edit at playhead"
            aria-label="Overwrite edit"
          >
            Overwrite
          </button>
        </div>

        {/* Video-only / Audio-only for linked A/V assets */}
        {hasLinkedAV && (
          <div style={{ display: 'flex', gap: '5px' }}>
            <button
              className="btn-ghost"
              onClick={handleInsertVideoOnly}
              disabled={!activeSequence || isMissing}
              style={{ flex: 1, fontSize: '10px', padding: '3px', color: 'var(--color-subtle)', opacity: (!activeSequence || isMissing) ? 0.4 : 1 }}
              title="Insert video track only"
              aria-label="Insert video only"
            >
              V only
            </button>
            <button
              className="btn-ghost"
              onClick={handleInsertAudioOnly}
              disabled={!activeSequence || isMissing}
              style={{ flex: 1, fontSize: '10px', padding: '3px', color: 'var(--color-subtle)', opacity: (!activeSequence || isMissing) ? 0.4 : 1 }}
              title="Insert audio track only"
              aria-label="Insert audio only"
            >
              A only
            </button>
          </div>
        )}
      </div>

      {/* Asset info */}
      <div style={{ padding: '5px 8px', borderTop: '1px solid var(--color-border)', flexShrink: 0 }}>
        <div style={{ fontSize: '10px', color: 'var(--color-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {asset.name} · {asset.kind} · {isMissing ? <span style={{ color: 'var(--color-danger)' }}>missing</span> : asset.caste}
        </div>
      </div>
    </div>
  );
}
