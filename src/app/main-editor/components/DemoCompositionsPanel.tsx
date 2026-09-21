'use client';

/**
 * DemoCompositionsPanel — Cross-modal demonstration compositions.
 * Eight integrated examples demonstrating multiple systems together.
 * All remain editable after placement.
 */

import React, { useState, useCallback } from 'react';
import { useEngine } from '@/engine/store';
import { DEMO_COMPOSITIONS } from '@/engine/demo-compositions';
import { createMotionClipOps } from '@/engine/motion-bridge';


const SYSTEM_COLORS: Record<string, string> = {
  transcript: '#A78BFA',
  speech: '#A78BFA',
  semantic: '#EC4899',
  depth: '#3B82F6',
  camera: '#06B6D4',
  readability: '#10B981',
  audio: '#F59E0B',
  onset: '#EF4444',
  signal: '#F97316',
  material: '#8B5CF6',
  neon: '#00d4ff',
  subject: '#34D399',
  occlusion: '#6B7280',
  spatial: '#3B82F6',
  pause: '#9CA3AF',
  speaker: '#EC4899',
  'scene-script': '#F59E0B',
  panels: '#3B82F6',
  emphasis: '#EF4444',
  foreground: '#F97316',
  'frame-break': '#EF4444',
  svg: '#8B5CF6',
  parallax: '#06B6D4',
};

export default function DemoCompositionsPanel() {
  const engine = useEngine();
  const { activeSequence, session, dispatchBatch } = engine;
  const fps = activeSequence?.format.fps ?? 29.97;

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [placingId, setPlacingId] = useState<string | null>(null);

  const placeComposition = useCallback((demoId: string) => {
    const demo = DEMO_COMPOSITIONS.find((d) => d.id === demoId);
    if (!demo || !activeSequence) return;

    setPlacingId(demoId);

    try {
      const motionDoc = demo.create();
      const playheadSecs = session.playheadFrame / fps;
      const motionTrack = activeSequence.tracks.find((t) => t.kind === 'motion') ??
        activeSequence.tracks.find((t) => t.kind === 'graphic') ??
        activeSequence.tracks[0];
      if (!motionTrack) { setPlacingId(null); return; }
      const ops = createMotionClipOps({
        doc: motionDoc,
        sequenceId: activeSequence.id,
        trackId: motionTrack.id,
        startTimeSecs: playheadSecs,
        fps,
      });
      dispatchBatch(ops, `Place: ${demo.label}`);
    } finally {
      setPlacingId(null);
    }
  }, [activeSequence, session.playheadFrame, fps, dispatchBatch]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-fg)' }}>Cross-Modal Compositions</div>
        <div style={{ fontSize: '9px', color: 'var(--color-subtle)', marginTop: '2px' }}>
          Integrated examples · all editable after placement
        </div>
      </div>

      {/* Composition list */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {DEMO_COMPOSITIONS.map((demo) => {
          const isHovered = hoveredId === demo.id;
          const isPlacing = placingId === demo.id;

          return (
            <div
              key={demo.id}
              onMouseEnter={() => setHoveredId(demo.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                padding: '10px',
                borderBottom: '1px solid var(--color-border)',
                background: isHovered ? 'var(--color-well)' : 'transparent',
                transition: 'background 0.1s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-fg)', marginBottom: '3px' }}>
                    {demo.label}
                  </div>
                  <div style={{ fontSize: '9px', color: 'var(--color-subtle)', lineHeight: 1.5, marginBottom: '6px' }}>
                    {demo.description}
                  </div>

                  {/* System tags */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                    {demo.systems.map((sys) => (
                      <span
                        key={sys}
                        style={{
                          fontSize: '8px',
                          padding: '1px 5px',
                          borderRadius: '3px',
                          background: (SYSTEM_COLORS[sys] ?? '#6B7280') + '22',
                          color: SYSTEM_COLORS[sys] ?? '#6B7280',
                          border: `1px solid ${(SYSTEM_COLORS[sys] ?? '#6B7280')}44`,
                        }}
                      >
                        {sys}
                      </span>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => placeComposition(demo.id)}
                  disabled={isPlacing}
                  style={{
                    padding: '5px 10px',
                    background: isPlacing ? 'var(--color-well)' : 'rgba(139,92,246,0.15)',
                    border: '1px solid rgba(139,92,246,0.3)',
                    borderRadius: '4px',
                    color: isPlacing ? 'var(--color-subtle)' : '#A78BFA',
                    cursor: isPlacing ? 'default' : 'pointer',
                    fontSize: '10px',
                    fontFamily: 'var(--font-sans)',
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {isPlacing ? '...' : 'Place'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ padding: '6px 10px', borderTop: '1px solid var(--color-border)', flexShrink: 0, fontSize: '9px', color: 'var(--color-subtle)' }}>
        Placed compositions are fully editable through Motion Inspector.
        All results are canonical, undoable, and saved.
      </div>
    </div>
  );
}
