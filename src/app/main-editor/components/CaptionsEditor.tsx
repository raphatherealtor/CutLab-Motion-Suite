'use client';

import React, { useState, useCallback } from 'react';
import { useEngine } from '@/engine/store';
import { makeOp } from '@/engine/operations';
import { fromSeconds, toSeconds, toTimecode } from '@/engine/time';
import type { Caption, CaptionStyle } from '@/engine/schema';
import { generateId } from '@/engine/schema';

const STYLE_PRESETS: Record<string, CaptionStyle> = {
  default: { fontFamily: 'sans-serif', fontSize: 18, fontWeight: 400, color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.7)', position: 'bottom' },
  subtitle: { fontFamily: 'sans-serif', fontSize: 16, fontWeight: 400, color: '#f4f7ff', backgroundColor: 'rgba(0,0,0,0.8)', position: 'bottom' },
  title: { fontFamily: 'sans-serif', fontSize: 28, fontWeight: 700, color: '#ffffff', backgroundColor: 'transparent', position: 'middle' },
  social: { fontFamily: 'sans-serif', fontSize: 22, fontWeight: 700, color: '#ffffff', backgroundColor: 'rgba(59,130,255,0.85)', position: 'bottom' },
};

export default function CaptionsEditor() {
  const engine = useEngine();
  const { activeSequence, dispatch, session, updateSession } = engine;
  const fps = activeSequence?.format.fps ?? 29.97;

  const [selectedCaptionId, setSelectedCaptionId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const captions = activeSequence?.captions ?? [];
  const sortedCaptions = [...captions].sort((a, b) => toSeconds(a.startTime) - toSeconds(b.startTime));

  const selectedCaption = selectedCaptionId ? captions.find((c) => c.id === selectedCaptionId) ?? null : null;

  const currentCaptionId = captions.find((c) => {
    const t = session.playheadFrame / fps;
    return toSeconds(c.startTime) <= t && toSeconds(c.endTime) > t;
  })?.id ?? null;

  const handleSelect = useCallback((id: string) => {
    setSelectedCaptionId(id);
    const cap = captions.find((c) => c.id === id);
    if (cap) updateSession({ playheadFrame: Math.round(toSeconds(cap.startTime) * fps) });
  }, [captions, fps, updateSession]);

  const handleStartEdit = useCallback((cap: Caption) => {
    setEditingId(cap.id);
    setEditText(cap.text);
  }, []);

  const handleCommitEdit = useCallback(() => {
    if (!editingId || !activeSequence) return;
    const cap = captions.find((c) => c.id === editingId);
    if (!cap) return;
    dispatch(makeOp('caption.upsert', { sequenceId: activeSequence.id, caption: { ...cap, text: editText } }), 'Edit caption');
    setEditingId(null);
  }, [editingId, editText, captions, activeSequence, dispatch]);

  const handleRemove = useCallback((id: string) => {
    if (!activeSequence) return;
    dispatch(makeOp('caption.remove', { sequenceId: activeSequence.id, captionId: id }), 'Remove caption');
    if (selectedCaptionId === id) setSelectedCaptionId(null);
  }, [activeSequence, dispatch, selectedCaptionId]);

  const handleSplit = useCallback((id: string) => {
    if (!activeSequence) return;
    const newId = generateId('cap');
    const splitTime = fromSeconds(session.playheadFrame / fps, 30000);
    dispatch(makeOp('caption.split', { sequenceId: activeSequence.id, captionId: id, splitTime, newCaptionId: newId }), 'Split caption');
  }, [activeSequence, dispatch, session.playheadFrame, fps]);

  const handleMerge = useCallback((id: string) => {
    if (!activeSequence) return;
    const idx = sortedCaptions.findIndex((c) => c.id === id);
    if (idx < 0 || idx >= sortedCaptions.length - 1) return;
    const nextId = sortedCaptions[idx + 1].id;
    dispatch(makeOp('caption.merge', { sequenceId: activeSequence.id, captionIdA: id, captionIdB: nextId }), 'Merge captions');
  }, [activeSequence, dispatch, sortedCaptions]);

  const handleSetStyle = useCallback((id: string, style: Partial<CaptionStyle>) => {
    if (!activeSequence) return;
    dispatch(makeOp('caption.setStyle', { sequenceId: activeSequence.id, captionId: id, style }), 'Set caption style');
  }, [activeSequence, dispatch]);

  const handleApplyPreset = useCallback((id: string, presetName: string) => {
    const preset = STYLE_PRESETS[presetName];
    if (!preset) return;
    handleSetStyle(id, { ...preset, presetId: presetName });
  }, [handleSetStyle]);

  if (captions.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '24px', textAlign: 'center' }}>
        <div style={{ fontSize: '22px', marginBottom: '8px', opacity: 0.25 }} aria-hidden="true">CC</div>
        <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginBottom: '3px' }}>No captions</div>
        <div style={{ fontSize: '11px', color: 'var(--color-subtle)', lineHeight: 1.5 }}>Generate captions from the Words tab, or import an SRT file.</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontSize: '11px', color: 'var(--color-muted)', fontWeight: 600 }}>{captions.length} captions</span>
        <div style={{ flex: 1 }} />
        <button className="btn-ghost" onClick={() => { if (!activeSequence) return; captions.forEach((c) => dispatch(makeOp('caption.remove', { sequenceId: activeSequence.id, captionId: c.id }), 'Remove all captions')); }}
          style={{ fontSize: '10px', padding: '2px 6px', color: 'var(--color-danger)' }} aria-label="Remove all captions">
          Clear all
        </button>
      </div>

      {/* Caption list */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {sortedCaptions.map((cap, idx) => {
          const isSelected = selectedCaptionId === cap.id;
          const isCurrent = cap.id === currentCaptionId;
          const isEditing = editingId === cap.id;

          return (
            <div
              key={cap.id}
              onClick={() => handleSelect(cap.id)}
              style={{
                padding: '6px 8px',
                borderBottom: '1px solid rgba(244,247,255,0.04)',
                background: isSelected ? 'rgba(59,130,255,0.08)' : isCurrent ? 'rgba(59,130,255,0.04)' : 'transparent',
                cursor: 'pointer',
                borderLeft: `2px solid ${isCurrent ? 'var(--color-accent)' : 'transparent'}`,
              }}
            >
              {/* Timecode row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--color-subtle)' }}>
                  {toTimecode(cap.startTime, fps)} → {toTimecode(cap.endTime, fps)}
                </span>
                <span style={{ fontSize: '9px', color: 'var(--color-subtle)' }}>
                  {(toSeconds(cap.endTime) - toSeconds(cap.startTime)).toFixed(2)}s
                </span>
                <div style={{ flex: 1 }} />
                {isSelected && (
                  <div style={{ display: 'flex', gap: '2px' }}>
                    <button className="btn-icon" onClick={(e) => { e.stopPropagation(); handleStartEdit(cap); }}
                      style={{ fontSize: '9px', color: 'var(--color-accent)', padding: '1px 4px' }} aria-label="Edit caption text">Edit</button>
                    <button className="btn-icon" onClick={(e) => { e.stopPropagation(); handleSplit(cap.id); }}
                      style={{ fontSize: '9px', color: 'var(--color-subtle)', padding: '1px 4px' }} aria-label="Split caption at playhead">Split</button>
                    {idx < sortedCaptions.length - 1 && (
                      <button className="btn-icon" onClick={(e) => { e.stopPropagation(); handleMerge(cap.id); }}
                        style={{ fontSize: '9px', color: 'var(--color-subtle)', padding: '1px 4px' }} aria-label="Merge with next">Merge</button>
                    )}
                    <button className="btn-icon" onClick={(e) => { e.stopPropagation(); handleRemove(cap.id); }}
                      style={{ fontSize: '9px', color: 'var(--color-danger)', padding: '1px 4px' }} aria-label="Remove caption">✕</button>
                  </div>
                )}
              </div>

              {/* Caption text */}
              {isEditing ? (
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onBlur={handleCommitEdit}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCommitEdit(); } if (e.key === 'Escape') setEditingId(null); }}
                  autoFocus
                  style={{ width: '100%', background: 'var(--color-well)', border: '1px solid var(--color-accent)', borderRadius: '3px', color: 'var(--color-fg)', fontFamily: 'var(--font-sans)', fontSize: '12px', padding: '4px 6px', resize: 'vertical', minHeight: '40px', outline: 'none' }}
                  aria-label="Edit caption text"
                />
              ) : (
                <div style={{ fontSize: '12px', color: 'var(--color-fg)', lineHeight: 1.5, wordBreak: 'break-word' }}
                  onDoubleClick={(e) => { e.stopPropagation(); handleStartEdit(cap); }}>
                  {cap.text}
                </div>
              )}

              {/* Style controls (when selected) */}
              {isSelected && !isEditing && (
                <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  {/* Presets */}
                  <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                    {Object.keys(STYLE_PRESETS).map((preset) => (
                      <button key={preset} className="btn-ghost"
                        onClick={(e) => { e.stopPropagation(); handleApplyPreset(cap.id, preset); }}
                        style={{ fontSize: '9px', padding: '2px 6px', color: cap.style?.presetId === preset ? 'var(--color-accent)' : 'var(--color-subtle)', background: cap.style?.presetId === preset ? 'rgba(59,130,255,0.12)' : 'transparent' }}
                        aria-label={`Apply ${preset} preset`}>
                        {preset}
                      </button>
                    ))}
                  </div>

                  {/* Style controls */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontSize: '9px', color: 'var(--color-subtle)' }}>Size</span>
                      <input type="number" min={8} max={72} step={1}
                        defaultValue={cap.style?.fontSize ?? 18}
                        onBlur={(e) => { e.stopPropagation(); handleSetStyle(cap.id, { fontSize: parseInt(e.target.value) }); }}
                        onClick={(e) => e.stopPropagation()}
                        style={{ flex: 1, background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px', color: 'var(--color-fg)', fontSize: '10px', padding: '2px 4px' }}
                        aria-label="Font size" />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontSize: '9px', color: 'var(--color-subtle)' }}>Color</span>
                      <input type="color"
                        defaultValue={cap.style?.color ?? '#ffffff'}
                        onBlur={(e) => { e.stopPropagation(); handleSetStyle(cap.id, { color: e.target.value }); }}
                        onClick={(e) => e.stopPropagation()}
                        style={{ flex: 1, height: '22px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: '3px', cursor: 'pointer' }}
                        aria-label="Caption color" />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontSize: '9px', color: 'var(--color-subtle)' }}>Pos</span>
                      <select
                        defaultValue={cap.style?.position ?? 'bottom'}
                        onChange={(e) => { e.stopPropagation(); handleSetStyle(cap.id, { position: e.target.value as CaptionStyle['position'] }); }}
                        onClick={(e) => e.stopPropagation()}
                        style={{ flex: 1, background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px', color: 'var(--color-muted)', fontSize: '10px', padding: '2px 3px' }}
                        aria-label="Caption position">
                        <option value="bottom">Bottom</option>
                        <option value="top">Top</option>
                        <option value="middle">Middle</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontSize: '9px', color: 'var(--color-subtle)' }}>Weight</span>
                      <select
                        defaultValue={String(cap.style?.fontWeight ?? 400)}
                        onChange={(e) => { e.stopPropagation(); handleSetStyle(cap.id, { fontWeight: parseInt(e.target.value) }); }}
                        onClick={(e) => e.stopPropagation()}
                        style={{ flex: 1, background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px', color: 'var(--color-muted)', fontSize: '10px', padding: '2px 3px' }}
                        aria-label="Font weight">
                        <option value="400">Regular</option>
                        <option value="600">Semibold</option>
                        <option value="700">Bold</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
