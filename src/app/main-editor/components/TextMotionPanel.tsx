'use client';

/**
 * TextMotionPanel — Flagship text authoring surface for CutLab Studio.
 * Word/phrase targeting, deep choreography, Captions as Set Design,
 * typographic materials, and spatial 2.5D text participation.
 *
 * Typed against the CANONICAL engine MotionDocument (ProjectData.motionDocuments).
 * All edits flow: MotionOp[] → MotionTransaction → motionTransactionToStudioOps → one history entry.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useEngine } from '@/engine/store';
import { resolveClipMotionDocument, motionTransactionToStudioOps } from '@/engine/motion-bridge';
import type { MotionDocument, MotionObject, MotionTextSegment, MotionMaterial, MotionBehavior } from '@/engine/motion-document';
import { makeOp as makeMotionOp, createMotionTransaction, generateMotionId, secondsToMotionTime, motionTimeToSeconds } from '@/engine/motion-document-utils';

// ── Shared styles ─────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: '9px', fontWeight: 600, color: 'var(--color-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px', marginTop: '2px' }}>{children}</div>;
}

const numInputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--color-well)',
  border: '1px solid var(--color-border)',
  borderRadius: '3px',
  color: 'var(--color-fg)',
  fontSize: '11px',
  fontFamily: 'var(--font-mono)',
  padding: '3px 6px',
  boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--color-well)',
  border: '1px solid var(--color-border)',
  borderRadius: '3px',
  color: 'var(--color-fg)',
  fontSize: '11px',
  fontFamily: 'var(--font-sans)',
  padding: '3px 6px',
  boxSizing: 'border-box',
};

// ── Word Motion Presets ───────────────────────────────────────

const WORD_MOTION_PRESETS = [
  { id: 'stagger-up', label: 'Stagger Up', icon: '↑', desc: 'Words slide up in sequence', defaultStagger: 0.08, defaultDuration: 0.4, defaultEasing: 'ease-out', defaultAmplitude: 30 },
  { id: 'cascade', label: 'Cascade', icon: '⬇', desc: 'Words fall in from above', defaultStagger: 0.06, defaultDuration: 0.5, defaultEasing: 'ease-out', defaultAmplitude: 40 },
  { id: 'wave', label: 'Wave', icon: '〜', desc: 'Sinusoidal wave through words', defaultStagger: 0.05, defaultDuration: 0.6, defaultEasing: 'ease-in-out', defaultAmplitude: 20 },
  { id: 'center-out', label: 'Center Out', icon: '↔', desc: 'Words spread from center', defaultStagger: 0.07, defaultDuration: 0.45, defaultEasing: 'ease-out', defaultAmplitude: 20 },
  { id: 'edges-in', label: 'Edges In', icon: '→←', desc: 'Words converge to center', defaultStagger: 0.07, defaultDuration: 0.45, defaultEasing: 'ease-in-out', defaultAmplitude: 20 },
  { id: 'spring', label: 'Spring', icon: '⟳', desc: 'Springy bounce per word', defaultStagger: 0.06, defaultDuration: 0.5, defaultEasing: 'spring', defaultAmplitude: 1.2 },
  { id: 'punch', label: 'Punch', icon: '✦', desc: 'Scale punch per word', defaultStagger: 0.05, defaultDuration: 0.3, defaultEasing: 'bounce', defaultAmplitude: 1.4 },
  { id: 'float', label: 'Float', icon: '◌', desc: 'Gentle float upward', defaultStagger: 0.1, defaultDuration: 0.8, defaultEasing: 'ease-out', defaultAmplitude: 15 },
  { id: 'drift', label: 'Drift', icon: '→', desc: 'Slow horizontal drift', defaultStagger: 0.08, defaultDuration: 0.6, defaultEasing: 'ease-in-out', defaultAmplitude: 25 },
  { id: 'orbit', label: 'Orbit', icon: '○', desc: 'Orbital path per word', defaultStagger: 0.06, defaultDuration: 0.5, defaultEasing: 'ease-in-out', defaultAmplitude: 30 },
  { id: 'parallax', label: 'Parallax', icon: '⊡', desc: 'Depth-based parallax', defaultStagger: 0.04, defaultDuration: 0.4, defaultEasing: 'ease-out', defaultAmplitude: 0.3 },
  { id: 'depth-step', label: 'Depth Step', icon: '⬡', desc: 'Words step forward in depth', defaultStagger: 0.08, defaultDuration: 0.4, defaultEasing: 'spring', defaultAmplitude: 80 },
  { id: 'random', label: 'Random', icon: '⁂', desc: 'Seeded random order', defaultStagger: 0.07, defaultDuration: 0.4, defaultEasing: 'ease-out', defaultAmplitude: 25 },
  { id: 'rotate', label: 'Rotate', icon: '↻', desc: 'Rotation per word', defaultStagger: 0.06, defaultDuration: 0.4, defaultEasing: 'spring', defaultAmplitude: 15 },
  { id: 'scale', label: 'Scale', icon: '⊞', desc: 'Scale in per word', defaultStagger: 0.05, defaultDuration: 0.35, defaultEasing: 'spring', defaultAmplitude: 0 },
  { id: 'opacity', label: 'Opacity', icon: '◑', desc: 'Fade in per word', defaultStagger: 0.06, defaultDuration: 0.4, defaultEasing: 'ease-out', defaultAmplitude: 0 },
];

// ── Material Presets ──────────────────────────────────────────

const MATERIAL_PRESETS: Array<{ id: string; label: string; color: string; type: MotionMaterial['type']; params?: Record<string, string | number | boolean> }> = [
  { id: 'white', label: 'White', color: '#ffffff', type: 'solid' },
  { id: 'chrome', label: 'Chrome', color: '#c0c0c0', type: 'metal', params: { style: 'chrome' } },
  { id: 'glass', label: 'Glass', color: '#ffffff', type: 'glass' },
  { id: 'neon-blue', label: 'Neon', color: '#00d4ff', type: 'neon' },
  { id: 'neon-pink', label: 'Neon Pink', color: '#ff0080', type: 'neon' },
  { id: 'neon-green', label: 'Neon Grn', color: '#00ff88', type: 'neon' },
  { id: 'gold', label: 'Gold', color: '#ffd700', type: 'metal' },
  { id: 'paper', label: 'Paper', color: '#2a1a0a', type: 'solid', params: { style: 'paper' } },
  { id: 'halftone', label: 'Halftone', color: '#000000', type: 'solid', params: { style: 'halftone' } },
  { id: 'gradient-fire', label: 'Fire', color: '#ff4500', type: 'gradient', params: { stop0: '#ff4500', stop1: '#ffd700', angle: 90 } },
  { id: 'gradient-ocean', label: 'Ocean', color: '#0066ff', type: 'gradient', params: { stop0: '#0066ff', stop1: '#00d9ed', angle: 135 } },
  { id: 'gradient-sunset', label: 'Sunset', color: '#ff6b35', type: 'gradient', params: { stop0: '#ff6b35', stop1: '#ed1c78', angle: 135 } },
];

// ── Captions as Set Design Presets ────────────────────────────

const CAPTION_DESIGN_PRESETS = [
  { id: 'active-word-depth', label: 'Active Word Depth', icon: '🎙', desc: 'Spoken word steps forward in depth', category: 'transcript' },
  { id: 'emphasis-punch', label: 'Emphasis Punch', icon: '⬆', desc: 'Emphasized words punch scale', category: 'transcript' },
  { id: 'pause-settle', label: 'Pause Settle', icon: '⏸', desc: 'Text settles during pauses', category: 'transcript' },
  { id: 'speaker-style', label: 'Speaker Style', icon: '👤', desc: 'Color/style changes per speaker', category: 'transcript' },
  { id: 'beat-pulse', label: 'Beat Pulse', icon: '🎵', desc: 'Pulses on audio beat', category: 'audio' },
  { id: 'onset-punch', label: 'Onset Punch', icon: '⚡', desc: 'Punches on audio onset', category: 'audio' },
  { id: 'bass-depth', label: 'Bass Depth', icon: '🎸', desc: 'Bass drives depth forward', category: 'audio' },
  { id: 'projector', label: 'Projector', icon: '💡', desc: 'Shadow/projector treatment', category: 'visual' },
  { id: 'behind-subject', label: 'Behind Subject', icon: '⬡', desc: 'Text sits behind subject', category: 'spatial' },
  { id: 'in-front', label: 'In Front', icon: '◈', desc: 'Text floats in front of subject', category: 'spatial' },
  { id: 'foreground-cross', label: 'Frame Cross', icon: '⊞', desc: 'Text crosses foreground frame', category: 'spatial' },
  { id: 'layered-depth', label: 'Layered Depth', icon: '⊟', desc: 'Words distributed across depth planes', category: 'spatial' },
  { id: 'shallow-parallax', label: 'Shallow Parallax', icon: '⊡', desc: 'Subtle parallax on camera move', category: 'spatial' },
  { id: 'projector-shadow', label: 'Projector Shadow', icon: '🌑', desc: 'Cast shadow / projector typography', category: 'visual' },
];

// ── Spatial Presets ───────────────────────────────────────────

const SPATIAL_PRESETS = [
  { id: 'foreground', label: 'Foreground', depth: 3, z: 300, desc: 'Front plane' },
  { id: 'midground', label: 'Midground', depth: 0, z: 0, desc: 'Middle plane' },
  { id: 'background', label: 'Background', depth: -3, z: -300, desc: 'Back plane' },
  { id: 'behind-subject', label: 'Behind Subject', depth: -1, z: -100, occlusionRole: 'background' as const, desc: 'Behind subject layer' },
  { id: 'in-front-subject', label: 'In Front', depth: 2, z: 200, occlusionRole: 'foreground' as const, desc: 'In front of subject' },
  { id: 'deep-bg', label: 'Deep BG', depth: -5, z: -500, desc: 'Deep background' },
];

interface TextMotionPanelProps {
  clipId: string;
  objectId: string;
}

export default function TextMotionPanel({ clipId, objectId }: TextMotionPanelProps) {
  const engine = useEngine();
  const { project, activeSequence, dispatchBatch } = engine;

  const clip = activeSequence?.clips.find((c) => c.id === clipId) ?? null;
  const doc = clip && project ? resolveClipMotionDocument(project, clip) : null;
  const obj = doc?.objects[objectId] ?? null;

  const [activeSection, setActiveSection] = useState<'content' | 'typography' | 'word-motion' | 'captions' | 'material' | 'spatial'>('content');

  const applyMotionOps = useCallback((ops: ReturnType<typeof makeMotionOp>[], description: string) => {
    if (!project || !doc) return;
    const transaction = createMotionTransaction(description, ops);
    const studioOps = motionTransactionToStudioOps(transaction, project);
    if (studioOps.length > 0) dispatchBatch(studioOps, description);
  }, [project, doc, dispatchBatch]);

  if (!obj || obj.kind !== 'text') {
    return (
      <div style={{ padding: '16px', textAlign: 'center', fontSize: '11px', color: 'var(--color-muted)' }}>
        Select a text object to edit
      </div>
    );
  }

  const seg = obj.textSegments?.[0];

  const sectionBtn = (id: typeof activeSection, label: string) => (
    <button
      key={id}
      onClick={() => setActiveSection(id)}
      style={{
        fontSize: '9px', padding: '3px 7px',
        background: activeSection === id ? 'rgba(139,92,246,0.15)' : 'transparent',
        border: `1px solid ${activeSection === id ? 'rgba(139,92,246,0.4)' : 'transparent'}`,
        borderRadius: '10px',
        color: activeSection === id ? 'var(--color-accent-2)' : 'var(--color-subtle)',
        cursor: 'pointer', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap' as const,
      }}
    >{label}</button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Section nav */}
      <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
        {sectionBtn('content', 'Content')}
        {sectionBtn('typography', 'Type')}
        {sectionBtn('word-motion', 'Choreography')}
        {sectionBtn('captions', 'Set Design')}
        {sectionBtn('material', 'Material')}
        {sectionBtn('spatial', 'Spatial')}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {activeSection === 'content' && (
          <ContentSection doc={doc!} obj={obj} seg={seg} onApplyOps={applyMotionOps} />
        )}
        {activeSection === 'typography' && (
          <TypographySection doc={doc!} obj={obj} seg={seg} onApplyOps={applyMotionOps} />
        )}
        {activeSection === 'word-motion' && (
          <WordMotionSection doc={doc!} obj={obj} onApplyOps={applyMotionOps} />
        )}
        {activeSection === 'captions' && (
          <CaptionsSetDesignSection doc={doc!} obj={obj} onApplyOps={applyMotionOps} clipId={clipId} />
        )}
        {activeSection === 'material' && (
          <MaterialSection doc={doc!} obj={obj} seg={seg} onApplyOps={applyMotionOps} />
        )}
        {activeSection === 'spatial' && (
          <SpatialSection doc={doc!} obj={obj} onApplyOps={applyMotionOps} />
        )}
      </div>
    </div>
  );
}

