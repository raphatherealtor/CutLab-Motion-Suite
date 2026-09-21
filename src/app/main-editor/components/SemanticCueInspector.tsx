'use client';

import React, { useState, useCallback } from 'react';
import { useEngine } from '@/engine/store';
import { makeOp } from '@/engine/operations';
import { fromSeconds, toSeconds, toTimecode } from '@/engine/time';
import type { SemanticCue } from '@/engine/schema';
import { generateId } from '@/engine/schema';

const CUE_TYPES: SemanticCue['type'][] = ['emphasis', 'beat', 'statistic', 'chapter', 'speaker-change', 'callout', 'highlight'];

const CUE_COLORS: Record<string, string> = {
  emphasis: '#f59e0b',
  beat: '#3b82ff',
  statistic: '#22d3ee',
  chapter: '#8b5cf6',
  'speaker-change': '#10b981',
  callout: '#f43f5e',
  highlight: '#fbbf24',
};

const CUE_DESCRIPTIONS: Record<string, string> = {
  emphasis: 'Marks a word or phrase for visual emphasis',
  beat: 'Rhythmic or musical beat point',
  statistic: 'Numeric or data point to surface',
  chapter: 'Section boundary or topic change',
  'speaker-change': 'Speaker transition point',
  callout: 'Annotation or callout target',
  highlight: 'General highlight or point of interest',
};

// Binding reference types for Motion/graphic integration seam
const BINDING_TYPES = [
  { id: 'word', label: 'Transcript Word', desc: 'Bind to a specific transcript word' },
  { id: 'caption', label: 'Caption', desc: 'Bind to a caption item' },
  { id: 'marker', label: 'Marker', desc: 'Bind to a timeline marker' },
  { id: 'clip', label: 'Clip', desc: 'Bind to a clip on the timeline' },
  { id: 'graphic', label: 'Graphic', desc: 'Bind to a graphic item' },
];

