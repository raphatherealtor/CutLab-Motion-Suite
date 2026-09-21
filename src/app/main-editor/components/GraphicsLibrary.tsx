'use client';

import React, { useState, useCallback } from 'react';
import { useEngine } from '@/engine/store';
import { makeOp } from '@/engine/operations';
import { fromSeconds } from '@/engine/time';
import type { Clip } from '@/engine/schema';
import { generateId, DEFAULT_TRANSFORM } from '@/engine/schema';

interface GraphicTemplate {
  type: Clip['graphicType'];
  label: string;
  icon: string;
  defaultParams: Record<string, string | number | boolean>;
  defaultDurationSecs: number;
}

const GRAPHIC_TEMPLATES: GraphicTemplate[] = [
  { type: 'title', label: 'Title', icon: 'T', defaultParams: { text: 'Title', fontSize: 48, color: '#ffffff', fontWeight: 700 }, defaultDurationSecs: 5 },
  { type: 'lower-third', label: 'Lower Third', icon: 'L3', defaultParams: { name: 'Name', title: 'Title', color: '#3b82ff' }, defaultDurationSecs: 4 },
  { type: 'callout', label: 'Callout', icon: '◉', defaultParams: { text: 'Callout', color: '#f43f5e' }, defaultDurationSecs: 3 },
  { type: 'image', label: 'Image', icon: '▣', defaultParams: { assetId: '', opacity: 1 }, defaultDurationSecs: 5 },
  { type: 'shape', label: 'Shape', icon: '■', defaultParams: { shape: 'rectangle', color: '#3b82ff', opacity: 0.8 }, defaultDurationSecs: 5 },
  { type: 'stat-card', label: 'Stat Card', icon: '#', defaultParams: { value: '100%', label: 'Metric', color: '#22d3ee' }, defaultDurationSecs: 4 },
  { type: 'logo', label: 'Logo', icon: '◆', defaultParams: { assetId: '', opacity: 1 }, defaultDurationSecs: 999 },
];

export default function GraphicsLibrary() {
  const engine = useEngine();
  const { activeSequence, dispatch, session, updateSession } = engine;
  const fps = activeSequence?.format.fps ?? 29.97;

  const [hoveredType, setHoveredType] = useState<string | null>(null);

  const handlePlaceGraphic = useCallback((template: GraphicTemplate) => {
    if (!activeSequence) return;
    const graphicTrack = activeSequence.tracks.find((t) => t.kind === 'graphic');
    if (!graphicTrack) return;

    const startTime = fromSeconds(session.playheadFrame / fps, 30000);
    const duration = fromSeconds(template.defaultDurationSecs, 30000);

    const clip: Clip = {
      id: generateId('clip'),
      kind: 'graphic',
      graphicType: template.type,
      trackId: graphicTrack.id,
      name: template.label,
      startTime,
      duration,
      sourceIn: fromSeconds(0, 30000),
      sourceOut: duration,
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
      graphicParams: { ...template.defaultParams },
      zOrder: activeSequence.clips.filter((c) => c.kind === 'graphic').length,
    };

    dispatch(makeOp('graphic.place', { sequenceId: activeSequence.id, clip }), `Place ${template.label}`);
    // Select the placed clip
    updateSession({ selectedClipIds: new Set([clip.id]), rightPanelTab: 'inspector' });
  }, [activeSequence, dispatch, session.playheadFrame, fps, updateSession]);

  const graphicClips = activeSequence?.clips.filter((c) => c.kind === 'graphic') ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Template grid */}
      <div style={{ padding: '8px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        <div style={{ fontSize: '10px', color: 'var(--color-subtle)', marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Place at Playhead</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
          {GRAPHIC_TEMPLATES.map((template) => (
            <button
              key={template.type}
              onClick={() => handlePlaceGraphic(template)}
              onMouseEnter={() => setHoveredType(template.type ?? null)}
              onMouseLeave={() => setHoveredType(null)}
              style={{
                background: hoveredType === template.type ? 'rgba(59,130,255,0.12)' : 'var(--color-elevated)',
                border: `1px solid ${hoveredType === template.type ? 'rgba(59,130,255,0.3)' : 'var(--color-border)'}`,
                borderRadius: '5px',
                padding: '8px 4px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                transition: 'background 100ms, border-color 100ms',
              }}
              aria-label={`Place ${template.label}`}
              title={`Place ${template.label} at playhead`}
            >
              <span style={{ fontSize: '16px', color: hoveredType === template.type ? 'var(--color-accent)' : 'var(--color-muted)', fontWeight: 700, fontFamily: 'var(--font-mono)' }} aria-hidden="true">
                {template.icon}
              </span>
              <span style={{ fontSize: '9px', color: 'var(--color-subtle)', textAlign: 'center', lineHeight: 1.2 }}>{template.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Placed graphics */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {graphicClips.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center' }}>
            <div style={{ fontSize: '11px', color: 'var(--color-subtle)' }}>No graphics placed. Click a template above to add one at the playhead.</div>
          </div>
        ) : (
          <>
            <div style={{ padding: '6px 8px 2px', fontSize: '10px', color: 'var(--color-subtle)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Placed Graphics ({graphicClips.length})
            </div>
            {[...graphicClips].sort((a, b) => (b.zOrder ?? 0) - (a.zOrder ?? 0)).map((clip) => {
              const template = GRAPHIC_TEMPLATES.find((t) => t.type === clip.graphicType);
              return (
                <div
                  key={clip.id}
                  onClick={() => updateSession({ selectedClipIds: new Set([clip.id]), rightPanelTab: 'inspector' })}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '7px',
                    padding: '6px 8px',
                    borderBottom: '1px solid rgba(244,247,255,0.04)',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontSize: '13px', color: 'var(--color-muted)', flexShrink: 0 }} aria-hidden="true">{template?.icon ?? '◈'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '11px', color: 'var(--color-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clip.name}</div>
                    <div style={{ fontSize: '9px', color: 'var(--color-subtle)' }}>{clip.graphicType}</div>
                  </div>
                  {clip.disabled && (
                    <span style={{ fontSize: '9px', color: 'var(--color-danger)', padding: '1px 4px', background: 'rgba(244,63,94,0.1)', borderRadius: '3px' }}>off</span>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