// ── Content Section ───────────────────────────────────────────

function ContentSection({ doc, obj, seg, onApplyOps }: { doc: MotionDocument; obj: MotionObject; seg?: MotionTextSegment; onApplyOps: (ops: ReturnType<typeof makeMotionOp>[], desc: string) => void }) {
  const [text, setText] = useState(seg?.text ?? '');
  const [targetMode, setTargetMode] = useState<'block' | 'phrase' | 'word'>('block');

  useEffect(() => { setText(seg?.text ?? ''); }, [obj.id]);

  const commitText = (val: string) => {
    if (!seg) return;
    onApplyOps([makeMotionOp('motion.setTextSegment', doc.id, { objectId: obj.id, segment: { ...seg, text: val } })], 'Set text content');
  };

  // Parse words for word-level targeting
  const words = text.split(/\s+/).filter(Boolean);

  return (
    <div style={{ padding: '10px' }}>
      <Label>Text Content</Label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commitText(e.target.value)}
        rows={3}
        style={{ width: '100%', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'var(--color-fg)', fontSize: '12px', fontFamily: 'var(--font-sans)', padding: '6px 8px', resize: 'vertical', boxSizing: 'border-box' }}
        placeholder="Enter text…"
      />

      <div style={{ marginTop: '10px' }}>
        <Label>Targeting Level</Label>
        <div style={{ display: 'flex', gap: '3px' }}>
          {(['block', 'phrase', 'word'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setTargetMode(mode)}
              style={{ flex: 1, padding: '4px', background: targetMode === mode ? 'rgba(139,92,246,0.15)' : 'var(--color-well)', border: `1px solid ${targetMode === mode ? 'rgba(139,92,246,0.4)' : 'var(--color-border)'}`, borderRadius: '3px', color: targetMode === mode ? 'var(--color-accent-2)' : 'var(--color-muted)', cursor: 'pointer', fontSize: '9px', fontFamily: 'var(--font-sans)', textTransform: 'capitalize' }}
            >{mode}</button>
          ))}
        </div>
      </div>

      {targetMode === 'word' && words.length > 0 && (
        <div style={{ marginTop: '8px' }}>
          <Label>Word Targets ({words.length})</Label>
          <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
            {words.map((word, i) => (
              <button
                key={i}
                style={{ fontSize: '9px', padding: '2px 6px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px', color: 'var(--color-fg)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
                title={`Target word: ${word}`}
              >{word}</button>
            ))}
          </div>
          <div style={{ fontSize: '9px', color: 'var(--color-subtle)', marginTop: '4px' }}>Click a word to apply targeted animation</div>
        </div>
      )}

      <div style={{ marginTop: '10px' }}>
        <Label>Quick Presets</Label>
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {['TITLE', 'SUBTITLE', 'CAPTION', 'CALLOUT', 'STAT', 'QUOTE'].map((preset) => (
            <button
              key={preset}
              onClick={() => { setText(preset); commitText(preset); }}
              style={{ fontSize: '9px', padding: '2px 7px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px', color: 'var(--color-muted)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
            >{preset}</button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: '10px' }}>
        <Label>Object Name</Label>
        <input
          type="text"
          defaultValue={obj.name}
          onBlur={(e) => onApplyOps([makeMotionOp('motion.setObjectProp', doc.id, { objectId: obj.id, props: { name: e.target.value } })], 'Rename object')}
          style={{ width: '100%', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px', color: 'var(--color-fg)', fontSize: '11px', fontFamily: 'var(--font-sans)', padding: '4px 6px', boxSizing: 'border-box' }}
        />
      </div>
    </div>
  );
}

// ── Typography Section ────────────────────────────────────────

function TypographySection({ doc, obj, seg, onApplyOps }: { doc: MotionDocument; obj: MotionObject; seg?: MotionTextSegment; onApplyOps: (ops: ReturnType<typeof makeMotionOp>[], desc: string) => void }) {
  const [fontSize, setFontSize] = useState(seg?.fontSize ?? 48);
  const [fontWeight, setFontWeight] = useState(seg?.fontWeight ?? 700);
  const [letterSpacing, setLetterSpacing] = useState(obj.letterSpacing ?? 0);
  const [lineHeight, setLineHeight] = useState(obj.lineHeight ?? 1.2);
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>(obj.textAlign ?? 'center');
  const [fontFamily, setFontFamily] = useState(seg?.fontFamily ?? obj.fontFamily ?? 'Inter');

  useEffect(() => {
    setFontSize(seg?.fontSize ?? 48);
    setFontWeight(seg?.fontWeight ?? 700);
    setLetterSpacing(obj.letterSpacing ?? 0);
    setLineHeight(obj.lineHeight ?? 1.2);
    setTextAlign(obj.textAlign ?? 'center');
    setFontFamily(seg?.fontFamily ?? obj.fontFamily ?? 'Inter');
  }, [obj.id]);

  const commitSeg = (patch: Partial<MotionTextSegment>) => {
    if (!seg) return;
    onApplyOps([makeMotionOp('motion.setTextSegment', doc.id, { objectId: obj.id, segment: { ...seg, ...patch } })], 'Set typography');
  };

  const commitObjProp = (props: Partial<MotionObject>, desc: string) => {
    onApplyOps([makeMotionOp('motion.setObjectProp', doc.id, { objectId: obj.id, props })], desc);
  };

  const FONTS = ['Inter', 'Arial', 'Georgia', 'Courier New', 'Impact', 'Helvetica Neue', 'Playfair Display', 'Oswald', 'Montserrat', 'Roboto Mono', 'Times New Roman', 'Futura', 'Garamond'];
  const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

  return (
    <div style={{ padding: '10px' }}>
      <Label>Font Family</Label>
      <select value={fontFamily} onChange={(e) => { setFontFamily(e.target.value); commitSeg({ fontFamily: e.target.value }); commitObjProp({ fontFamily: e.target.value }, 'Set font'); }} style={selectStyle}>
        {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
      </select>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '8px' }}>
        <div>
          <Label>Size</Label>
          <input type="number" value={fontSize} min={6} max={400} onChange={(e) => setFontSize(+e.target.value)} onBlur={() => commitSeg({ fontSize })} style={numInputStyle} />
        </div>
        <div>
          <Label>Weight</Label>
          <select value={fontWeight} onChange={(e) => { const v = +e.target.value; setFontWeight(v); commitSeg({ fontWeight: v }); }} style={selectStyle}>
            {WEIGHTS.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
        <div>
          <Label>Tracking</Label>
          <input type="number" value={letterSpacing} step={0.5} onChange={(e) => setLetterSpacing(+e.target.value)} onBlur={() => commitObjProp({ letterSpacing }, 'Set tracking')} style={numInputStyle} />
        </div>
        <div>
          <Label>Line Height</Label>
          <input type="number" value={lineHeight} step={0.05} min={0.5} max={4} onChange={(e) => setLineHeight(+e.target.value)} onBlur={() => commitObjProp({ lineHeight }, 'Set line height')} style={numInputStyle} />
        </div>
      </div>

      <div style={{ marginTop: '8px' }}>
        <Label>Alignment</Label>
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['left', 'center', 'right'] as const).map((a) => (
            <button key={a} onClick={() => { setTextAlign(a); commitObjProp({ textAlign: a }, 'Set alignment'); }} style={{ flex: 1, padding: '4px', background: textAlign === a ? 'rgba(139,92,246,0.15)' : 'var(--color-well)', border: `1px solid ${textAlign === a ? 'rgba(139,92,246,0.4)' : 'var(--color-border)'}`, borderRadius: '3px', color: textAlign === a ? 'var(--color-accent-2)' : 'var(--color-muted)', cursor: 'pointer', fontSize: '11px' }}>
              {a === 'left' ? '⬅' : a === 'center' ? '↔' : '➡'}
            </button>
          ))}
        </div>
      </div>

      {/* Size quick-set */}
      <div style={{ marginTop: '8px' }}>
        <Label>Quick Sizes</Label>
        <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
          {[24, 36, 48, 64, 80, 96, 120].map((s) => (
            <button key={s} onClick={() => { setFontSize(s); commitSeg({ fontSize: s }); }} style={{ fontSize: '9px', padding: '2px 6px', background: fontSize === s ? 'rgba(139,92,246,0.15)' : 'var(--color-well)', border: `1px solid ${fontSize === s ? 'rgba(139,92,246,0.3)' : 'var(--color-border)'}`, borderRadius: '3px', color: fontSize === s ? 'var(--color-accent-2)' : 'var(--color-muted)', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>{s}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Word Motion / Choreography Section ───────────────────────

function WordMotionSection({ doc, obj, onApplyOps }: { doc: MotionDocument; obj: MotionObject; onApplyOps: (ops: ReturnType<typeof makeMotionOp>[], desc: string) => void }) {
  const [stagger, setStagger] = useState(0.08);
  const [duration, setDuration] = useState(0.4);
  const [amplitude, setAmplitude] = useState(30);
  const [overlap, setOverlap] = useState(0.3);
  const [easing, setEasing] = useState<string>('ease-out');
  const [direction, setDirection] = useState<string>('forward');
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);

  const applyWordMotion = (preset: typeof WORD_MOTION_PRESETS[0]) => {
    setSelectedPreset(preset.id);
    // Use preset defaults if user hasn't changed them
    const effectiveStagger = stagger;
    const effectiveDuration = duration;
    const effectiveAmplitude = amplitude;

    const behaviorMap: Record<string, Partial<MotionBehavior>> = {
      'stagger-up': { type: 'word-by-word', params: { direction: direction === 'reverse' ? 'down' : 'up', stagger: effectiveStagger, distance: effectiveAmplitude, order: direction === 'center-out' ? 'center-out' : direction === 'edges-in' ? 'edges-in' : 'forward' } },
      'cascade': { type: 'word-by-word', params: { direction: 'down', stagger: effectiveStagger, distance: effectiveAmplitude, order: 'forward' } },
      'wave': { type: 'wave', params: { amplitude: effectiveAmplitude, frequency: 2, stagger: effectiveStagger } },
      'center-out': { type: 'word-by-word', params: { order: 'center-out', stagger: effectiveStagger, distance: effectiveAmplitude } },
      'edges-in': { type: 'word-by-word', params: { order: 'edges-in', stagger: effectiveStagger, distance: effectiveAmplitude } },
      'spring': { type: 'word-by-word', params: { easing: 'spring', stagger: effectiveStagger, fromScale: Math.max(0, 1 - effectiveAmplitude * 0.01) } },
      'punch': { type: 'word-by-word', params: { easing: 'bounce', stagger: effectiveStagger, fromScale: 1 + effectiveAmplitude * 0.01 } },
      'float': { type: 'word-by-word', params: { direction: 'up', stagger: effectiveStagger, distance: effectiveAmplitude * 0.5, easing: 'ease-out' } },
      'drift': { type: 'word-by-word', params: { direction: direction === 'reverse' ? 'left' : 'right', stagger: effectiveStagger, distance: effectiveAmplitude } },
      'orbit': { type: 'word-by-word', params: { orbit: true, stagger: effectiveStagger, radius: effectiveAmplitude } },
      'parallax': { type: 'word-by-word', params: { parallax: true, stagger: effectiveStagger, depthScale: effectiveAmplitude * 0.01 } },
      'depth-step': { type: 'word-by-word', params: { depthStep: true, stagger: effectiveStagger, depthAmount: effectiveAmplitude } },
      'random': { type: 'word-by-word', params: { order: 'random', stagger: effectiveStagger, seed: 42, distance: effectiveAmplitude } },
      'rotate': { type: 'word-by-word', params: { rotation: true, stagger: effectiveStagger, rotationAmount: effectiveAmplitude } },
      'scale': { type: 'word-by-word', params: { easing: 'spring', stagger: effectiveStagger, fromScale: 0 } },
      'opacity': { type: 'word-by-word', params: { fadeIn: true, stagger: effectiveStagger } },
    };

    const presetDef = behaviorMap[preset.id];
    if (!presetDef) return;

    // Remove existing word-motion behaviors first
    const removeOps = (obj.behaviors ?? [])
      .filter((b) => b.type === 'word-by-word' || b.type === 'wave')
      .map((b) => makeMotionOp('motion.removeBehavior', doc.id, { objectId: obj.id, behaviorId: b.id }));

    const newBehavior: MotionBehavior = {
      id: generateMotionId('beh'),
      type: (presetDef.type ?? 'word-by-word') as MotionBehavior['type'],
      startTime: secondsToMotionTime(0),
      duration: secondsToMotionTime(effectiveDuration),
      params: { ...(presetDef.params ?? {}), overlap },
      easing: easing as MotionBehavior['easing'],
    };

    onApplyOps([...removeOps, makeMotionOp('motion.addBehavior', doc.id, { objectId: obj.id, behavior: newBehavior })], `Word motion: ${preset.label}`);
  };

  const clearWordMotion = () => {
    const removeOps = (obj.behaviors ?? [])
      .filter((b) => b.type === 'word-by-word' || b.type === 'wave')
      .map((b) => makeMotionOp('motion.removeBehavior', doc.id, { objectId: obj.id, behaviorId: b.id }));
    if (removeOps.length > 0) { onApplyOps(removeOps, 'Clear word motion'); setSelectedPreset(null); }
  };

  const activeWordMotion = (obj.behaviors ?? []).find((b) => b.type === 'word-by-word' || b.type === 'wave');

  return (
    <div style={{ padding: '10px' }}>
      {/* Timing controls */}
      <div style={{ background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '8px', marginBottom: '10px' }}>
        <Label>Timing &amp; Easing</Label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
          <div>
            <Label>Stagger (s)</Label>
            <input type="number" value={stagger} step={0.01} min={0} max={1} onChange={(e) => setStagger(+e.target.value)} style={numInputStyle} />
          </div>
          <div>
            <Label>Duration (s)</Label>
            <input type="number" value={duration} step={0.05} min={0.05} max={3} onChange={(e) => setDuration(+e.target.value)} style={numInputStyle} />
          </div>
          <div>
            <Label>Amplitude</Label>
            <input type="number" value={amplitude} step={1} min={0} max={200} onChange={(e) => setAmplitude(+e.target.value)} style={numInputStyle} />
          </div>
          <div>
            <Label>Overlap</Label>
            <input type="number" value={overlap} step={0.05} min={0} max={1} onChange={(e) => setOverlap(+e.target.value)} style={numInputStyle} />
          </div>
        </div>
        <div style={{ marginTop: '6px' }}>
          <Label>Easing</Label>
          <select value={easing} onChange={(e) => setEasing(e.target.value)} style={selectStyle}>
            {['linear', 'ease-in', 'ease-out', 'ease-in-out', 'spring', 'bounce', 'elastic'].map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
        </div>
        <div style={{ marginTop: '6px' }}>
          <Label>Direction / Order</Label>
          <select value={direction} onChange={(e) => setDirection(e.target.value)} style={selectStyle}>
            <option value="forward">Forward</option>
            <option value="reverse">Reverse</option>
            <option value="center-out">Center Out</option>
            <option value="edges-in">Edges In</option>
            <option value="random">Random</option>
          </select>
        </div>
      </div>

      {activeWordMotion && (
        <div style={{ marginBottom: '8px', padding: '6px 8px', background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '10px', color: 'var(--color-accent-2)', flex: 1 }}>Active: {activeWordMotion.type} · {Object.keys(activeWordMotion.params).join(', ')}</span>
          <button onClick={clearWordMotion} style={{ fontSize: '9px', color: 'var(--color-danger)', background: 'none', border: 'none', cursor: 'pointer' }}>Clear</button>
        </div>
      )}

      <Label>Choreography Presets</Label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
        {WORD_MOTION_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => applyWordMotion(p)}
            title={p.desc}
            style={{ padding: '5px 6px', background: selectedPreset === p.id ? 'rgba(139,92,246,0.12)' : 'var(--color-well)', border: `1px solid ${selectedPreset === p.id ? 'rgba(139,92,246,0.3)' : 'var(--color-border)'}`, borderRadius: '4px', color: 'var(--color-fg)', cursor: 'pointer', fontSize: '10px', fontFamily: 'var(--font-sans)', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '5px' }}
          >
            <span style={{ fontSize: '12px', flexShrink: 0 }}>{p.icon}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Captions as Set Design Section ───────────────────────────

function CaptionsSetDesignSection({ doc, obj, onApplyOps, clipId }: { doc: MotionDocument; obj: MotionObject; onApplyOps: (ops: ReturnType<typeof makeMotionOp>[], desc: string) => void; clipId: string }) {
  const [activeCategory, setActiveCategory] = useState<'all' | 'transcript' | 'audio' | 'spatial' | 'visual'>('all');

  const makeSignal = (id: string, name: string) => ({ id, name, type: 'number' as const, defaultValue: 0 });

  const applyPreset = (presetId: string) => {
    const docDurSecs = motionTimeToSeconds(doc.duration);

    switch (presetId) {
      case 'active-word-depth': {
        const sigId = generateMotionId('sig');
        const depthBeh: MotionBehavior = {
          id: generateMotionId('beh'),
          type: 'signal-reactive',
          startTime: secondsToMotionTime(0),
          duration: secondsToMotionTime(docDurSecs),
          params: { property: 'position.z', min: 0, max: 120 },
          signalBinding: sigId,
          easing: 'spring',
        };
        const scaleBeh: MotionBehavior = {
          id: generateMotionId('beh'),
          type: 'signal-reactive',
          startTime: secondsToMotionTime(0),
          duration: secondsToMotionTime(docDurSecs),
          params: { property: 'scale.x', min: 1, max: 1.1 },
          signalBinding: sigId,
          easing: 'spring',
        };
        onApplyOps([
          makeMotionOp('motion.upsertSignal', doc.id, { signal: makeSignal(sigId, 'Speech Timing') }),
          makeMotionOp('motion.addBehavior', doc.id, { objectId: obj.id, behavior: depthBeh }),
          makeMotionOp('motion.addBehavior', doc.id, { objectId: obj.id, behavior: scaleBeh }),
        ], 'Active word depth');
        break;
      }
      case 'emphasis-punch': {
        const sigId = generateMotionId('sig');
        const punchBeh: MotionBehavior = {
          id: generateMotionId('beh'),
          type: 'signal-reactive',
          startTime: secondsToMotionTime(0),
          duration: secondsToMotionTime(docDurSecs),
          params: { property: 'scale.x', min: 1, max: 1.3 },
          signalBinding: sigId,
          easing: 'bounce',
        };
        const depthBeh: MotionBehavior = {
          id: generateMotionId('beh'),
          type: 'signal-reactive',
          startTime: secondsToMotionTime(0),
          duration: secondsToMotionTime(docDurSecs),
          params: { property: 'position.z', min: 0, max: 200 },
          signalBinding: sigId,
          easing: 'spring',
        };
        onApplyOps([
          makeMotionOp('motion.upsertSignal', doc.id, { signal: makeSignal(sigId, 'Semantic Emphasis') }),
          makeMotionOp('motion.addBehavior', doc.id, { objectId: obj.id, behavior: punchBeh }),
          makeMotionOp('motion.addBehavior', doc.id, { objectId: obj.id, behavior: depthBeh }),
        ], 'Emphasis punch');
        break;
      }
      case 'pause-settle': {
        const settleBeh: MotionBehavior = {
          id: generateMotionId('beh'),
          type: 'signal-reactive',
          startTime: secondsToMotionTime(0),
          duration: secondsToMotionTime(docDurSecs),
          params: { property: 'position.y', min: 0, max: 8 },
          easing: 'ease-out',
        };
        onApplyOps([makeMotionOp('motion.addBehavior', doc.id, { objectId: obj.id, behavior: settleBeh })], 'Pause settle');
        break;
      }
      case 'speaker-style': {
        const sigId = generateMotionId('sig');
        const colorBeh: MotionBehavior = {
          id: generateMotionId('beh'),
          type: 'signal-reactive',
          startTime: secondsToMotionTime(0),
          duration: secondsToMotionTime(docDurSecs),
          params: { property: 'opacity', min: 0.7, max: 1 },
          signalBinding: sigId,
          easing: 'ease-out',
        };
        onApplyOps([
          makeMotionOp('motion.upsertSignal', doc.id, { signal: makeSignal(sigId, 'Speaker Timing') }),
          makeMotionOp('motion.addBehavior', doc.id, { objectId: obj.id, behavior: colorBeh }),
        ], 'Speaker style');
        break;
      }
      case 'beat-pulse': {
        const sigId = generateMotionId('sig');
        const pulseBeh: MotionBehavior = {
          id: generateMotionId('beh'),
          type: 'signal-reactive',
          startTime: secondsToMotionTime(0),
          duration: secondsToMotionTime(docDurSecs),
          params: { property: 'scale.x', min: 1, max: 1.08 },
          signalBinding: sigId,
          easing: 'spring',
        };
        onApplyOps([
          makeMotionOp('motion.upsertSignal', doc.id, { signal: makeSignal(sigId, 'Audio Beat') }),
          makeMotionOp('motion.addBehavior', doc.id, { objectId: obj.id, behavior: pulseBeh }),
        ], 'Beat pulse');
        break;
      }
      case 'onset-punch': {
        const sigId = generateMotionId('sig');
        const punchBeh: MotionBehavior = {
          id: generateMotionId('beh'),
          type: 'signal-reactive',
          startTime: secondsToMotionTime(0),
          duration: secondsToMotionTime(docDurSecs),
          params: { property: 'scale.x', min: 1, max: 1.25 },
          signalBinding: sigId,
          easing: 'bounce',
        };
        onApplyOps([
          makeMotionOp('motion.upsertSignal', doc.id, { signal: makeSignal(sigId, 'Audio Onset') }),
          makeMotionOp('motion.addBehavior', doc.id, { objectId: obj.id, behavior: punchBeh }),
        ], 'Onset punch');
        break;
      }
      case 'bass-depth': {
        const sigId = generateMotionId('sig');
        const depthBeh: MotionBehavior = {
          id: generateMotionId('beh'),
          type: 'signal-reactive',
          startTime: secondsToMotionTime(0),
          duration: secondsToMotionTime(docDurSecs),
          params: { property: 'position.z', min: 0, max: 100 },
          signalBinding: sigId,
          easing: 'ease-out',
        };
        onApplyOps([
          makeMotionOp('motion.upsertSignal', doc.id, { signal: makeSignal(sigId, 'Bass') }),
          makeMotionOp('motion.addBehavior', doc.id, { objectId: obj.id, behavior: depthBeh }),
        ], 'Bass depth');
        break;
      }
      case 'projector': {
        const material: MotionMaterial = {
          id: generateMotionId('mat'),
          name: 'Projector',
          type: 'shadow',
          color: '#ffffff',
          opacity: 0.9,
          params: { shadowX: 4, shadowY: 8, shadowBlur: 16, shadowColor: 'rgba(0,0,0,0.7)', projector: true },
        };
        onApplyOps([makeMotionOp('motion.setMaterial', doc.id, { objectId: obj.id, material })], 'Projector treatment');
        break;
      }
      case 'behind-subject': {
        onApplyOps([
          makeMotionOp('motion.setObjectProp', doc.id, { objectId: obj.id, props: { depth: -1, occlusionRole: 'background' } }),
          makeMotionOp('motion.setObjectTransform', doc.id, { objectId: obj.id, transform: { z: -100 } }),
        ], 'Behind subject');
        break;
      }
      case 'in-front': {
        onApplyOps([
          makeMotionOp('motion.setObjectProp', doc.id, { objectId: obj.id, props: { depth: 2, occlusionRole: 'foreground' } }),
          makeMotionOp('motion.setObjectTransform', doc.id, { objectId: obj.id, transform: { z: 200 } }),
        ], 'In front of subject');
        break;
      }
      case 'foreground-cross': {
        onApplyOps([
          makeMotionOp('motion.setObjectProp', doc.id, { objectId: obj.id, props: { depth: 4, occlusionRole: 'foreground' } }),
          makeMotionOp('motion.setObjectTransform', doc.id, { objectId: obj.id, transform: { z: 400 } }),
        ], 'Foreground frame cross');
        break;
      }
      case 'layered-depth': {
        // Distribute word segments across depth planes
        const wordBeh: MotionBehavior = {
          id: generateMotionId('beh'),
          type: 'word-by-word',
          startTime: secondsToMotionTime(0),
          duration: secondsToMotionTime(0.4),
          params: { depthStep: true, depthAmount: 60, stagger: 0.06 },
          easing: 'spring',
        };
        onApplyOps([makeMotionOp('motion.addBehavior', doc.id, { objectId: obj.id, behavior: wordBeh })], 'Layered depth words');
        break;
      }
      case 'shallow-parallax': {
        const parallaxBeh: MotionBehavior = {
          id: generateMotionId('beh'),
          type: 'signal-reactive',
          startTime: secondsToMotionTime(0),
          duration: secondsToMotionTime(docDurSecs),
          params: { property: 'position.x', min: -15, max: 15 },
          easing: 'linear',
        };
        onApplyOps([makeMotionOp('motion.addBehavior', doc.id, { objectId: obj.id, behavior: parallaxBeh })], 'Shallow parallax');
        break;
      }
      case 'projector-shadow': {
        const material: MotionMaterial = {
          id: generateMotionId('mat'),
          name: 'Projector Shadow',
          type: 'shadow',
          color: '#ffffff',
          opacity: 1,
          params: { style: 'projector-shadow', shadowSpread: 20, shadowOpacity: 0.6 },
        };
        onApplyOps([makeMotionOp('motion.setMaterial', doc.id, { objectId: obj.id, material })], 'Projector shadow');
        break;
      }
    }
  };

  const categories = ['all', 'transcript', 'audio', 'spatial', 'visual'] as const;
  const filtered = CAPTION_DESIGN_PRESETS.filter((p) => activeCategory === 'all' || p.category === activeCategory);

  return (
    <div style={{ padding: '10px' }}>
      <div style={{ fontSize: '10px', color: 'var(--color-subtle)', marginBottom: '8px', lineHeight: 1.5 }}>
        Captions as Set Design — bind text to transcript timing, signals, and spatial relationships.
      </div>

      {/* Category filter */}
      <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', marginBottom: '8px' }}>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            style={{ fontSize: '9px', padding: '2px 7px', background: activeCategory === cat ? 'rgba(139,92,246,0.15)' : 'transparent', border: `1px solid ${activeCategory === cat ? 'rgba(139,92,246,0.4)' : 'var(--color-border)'}`, borderRadius: '10px', color: activeCategory === cat ? 'var(--color-accent-2)' : 'var(--color-subtle)', cursor: 'pointer', fontFamily: 'var(--font-sans)', textTransform: 'capitalize' }}
          >{cat}</button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {filtered.map((p) => (
          <button
            key={p.id}
            onClick={() => applyPreset(p.id)}
            style={{ padding: '6px 8px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'var(--color-fg)', cursor: 'pointer', fontSize: '10px', fontFamily: 'var(--font-sans)', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <span style={{ fontSize: '14px', flexShrink: 0 }}>{p.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: '10px' }}>{p.label}</div>
              <div style={{ fontSize: '9px', color: 'var(--color-subtle)', marginTop: '1px' }}>{p.desc}</div>
            </div>
            <span style={{ fontSize: '8px', color: 'var(--color-subtle)', background: 'var(--color-elevated)', padding: '1px 4px', borderRadius: '3px', flexShrink: 0 }}>{p.category}</span>
          </button>
        ))}
      </div>

      {/* Active bindings */}
      {(obj.behaviors ?? []).filter((b) => b.signalBinding || b.type === 'word-by-word').length > 0 && (
        <div style={{ marginTop: '10px' }}>
          <Label>Active Bindings ({(obj.behaviors ?? []).filter((b) => b.signalBinding || b.type === 'word-by-word').length})</Label>
          {(obj.behaviors ?? []).filter((b) => b.signalBinding || b.type === 'word-by-word').map((b) => (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 6px', background: 'rgba(34,211,238,0.06)', border: '1px solid rgba(34,211,238,0.15)', borderRadius: '3px', marginBottom: '3px' }}>
              <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#22D3EE', flexShrink: 0 }} />
              <span style={{ fontSize: '9px', color: 'var(--color-fg)', flex: 1, fontFamily: 'var(--font-mono)' }}>{b.type} → {(b.params.property as string) ?? b.type}</span>
              <button onClick={() => onApplyOps([makeMotionOp('motion.removeBehavior', doc.id, { objectId: obj.id, behaviorId: b.id })], 'Remove binding')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger)', fontSize: '10px' }}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Material Section ──────────────────────────────────────────

function MaterialSection({ doc, obj, seg, onApplyOps }: { doc: MotionDocument; obj: MotionObject; seg?: MotionTextSegment; onApplyOps: (ops: ReturnType<typeof makeMotionOp>[], desc: string) => void }) {
  const objMaterial: MotionMaterial | undefined = obj.materialId ? doc.materials[obj.materialId] : undefined;
  const [customColor, setCustomColor] = useState(objMaterial?.color ?? '#ffffff');
  const [opacity, setOpacity] = useState((objMaterial?.opacity ?? 1) * 100);
  const [gradStart, setGradStart] = useState('#3b82f6');
  const [gradEnd, setGradEnd] = useState('#8b5cf6');
  const [gradAngle, setGradAngle] = useState(135);
  const [glowColor, setGlowColor] = useState('#00d4ff');
  const [glowRadius, setGlowRadius] = useState(20);

  useEffect(() => {
    setCustomColor(objMaterial?.color ?? '#ffffff');
    setOpacity((objMaterial?.opacity ?? 1) * 100);
  }, [obj.id]);

  const applyMaterialPreset = (preset: typeof MATERIAL_PRESETS[0]) => {
    const material: MotionMaterial = {
      id: generateMotionId('mat'),
      name: preset.label,
      type: preset.type,
      color: preset.color,
      opacity: opacity / 100,
      ...('params' in preset && preset.params ? {
        params: preset.params,
        ...(preset.type === 'gradient' ? {
          gradientStops: [
            { offset: 0, color: String(preset.params.stop0 ?? preset.color) },
            { offset: 1, color: String(preset.params.stop1 ?? preset.color) },
          ],
          gradientAngle: Number(preset.params.angle ?? 135),
        } : preset.type === 'neon' ? {
          neonColor: preset.color,
          neonBlur: 18,
          neonIntensity: 1.5,
        } : {}),
      } : {}),
    };
    onApplyOps([makeMotionOp('motion.setMaterial', doc.id, { objectId: obj.id, material })], `Material: ${preset.label}`);
  };

  const applyCustomGradient = () => {
    const material: MotionMaterial = {
      id: generateMotionId('mat'),
      name: 'Custom Gradient',
      type: 'gradient',
      color: gradStart,
      gradientStops: [
        { offset: 0, color: gradStart },
        { offset: 1, color: gradEnd },
      ],
      gradientAngle: gradAngle,
      opacity: opacity / 100,
    };
    onApplyOps([makeMotionOp('motion.setMaterial', doc.id, { objectId: obj.id, material })], 'Custom gradient');
  };

  const applyGlow = () => {
    const material: MotionMaterial = {
      id: generateMotionId('mat'),
      name: 'Glow',
      type: 'neon',
      color: glowColor,
      opacity: opacity / 100,
      neonColor: glowColor,
      neonBlur: glowRadius,
      neonIntensity: 1.5,
      params: { glowRadius, glowIntensity: 1.5 },
    };
    onApplyOps([makeMotionOp('motion.setMaterial', doc.id, { objectId: obj.id, material })], 'Glow material');
  };

  const commitCustomColor = (hex: string) => {
    const material: MotionMaterial = {
      ...(objMaterial ?? { id: generateMotionId('mat'), name: 'Fill', type: 'solid' as const }),
      color: hex,
      opacity: opacity / 100,
    };
    onApplyOps([makeMotionOp('motion.setMaterial', doc.id, { objectId: obj.id, material })], 'Set color');
  };

  return (
    <div style={{ padding: '10px' }}>
      <Label>Material Presets</Label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px', marginBottom: '10px' }}>
        {MATERIAL_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => applyMaterialPreset(p)}
            style={{ padding: '5px 4px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '4px', cursor: 'pointer', fontSize: '9px', color: 'var(--color-fg)', fontFamily: 'var(--font-sans)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}
          >
            <div style={{ width: '18px', height: '18px', borderRadius: '3px', background: p.color, border: '1px solid rgba(255,255,255,0.1)' }} />
            <span style={{ fontSize: '8px', color: 'var(--color-subtle)', textAlign: 'center', lineHeight: 1.1 }}>{p.label}</span>
          </button>
        ))}
      </div>

      {/* Custom color */}
      <Label>Custom Color</Label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <input type="color" value={customColor} onChange={(e) => setCustomColor(e.target.value)} onBlur={(e) => commitCustomColor(e.target.value)} style={{ width: '32px', height: '26px', border: '1px solid var(--color-border)', borderRadius: '3px', cursor: 'pointer', padding: '1px' }} aria-label="Custom color" />
        <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--color-muted)' }}>{customColor}</span>
      </div>

      {/* Opacity */}
      <Label>Opacity</Label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
        <input type="range" min={0} max={100} value={opacity} onChange={(e) => setOpacity(+e.target.value)} onMouseUp={() => {
          const material: MotionMaterial = { ...(objMaterial ?? { id: generateMotionId('mat'), name: 'Fill', type: 'solid' as const }), opacity: opacity / 100 };
          onApplyOps([makeMotionOp('motion.setMaterial', doc.id, { objectId: obj.id, material })], 'Set opacity');
        }} className="range-slider" style={{ flex: 1 }} aria-label="Material opacity" />
        <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--color-fg)', minWidth: '28px' }}>{Math.round(opacity)}%</span>
      </div>

      {/* Custom gradient builder */}
      <div style={{ background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '8px', marginBottom: '8px' }}>
        <Label>Custom Gradient</Label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '6px' }}>
          <div>
            <Label>Start</Label>
            <input type="color" value={gradStart} onChange={(e) => setGradStart(e.target.value)} style={{ width: '100%', height: '26px', border: '1px solid var(--color-border)', borderRadius: '3px', cursor: 'pointer', padding: '1px' }} aria-label="Gradient start color" />
          </div>
          <div>
            <Label>End</Label>
            <input type="color" value={gradEnd} onChange={(e) => setGradEnd(e.target.value)} style={{ width: '100%', height: '26px', border: '1px solid var(--color-border)', borderRadius: '3px', cursor: 'pointer', padding: '1px' }} aria-label="Gradient end color" />
          </div>
        </div>
        <Label>Angle</Label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
          <input type="range" min={0} max={360} value={gradAngle} onChange={(e) => setGradAngle(+e.target.value)} className="range-slider" style={{ flex: 1 }} aria-label="Gradient angle" />
          <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--color-fg)', minWidth: '28px' }}>{gradAngle}°</span>
        </div>
        <button onClick={applyCustomGradient} style={{ width: '100%', padding: '4px', background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: '3px', color: 'var(--color-accent-2)', cursor: 'pointer', fontSize: '10px', fontFamily: 'var(--font-sans)' }}>Apply Gradient</button>
      </div>

      {/* Glow builder */}
      <div style={{ background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '8px' }}>
        <Label>Glow / Neon</Label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <input type="color" value={glowColor} onChange={(e) => setGlowColor(e.target.value)} style={{ width: '32px', height: '26px', border: '1px solid var(--color-border)', borderRadius: '3px', cursor: 'pointer', padding: '1px' }} aria-label="Glow color" />
          <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--color-muted)', flex: 1 }}>{glowColor}</span>
        </div>
        <Label>Radius</Label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
          <input type="range" min={4} max={60} value={glowRadius} onChange={(e) => setGlowRadius(+e.target.value)} className="range-slider" style={{ flex: 1 }} aria-label="Glow radius" />
          <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--color-fg)', minWidth: '24px' }}>{glowRadius}</span>
        </div>
        <button onClick={applyGlow} style={{ width: '100%', padding: '4px', background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.2)', borderRadius: '3px', color: '#00d4ff', cursor: 'pointer', fontSize: '10px', fontFamily: 'var(--font-sans)' }}>Apply Glow</button>
      </div>
    </div>
  );
}

// ── Spatial Section ───────────────────────────────────────────

function SpatialSection({ doc, obj, onApplyOps }: { doc: MotionDocument; obj: MotionObject; onApplyOps: (ops: ReturnType<typeof makeMotionOp>[], desc: string) => void }) {
  const [depth, setDepth] = useState(obj.depth);
  const [posZ, setPosZ] = useState(obj.transform.z);
  const [parallaxAmt, setParallaxAmt] = useState(20);
  const [cameraResponse, setCameraResponse] = useState(0.5);

  useEffect(() => { setDepth(obj.depth); setPosZ(obj.transform.z); }, [obj.id]);

  const applySpatialPreset = (preset: typeof SPATIAL_PRESETS[0]) => {
    const ops: ReturnType<typeof makeMotionOp>[] = [
      makeMotionOp('motion.setObjectProp', doc.id, { objectId: obj.id, props: { depth: preset.depth, ...(preset.occlusionRole ? { occlusionRole: preset.occlusionRole } : {}) } }),
      makeMotionOp('motion.setObjectTransform', doc.id, { objectId: obj.id, transform: { z: preset.z } }),
    ];
    setDepth(preset.depth);
    setPosZ(preset.z);
    onApplyOps(ops, `Spatial: ${preset.label}`);
  };

  const addParallaxBehavior = () => {
    const docDurSecs = motionTimeToSeconds(doc.duration);
    const behavior: MotionBehavior = {
      id: generateMotionId('beh'),
      type: 'signal-reactive',
      startTime: secondsToMotionTime(0),
      duration: secondsToMotionTime(docDurSecs),
      params: { property: 'position.x', min: -parallaxAmt, max: parallaxAmt },
      easing: 'linear',
    };
    onApplyOps([makeMotionOp('motion.addBehavior', doc.id, { objectId: obj.id, behavior })], 'Add parallax');
  };

  const addCameraResponseBehavior = () => {
    const docDurSecs = motionTimeToSeconds(doc.duration);
    const behavior: MotionBehavior = {
      id: generateMotionId('beh'),
      type: 'signal-reactive',
      startTime: secondsToMotionTime(0),
      duration: secondsToMotionTime(docDurSecs),
      params: { property: 'position.z', min: posZ, max: posZ + 50 * cameraResponse },
      easing: 'ease-in-out',
    };
    onApplyOps([makeMotionOp('motion.addBehavior', doc.id, { objectId: obj.id, behavior })], 'Camera response');
  };

  return (
    <div style={{ padding: '10px' }}>
      <Label>Plane Presets</Label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '10px' }}>
        {SPATIAL_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => applySpatialPreset(p)}
            style={{ padding: '5px 8px', background: obj.depth === p.depth ? 'rgba(139,92,246,0.12)' : 'var(--color-well)', border: `1px solid ${obj.depth === p.depth ? 'rgba(139,92,246,0.3)' : 'var(--color-border)'}`, borderRadius: '4px', color: 'var(--color-fg)', cursor: 'pointer', fontSize: '10px', fontFamily: 'var(--font-sans)', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--color-subtle)', minWidth: '28px' }}>z:{p.depth}</span>
            <div>
              <span style={{ fontWeight: 600 }}>{p.label}</span>
              <span style={{ fontSize: '9px', color: 'var(--color-subtle)', marginLeft: '6px' }}>{p.desc}</span>
            </div>
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '8px' }}>
        <div>
          <Label>Layer Depth</Label>
          <input type="number" value={depth} step={1} onChange={(e) => setDepth(+e.target.value)} onBlur={() => onApplyOps([makeMotionOp('motion.setObjectProp', doc.id, { objectId: obj.id, props: { depth } })], 'Set depth')} style={numInputStyle} />
        </div>
        <div>
          <Label>Z Position</Label>
          <input type="number" value={posZ} step={10} onChange={(e) => setPosZ(+e.target.value)} onBlur={() => onApplyOps([makeMotionOp('motion.setObjectTransform', doc.id, { objectId: obj.id, transform: { z: posZ } })], 'Set Z position')} style={numInputStyle} />
        </div>
      </div>

      {/* Parallax */}
      <div style={{ background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '8px', marginBottom: '8px' }}>
        <Label>Parallax</Label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
          <input type="range" min={0} max={80} value={parallaxAmt} onChange={(e) => setParallaxAmt(+e.target.value)} className="range-slider" style={{ flex: 1 }} aria-label="Parallax amount" />
          <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--color-fg)', minWidth: '24px' }}>{parallaxAmt}</span>
        </div>
        <button onClick={addParallaxBehavior} style={{ width: '100%', padding: '4px', background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.2)', borderRadius: '3px', color: '#22D3EE', cursor: 'pointer', fontSize: '10px', fontFamily: 'var(--font-sans)' }}>
          + Add Parallax Behavior
        </button>
      </div>

      {/* Camera response */}
      <div style={{ background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '8px', marginBottom: '8px' }}>
        <Label>Camera Response</Label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
          <input type="range" min={0} max={1} step={0.05} value={cameraResponse} onChange={(e) => setCameraResponse(+e.target.value)} className="range-slider" style={{ flex: 1 }} aria-label="Camera response" />
          <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--color-fg)', minWidth: '24px' }}>{cameraResponse.toFixed(2)}</span>
        </div>
        <button onClick={addCameraResponseBehavior} style={{ width: '100%', padding: '4px', background: 'rgba(59,130,255,0.08)', border: '1px solid rgba(59,130,255,0.2)', borderRadius: '3px', color: 'var(--color-accent)', cursor: 'pointer', fontSize: '10px', fontFamily: 'var(--font-sans)' }}>
          + Add Camera Response
        </button>
      </div>

      <Label>Occlusion Role</Label>
      <select
        value={obj.occlusionRole ?? 'none'}
        onChange={(e) => onApplyOps([makeMotionOp('motion.setObjectProp', doc.id, { objectId: obj.id, props: { occlusionRole: e.target.value as MotionObject['occlusionRole'] } })], 'Set occlusion role')}
        style={selectStyle}
      >
        <option value="none">None</option>
        <option value="foreground">Foreground (in front)</option>
        <option value="background">Background (behind)</option>
        <option value="subject">Subject</option>
      </select>
    </div>
  );
}
