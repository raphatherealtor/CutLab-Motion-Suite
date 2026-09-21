'use client';

import React, { useState, useCallback } from 'react';
import { useEngine } from '@/engine/store';
import { makeOp } from '@/engine/operations';
import { fromSeconds } from '@/engine/time';
import { generateId, DEFAULT_TRANSFORM } from '@/engine/schema';
import type { Precomp, Sequence, Track, Clip } from '@/engine/schema';

export default function PrecompPanel() {
  const engine = useEngine();
  const { project, activeSequence, session, dispatch, dispatchBatch, updateSession } = engine;
  const [precompName, setPrecompName] = useState('Nested Sequence');

  const fps = activeSequence?.format.fps ?? 29.97;
  const selectedClips = activeSequence
    ? activeSequence.clips.filter((c) => session.selectedClipIds.has(c.id))
    : [];

  // Breadcrumb: find parent chain
  const activeSeq = activeSequence;
  const parentPrecomp = activeSeq?.isPrecomp
    ? Object.values(project.precomps).find((p) => p.sequenceId === activeSeq.id)
    : null;
  const parentSeq = parentPrecomp ? project.sequences[parentPrecomp.parentSequenceId] : null;

  // All precomps in current sequence (clips that reference a precomp)
  const precompsInSeq = activeSequence
    ? activeSequence.clips
        .filter((c) => c.precompId)
        .map((c) => ({ clip: c, precomp: project.precomps[c.precompId!] }))
        .filter((x) => x.precomp)
    : [];

  const handlePrecompose = useCallback(() => {
    if (!activeSequence || selectedClips.length === 0) return;

    const seqId = activeSequence.id;
    const newPrecompId = generateId('precomp');
    const newSeqId = generateId('seq');

    // Compute bounding time of selected clips
    const minStart = Math.min(...selectedClips.map((c) => c.startTime.value / c.startTime.timescale));
    const maxEnd = Math.max(...selectedClips.map((c) => (c.startTime.value / c.startTime.timescale) + (c.duration.value / c.duration.timescale)));
    const totalDuration = maxEnd - minStart;

    // Build child sequence tracks (one per kind present)
    const kindsPresent = [...new Set(selectedClips.map((c) => c.kind))];
    const childTracks: Track[] = kindsPresent.map((kind, i) => ({
      id: generateId('track'),
      kind: kind as Track['kind'],
      label: kind === 'video' ? 'V1' : kind === 'audio' ? 'A1' : kind.toUpperCase(),
      muted: false,
      solo: false,
      locked: false,
      height: kind === 'video' ? 56 : kind === 'audio' ? 48 : 36,
      gain: 0,
      order: i,
      targeted: i === 0,
    }));

    // Remap clips to child sequence (offset by minStart)
    const childClips: Clip[] = selectedClips.map((c) => {
      const kindTrack = childTracks.find((t) => t.kind === c.kind) ?? childTracks[0];
      return {
        ...c,
        trackId: kindTrack.id,
        startTime: fromSeconds((c.startTime.value / c.startTime.timescale) - minStart, 30000),
        precompId: newPrecompId,
      };
    });

    const childSeq: Sequence = {
      id: newSeqId,
      name: precompName,
      format: activeSequence.format,
      tracks: childTracks,
      clips: childClips,
      markers: [],
      captions: [],
      transitions: [],
      cues: [],
      isPrecomp: true,
      parentSequenceId: seqId,
    };

    // Parent clip that replaces selected clips
    const parentClip: Clip = {
      id: generateId('clip'),
      kind: 'video',
      trackId: selectedClips[0].trackId,
      name: precompName,
      startTime: fromSeconds(minStart, 30000),
      duration: fromSeconds(totalDuration, 30000),
      sourceIn: fromSeconds(0, 30000),
      sourceOut: fromSeconds(totalDuration, 30000),
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
      precompId: newPrecompId,
    };

    const precomp: Precomp = {
      id: newPrecompId,
      name: precompName,
      sequenceId: newSeqId,
      parentSequenceId: seqId,
      parentClipId: parentClip.id,
      createdAt: Date.now(),
    };

    dispatch(
      makeOp('precomp.create', {
        precomp,
        childSequence: childSeq,
        parentClip,
        sourceClipIds: selectedClips.map((c) => c.id),
      }),
      'Precompose selection'
    );
    updateSession({ selectedClipIds: new Set([parentClip.id]) });
  }, [activeSequence, selectedClips, precompName, dispatch, updateSession]);

  const handleEnterPrecomp = useCallback((precomp: Precomp) => {
    const childSeq = project.sequences[precomp.sequenceId];
    if (!childSeq) return;
    updateSession({ activeSequenceOverride: precomp.sequenceId } as any);
  }, [project.sequences, updateSession]);

  const handleReturnToParent = useCallback(() => {
    if (!parentPrecomp) return;
    updateSession({ activeSequenceOverride: null } as any);
  }, [parentPrecomp, updateSession]);

  const handleDissolve = useCallback((precompId: string) => {
    if (!activeSequence) return;
    dispatch(
      makeOp('precomp.dissolve', { precompId, sequenceId: activeSequence.id }),
      'Dissolve precomp'
    );
  }, [activeSequence, dispatch]);

  const handleDuplicate = useCallback((precompId: string) => {
    dispatch(
      makeOp('precomp.duplicate', {
        precompId,
        newPrecompId: generateId('precomp'),
        newSequenceId: generateId('seq'),
      }),
      'Duplicate precomp'
    );
  }, [dispatch]);

  const handleOpenPrecomp = useCallback((precomp: Precomp) => {
    // Switch active sequence to child sequence
    updateSession({ activeSequenceOverride: precomp.sequenceId } as any);
  }, [updateSession]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Breadcrumb */}
      <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, background: 'var(--color-elevated)' }}>
        {parentSeq && parentPrecomp ? (
          <>
            <button
              onClick={handleReturnToParent}
              style={{ fontSize: '10px', color: 'var(--color-accent)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: '3px' }}
              title="Return to parent sequence"
              aria-label="Return to parent sequence"
            >
              ← {parentSeq.name}
            </button>
            <span style={{ fontSize: '10px', color: 'var(--color-subtle)' }}>/</span>
            <span style={{ fontSize: '10px', color: 'var(--color-fg)', fontWeight: 500 }}>{activeSeq?.name}</span>
          </>
        ) : (
          <span style={{ fontSize: '10px', color: 'var(--color-muted)', fontWeight: 500 }}>
            {activeSeq?.name ?? 'Main Sequence'}
          </span>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
        {/* Precompose selection */}
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '10px', color: 'var(--color-subtle)', fontWeight: 500, letterSpacing: '0.04em', marginBottom: '6px' }}>PRECOMPOSE SELECTION</div>
          {selectedClips.length === 0 ? (
            <div style={{ fontSize: '11px', color: 'var(--color-subtle)', padding: '8px', background: 'var(--color-elevated)', borderRadius: 'var(--radius)', border: '1px solid var(--color-border)' }}>
              Select clips on the timeline to precompose them.
            </div>
          ) : (
            <div>
              <div style={{ fontSize: '11px', color: 'var(--color-muted)', marginBottom: '6px' }}>
                {selectedClips.length} clip{selectedClips.length !== 1 ? 's' : ''} selected
              </div>
              <input
                type="text"
                value={precompName}
                onChange={(e) => setPrecompName(e.target.value)}
                placeholder="Nested sequence name"
                style={{
                  width: '100%',
                  background: 'var(--color-elevated)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-fg)',
                  fontSize: '12px',
                  padding: '6px 8px',
                  marginBottom: '6px',
                  boxSizing: 'border-box',
                  fontFamily: 'var(--font-sans)',
                }}
                aria-label="Precomp name"
              />
              <button
                className="btn-primary"
                onClick={handlePrecompose}
                style={{ width: '100%', fontSize: '12px', padding: '7px' }}
                aria-label="Precompose selected clips"
              >
                Precompose
              </button>
            </div>
          )}
        </div>

        {/* Existing precomps in this sequence */}
        {precompsInSeq.length > 0 && (
          <div>
            <div style={{ fontSize: '10px', color: 'var(--color-subtle)', fontWeight: 500, letterSpacing: '0.04em', marginBottom: '6px' }}>NESTED SEQUENCES</div>
            {precompsInSeq.map(({ clip, precomp }) => {
              const childSeq = project.sequences[precomp.sequenceId];
              const clipCount = childSeq?.clips.length ?? 0;
              return (
                <div
                  key={precomp.id}
                  style={{
                    background: 'var(--color-elevated)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius)',
                    padding: '8px 10px',
                    marginBottom: '6px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--color-accent-2)', flexShrink: 0 }}>⬡</span>
                    <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-fg)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {precomp.name}
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--color-subtle)', flexShrink: 0 }}>
                      {clipCount} clip{clipCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      className="btn-ghost"
                      onClick={() => handleOpenPrecomp(precomp)}
                      style={{ flex: 1, fontSize: '10px', padding: '4px 6px' }}
                      aria-label={`Open ${precomp.name}`}
                    >
                      Open
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() => handleDuplicate(precomp.id)}
                      style={{ flex: 1, fontSize: '10px', padding: '4px 6px' }}
                      aria-label={`Duplicate ${precomp.name}`}
                    >
                      Duplicate
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() => handleDissolve(precomp.id)}
                      style={{ flex: 1, fontSize: '10px', padding: '4px 6px', color: 'var(--color-danger)' }}
                      aria-label={`Dissolve ${precomp.name}`}
                    >
                      Dissolve
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {precompsInSeq.length === 0 && selectedClips.length === 0 && (
          <div style={{ fontSize: '11px', color: 'var(--color-subtle)', textAlign: 'center', padding: '16px 0', lineHeight: 1.6 }}>
            Select clips to precompose them into a nested sequence, or double-click a precomp clip on the timeline to enter it.
          </div>
        )}
      </div>
    </div>
  );
}
