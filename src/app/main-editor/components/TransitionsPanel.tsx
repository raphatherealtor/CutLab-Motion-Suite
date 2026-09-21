'use client';

import React, { useState, useCallback } from 'react';
import { useEngine } from '@/engine/store';
import { makeOp } from '@/engine/operations';
import { fromSeconds, toSeconds } from '@/engine/time';
import type { Transition } from '@/engine/schema';
import { generateId } from '@/engine/schema';

const TRANSITION_TYPES: { type: Transition['type']; label: string; icon: string }[] = [
  { type: 'cut', label: 'Cut', icon: '|' },
  { type: 'cross-dissolve', label: 'Cross Dissolve', icon: '⟷' },
  { type: 'dip-to-black', label: 'Dip to Black', icon: '◼' },
  { type: 'dip-to-white', label: 'Dip to White', icon: '◻' },
  { type: 'fade-to-black', label: 'Fade to Black', icon: '▼' },
  { type: 'fade-from-black', label: 'Fade from Black', icon: '▲' },
  { type: 'audio-crossfade', label: 'Audio Crossfade', icon: '♪' },
  { type: 'wipe', label: 'Wipe', icon: '→' },
];

export default function TransitionsPanel() {
  const engine = useEngine();
  const { activeSequence, dispatch, session } = engine;
  const fps = activeSequence?.format.fps ?? 29.97;

  const [selectedType, setSelectedType] = useState<Transition['type']>('cross-dissolve');
  const [duration, setDuration] = useState(0.5);
  const [selectedTransitionId, setSelectedTransitionId] = useState<string | null>(null);

  const transitions = activeSequence?.transitions ?? [];
  const selectedClipIds = Array.from(session.selectedClipIds);

  const handleAddTransition = useCallback(() => {
    if (!activeSequence) return;
    // Add to selected clips or at playhead
    const clips = activeSequence.clips;
    let clipAId = selectedClipIds[0] ?? '';
    let clipBId = selectedClipIds[1] ?? selectedClipIds[0] ?? '';

    if (!clipAId) {
      // Find clips around playhead
      const t = session.playheadFrame / fps;
      const nearby = clips.filter((c) => {
        const start = toSeconds(c.startTime);
        const end = start + toSeconds(c.duration);
        return Math.abs(end - t) < 1 || Math.abs(start - t) < 1;
      });
      if (nearby.length >= 1) clipAId = nearby[0].id;
      if (nearby.length >= 2) clipBId = nearby[1].id;
    }

    const transition: Transition = {
      id: generateId('tr'),
      type: selectedType,
      duration: fromSeconds(duration, 30000),
      clipAId,
      clipBId,
      edge: 'cut-point',
    };
    dispatch(makeOp('transition.upsert', { sequenceId: activeSequence.id, transition }), `Add ${selectedType}`);
  }, [activeSequence, dispatch, selectedType, duration, selectedClipIds, session.playheadFrame, fps]);

  const handleRemoveTransition = useCallback((id: string) => {
    if (!activeSequence) return;
    dispatch(makeOp('transition.remove', { sequenceId: activeSequence.id, transitionId: id }), 'Remove transition');
    if (selectedTransitionId === id) setSelectedTransitionId(null);
  }, [activeSequence, dispatch, selectedTransitionId]);

  const handleSetDuration = useCallback((id: string, secs: number) => {
    if (!activeSequence) return;
    dispatch(makeOp('transition.setProps', { sequenceId: activeSequence.id, transitionId: id, props: { duration: fromSeconds(secs, 30000) } }), 'Set transition duration');
  }, [activeSequence, dispatch]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Add transition */}
      <div style={{ padding: '8px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        <div style={{ fontSize: '10px', color: 'var(--color-subtle)', marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Add Transition</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginBottom: '8px' }}>
          {TRANSITION_TYPES.map(({ type, label, icon }) => (
            <button
              key={type}
              onClick={() => setSelectedType(type)}
              style={{
                background: selectedType === type ? 'rgba(59,130,255,0.15)' : 'var(--color-elevated)',
                border: `1px solid ${selectedType === type ? 'rgba(59,130,255,0.4)' : 'var(--color-border)'}`,
                borderRadius: '4px',
                padding: '4px 8px',
                fontSize: '10px',
                color: selectedType === type ? 'var(--color-accent)' : 'var(--color-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
              aria-pressed={selectedType === type}
              title={label}
            >
              <span aria-hidden="true">{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <span style={{ fontSize: '11px', color: 'var(--color-subtle)', flexShrink: 0 }}>Duration (s)</span>
          <input type="range" min={0.1} max={3} step={0.1} value={duration}
            onChange={(e) => setDuration(parseFloat(e.target.value))}
            className="range-slider" style={{ flex: 1 }} aria-label="Transition duration" />
          <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--color-fg)', minWidth: '28px' }}>{duration.toFixed(1)}s</span>
        </div>
        <button
          className="btn-ghost"
          onClick={handleAddTransition}
          style={{ width: '100%', fontSize: '11px', padding: '5px', color: 'var(--color-accent)', border: '1px solid rgba(59,130,255,0.3)', background: 'rgba(59,130,255,0.06)' }}
          aria-label="Add transition to selected clips"
        >
          + Add {TRANSITION_TYPES.find((t) => t.type === selectedType)?.label}
        </button>
        {selectedClipIds.length === 0 && (
          <div style={{ fontSize: '10px', color: 'var(--color-subtle)', marginTop: '4px', textAlign: 'center' }}>
            Select clips on the timeline, or transition will be placed at playhead
          </div>
        )}
      </div>

      {/* Existing transitions */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {transitions.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center' }}>
            <div style={{ fontSize: '11px', color: 'var(--color-subtle)' }}>No transitions applied</div>
          </div>
        ) : (
          transitions.map((tr) => {
            const isSelected = selectedTransitionId === tr.id;
            const typeInfo = TRANSITION_TYPES.find((t) => t.type === tr.type);
            const durationSecs = toSeconds(tr.duration);

            return (
              <div
                key={tr.id}
                onClick={() => setSelectedTransitionId(isSelected ? null : tr.id)}
                style={{
                  padding: '7px 8px',
                  borderBottom: '1px solid rgba(244,247,255,0.04)',
                  background: isSelected ? 'rgba(59,130,255,0.06)' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                  <span style={{ fontSize: '14px', opacity: 0.6 }} aria-hidden="true">{typeInfo?.icon ?? '⟷'}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-fg)' }}>{typeInfo?.label ?? tr.type}</div>
                    <div style={{ fontSize: '9px', color: 'var(--color-subtle)', fontFamily: 'var(--font-mono)' }}>{durationSecs.toFixed(2)}s</div>
                  </div>
                  <button
                    className="btn-icon"
                    onClick={(e) => { e.stopPropagation(); handleRemoveTransition(tr.id); }}
                    style={{ fontSize: '10px', color: 'var(--color-danger)', padding: '2px 4px' }}
                    aria-label="Remove transition"
                  >✕</button>
                </div>

                {isSelected && (
                  <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '10px', color: 'var(--color-subtle)' }}>Duration</span>
                    <input type="range" min={0.1} max={3} step={0.1}
                      defaultValue={durationSecs}
                      onMouseUp={(e) => handleSetDuration(tr.id, parseFloat((e.target as HTMLInputElement).value))}
                      className="range-slider" style={{ flex: 1 }} aria-label="Transition duration" />
                    <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--color-fg)', minWidth: '28px' }}>{durationSecs.toFixed(1)}s</span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