export default function SemanticCueInspector() {
  const engine = useEngine();
  const { activeSequence, dispatch, session, updateSession } = engine;
  const fps = activeSequence?.format.fps ?? 29.97;

  const [selectedCueId, setSelectedCueId] = useState<string | null>(null);
  const [newCueType, setNewCueType] = useState<SemanticCue['type']>('emphasis');
  const [showBindingFor, setShowBindingFor] = useState<string | null>(null);

  const cues = activeSequence?.cues ?? [];
  const sortedCues = [...cues].sort((a, b) => toSeconds(a.timeRange.start) - toSeconds(b.timeRange.start));

  const handleAddCue = useCallback(() => {
    if (!activeSequence) return;
    const t = fromSeconds(session.playheadFrame / fps, 30000);
    const cue: SemanticCue = {
      id: generateId('cue'),
      type: newCueType,
      timeRange: { start: t, end: fromSeconds(session.playheadFrame / fps + 1, 30000) },
    };
    dispatch(makeOp('cue.upsert', { sequenceId: activeSequence.id, cue }), `Add ${newCueType} cue`);
  }, [activeSequence, dispatch, session.playheadFrame, fps, newCueType]);

  const handleRemoveCue = useCallback((id: string) => {
    if (!activeSequence) return;
    dispatch(makeOp('cue.remove', { sequenceId: activeSequence.id, cueId: id }), 'Remove cue');
    if (selectedCueId === id) setSelectedCueId(null);
    if (showBindingFor === id) setShowBindingFor(null);
  }, [activeSequence, dispatch, selectedCueId, showBindingFor]);

  const handleSeekToCue = useCallback((cue: SemanticCue) => {
    const frame = Math.round(toSeconds(cue.timeRange.start) * fps);
    updateSession({ playheadFrame: frame });
    setSelectedCueId(cue.id);
  }, [fps, updateSession]);

  if (!activeSequence) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '24px', textAlign: 'center' }}>
        <div style={{ fontSize: '11px', color: 'var(--color-subtle)' }}>No active sequence</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Add cue */}
      <div style={{ padding: '8px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        <div style={{ fontSize: '10px', color: 'var(--color-subtle)', marginBottom: '5px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Add Cue at Playhead
        </div>
        <div style={{ display: 'flex', gap: '5px', alignItems: 'center', marginBottom: '4px' }}>
          <select
            value={newCueType}
            onChange={(e) => setNewCueType(e.target.value as SemanticCue['type'])}
            style={{
              flex: 1,
              background: 'var(--color-well)',
              border: '1px solid var(--color-border)',
              borderRadius: '3px',
              color: 'var(--color-muted)',
              fontSize: '11px',
              padding: '4px 6px',
            }}
            aria-label="Cue type"
          >
            {CUE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button
            className="btn-ghost"
            onClick={handleAddCue}
            style={{ fontSize: '11px', padding: '4px 10px', color: 'var(--color-accent)', flexShrink: 0 }}
            aria-label="Add cue at playhead"
            title="Add cue at current playhead position"
          >
            + Add
          </button>
        </div>
        {newCueType && (
          <div style={{ fontSize: '10px', color: 'var(--color-subtle)', lineHeight: 1.4 }}>
            {CUE_DESCRIPTIONS[newCueType]}
          </div>
        )}
      </div>

      {/* Cue list */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {sortedCues.length === 0 ? (
          <div style={{ padding: '28px 16px', textAlign: 'center' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ margin: '0 auto 8px', display: 'block', opacity: 0.2 }} aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.4" />
              <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginBottom: '3px' }}>No cues</div>
            <div style={{ fontSize: '11px', color: 'var(--color-subtle)', lineHeight: 1.4 }}>
              Add cues to mark semantic events — emphasis, beats, chapters, callouts.
            </div>
          </div>
        ) : (
          sortedCues.map((cue) => {
            const isSelected = selectedCueId === cue.id;
            const isBindingOpen = showBindingFor === cue.id;
            const color = CUE_COLORS[cue.type] ?? 'var(--color-accent)';
            const hasRefs = cue.transcriptWordId || cue.markerId || cue.clipId || cue.captionId || cue.graphicId;

            return (
              <div key={cue.id} style={{ borderBottom: '1px solid rgba(244,247,255,0.04)' }}>
                <div
                  onClick={() => handleSeekToCue(cue)}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '8px',
                    padding: '7px 8px',
                    background: isSelected ? 'rgba(59,130,255,0.06)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  {/* Color dot */}
                  <div
                    style={{ width: '8px', height: '8px', borderRadius: '50%', background: color, flexShrink: 0, marginTop: '3px' }}
                    aria-hidden="true"
                  />

                  {/* Cue info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-fg)', textTransform: 'capitalize' }}>
                        {cue.type}
                      </span>
                      <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--color-subtle)' }}>
                        {toTimecode(cue.timeRange.start, fps)}
                      </span>
                    </div>
                    {/* Reference badges */}
                    {hasRefs && (
                      <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                        {cue.transcriptWordId && <span style={{ fontSize: '9px', color: 'var(--color-accent)', background: 'rgba(59,130,255,0.1)', padding: '1px 4px', borderRadius: '3px', border: '1px solid rgba(59,130,255,0.2)' }}>word</span>}
                        {cue.markerId && <span style={{ fontSize: '9px', color: 'var(--color-accent)', background: 'rgba(59,130,255,0.1)', padding: '1px 4px', borderRadius: '3px', border: '1px solid rgba(59,130,255,0.2)' }}>marker</span>}
                        {cue.clipId && <span style={{ fontSize: '9px', color: 'var(--color-accent)', background: 'rgba(59,130,255,0.1)', padding: '1px 4px', borderRadius: '3px', border: '1px solid rgba(59,130,255,0.2)' }}>clip</span>}
                        {cue.captionId && <span style={{ fontSize: '9px', color: 'var(--color-accent)', background: 'rgba(59,130,255,0.1)', padding: '1px 4px', borderRadius: '3px', border: '1px solid rgba(59,130,255,0.2)' }}>caption</span>}
                        {cue.graphicId && <span style={{ fontSize: '9px', color: 'var(--color-accent)', background: 'rgba(59,130,255,0.1)', padding: '1px 4px', borderRadius: '3px', border: '1px solid rgba(59,130,255,0.2)' }}>graphic</span>}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
                    {/* Binding toggle */}
                    <button
                      className="btn-icon"
                      onClick={(e) => { e.stopPropagation(); setShowBindingFor(isBindingOpen ? null : cue.id); }}
                      style={{
                        fontSize: '9px',
                        color: isBindingOpen ? 'var(--color-accent)' : 'var(--color-subtle)',
                        padding: '2px 5px',
                        background: isBindingOpen ? 'rgba(59,130,255,0.1)' : 'transparent',
                        border: `1px solid ${isBindingOpen ? 'rgba(59,130,255,0.3)' : 'transparent'}`,
                        borderRadius: '3px',
                      }}
                      aria-label="Binding references"
                      title="Bind this cue to timeline entities"
                    >
                      ⊕
                    </button>
                    <button
                      className="btn-icon"
                      onClick={(e) => { e.stopPropagation(); handleRemoveCue(cue.id); }}
                      style={{ fontSize: '10px', color: 'var(--color-subtle)', padding: '2px 4px', opacity: 0.5 }}
                      aria-label="Remove cue"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Binding panel — Motion/graphic integration seam */}
                {isBindingOpen && (
                  <div style={{
                    padding: '8px 10px 10px',
                    background: 'rgba(139,92,246,0.04)',
                    borderTop: '1px solid rgba(139,92,246,0.15)',
                  }}>
                    <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-subtle)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '6px' }}>
                      Binding References
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--color-subtle)', lineHeight: 1.5, marginBottom: '8px' }}>
                      Bind this cue to timeline entities. Bindings are available to graphics and the Motion engine.
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {BINDING_TYPES.map((bt) => {
                        const isBound = (
                          (bt.id === 'word' && !!cue.transcriptWordId) ||
                          (bt.id === 'caption' && !!cue.captionId) ||
                          (bt.id === 'marker' && !!cue.markerId) ||
                          (bt.id === 'clip' && !!cue.clipId) ||
                          (bt.id === 'graphic' && !!cue.graphicId)
                        );
                        return (
                          <div key={bt.id} style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '7px',
                            padding: '4px 6px',
                            background: isBound ? 'rgba(139,92,246,0.1)' : 'rgba(244,247,255,0.03)',
                            border: `1px solid ${isBound ? 'rgba(139,92,246,0.3)' : 'var(--color-border)'}`,
                            borderRadius: '3px',
                          }}>
                            <div style={{
                              width: '6px',
                              height: '6px',
                              borderRadius: '50%',
                              background: isBound ? 'var(--color-accent-2)' : 'var(--color-border)',
                              flexShrink: 0,
                            }} />
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '10px', fontWeight: 600, color: isBound ? 'var(--color-fg)' : 'var(--color-muted)' }}>
                                {bt.label}
                              </div>
                              <div style={{ fontSize: '9px', color: 'var(--color-subtle)' }}>{bt.desc}</div>
                            </div>
                            <span style={{
                              fontSize: '9px',
                              color: isBound ? 'var(--color-accent-2)' : 'var(--color-subtle)',
                              fontFamily: 'var(--font-mono)',
                            }}>
                              {isBound ? 'bound' : 'unbound'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ marginTop: '6px', fontSize: '9px', color: 'var(--color-subtle)', lineHeight: 1.4 }}>
                      Binding IDs are set when a cue is created from a transcript word, caption, or graphic action.
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '6px 8px', borderTop: '1px solid var(--color-border)', flexShrink: 0 }}>
        <div style={{ fontSize: '9px', color: 'var(--color-subtle)', lineHeight: 1.5 }}>
          Cues are semantic metadata available to graphics, captions, and the Motion engine.
        </div>
      </div>
    </div>
  );
}
