'use client';

/**
 * SignalBindingPanel — Visible, contextual signal binding interface.
 * Source → target mapping for available signals.
 * Bindings are visible and removable. No hidden magic.
 */

import React, { useState, useCallback } from 'react';
import { useEngine } from '@/engine/store';
import { resolveClipMotionDocument, motionTransactionToStudioOps } from '@/engine/motion-bridge';
import type { MotionObject, MotionBehavior, MotionSignal } from '@/motion/types';
import { makeMotionOp, createMotionTransaction } from '@/motion/transaction';
import { secondsToMotionTime, motionTimeToSeconds } from '@/motion/types';
import { generateMotionId } from '@/motion/utils';

// ── Signal Sources ────────────────────────────────────────────

const SIGNAL_SOURCES = [
  { kind: 'audio-rms', label: 'Audio RMS', icon: '🔊', color: '#3B82F6', desc: 'Overall audio level' },
  { kind: 'audio-low', label: 'Bass', icon: '🎸', color: '#8B5CF6', desc: 'Low frequency energy' },
  { kind: 'audio-mid', label: 'Mid', icon: '🎹', color: '#06B6D4', desc: 'Mid frequency energy' },
  { kind: 'audio-high', label: 'Treble', icon: '🎵', color: '#10B981', desc: 'High frequency energy' },
  { kind: 'audio-beat', label: 'Beat', icon: '🥁', color: '#F59E0B', desc: 'Rhythmic beat detection' },
  { kind: 'audio-onset', label: 'Onset', icon: '⚡', color: '#EF4444', desc: 'Transient onset detection' },
  { kind: 'audio-transient', label: 'Transient', icon: '✦', color: '#F97316', desc: 'Sharp transients' },
  { kind: 'speech-timing', label: 'Speech Word', icon: '🎙', color: '#A78BFA', desc: 'Active spoken word' },
  { kind: 'semantic-emphasis', label: 'Emphasis', icon: '⬆', color: '#EC4899', desc: 'Semantic emphasis level' },
  { kind: 'cue', label: 'Cue', icon: '📍', color: '#34D399', desc: 'Timeline cue trigger' },
  { kind: 'marker', label: 'Marker', icon: '🚩', color: '#FCD34D', desc: 'Timeline marker trigger' },
  { kind: 'manual', label: 'Manual', icon: '🎛', color: '#9CA3AF', desc: 'Manual control value' },
];

// ── Target Properties ─────────────────────────────────────────

const TARGET_PROPERTIES = [
  { prop: 'scale.x', label: 'Scale X', group: 'Transform' },
  { prop: 'scale.y', label: 'Scale Y', group: 'Transform' },
  { prop: 'scale.uniform', label: 'Scale (uniform)', group: 'Transform' },
  { prop: 'position.x', label: 'Position X', group: 'Transform' },
  { prop: 'position.y', label: 'Position Y', group: 'Transform' },
  { prop: 'position.z', label: 'Depth (Z)', group: 'Transform' },
  { prop: 'rotation.z', label: 'Rotation', group: 'Transform' },
  { prop: 'opacity', label: 'Opacity', group: 'Transform' },
  { prop: 'blur', label: 'Blur', group: 'Visual' },
  { prop: 'brightness', label: 'Brightness', group: 'Visual' },
  { prop: 'saturation', label: 'Saturation', group: 'Visual' },
  { prop: 'glow', label: 'Glow Intensity', group: 'Visual' },
  { prop: 'fontSize', label: 'Font Size', group: 'Text' },
  { prop: 'letterSpacing', label: 'Letter Spacing', group: 'Text' },
  { prop: 'camera.z', label: 'Camera Z', group: 'Camera' },
  { prop: 'camera.fov', label: 'Camera FOV', group: 'Camera' },
];

// ── Starter Bindings ──────────────────────────────────────────

const STARTER_BINDINGS = [
  { id: 'bass-push', label: 'Bass Push', icon: '🎸', source: 'audio-low', target: 'position.y', min: 0, max: -20, desc: 'Bass pushes elements upward', color: '#8B5CF6' },
  { id: 'onset-punch', label: 'Onset Punch', icon: '⚡', source: 'audio-onset', target: 'scale.x', min: 1, max: 1.3, desc: 'Onsets punch scale', color: '#EF4444' },
  { id: 'beat-stagger', label: 'Beat Stagger', icon: '🥁', source: 'audio-beat', target: 'position.x', min: -5, max: 5, desc: 'Beat staggers position', color: '#F59E0B' },
  { id: 'pause-settle', label: 'Pause Settle', icon: '⏸', source: 'speech-timing', target: 'position.y', min: 0, max: 8, desc: 'Settles during pauses', color: '#A78BFA' },
  { id: 'emphasis-forward', label: 'Emphasis Forward', icon: '⬆', source: 'semantic-emphasis', target: 'position.z', min: 0, max: 150, desc: 'Emphasis moves forward in depth', color: '#EC4899' },
  { id: 'speaker-opacity', label: 'Speaker Opacity', icon: '👤', source: 'speech-timing', target: 'opacity', min: 0.6, max: 1, desc: 'Opacity follows speech timing', color: '#A78BFA' },
  { id: 'cadence-stagger', label: 'Cadence Stagger', icon: '🎵', source: 'audio-mid', target: 'rotation.z', min: -3, max: 3, desc: 'Mid-freq drives rotation', color: '#06B6D4' },
  { id: 'audio-glow', label: 'Audio Glow', icon: '✨', source: 'audio-rms', target: 'scale.x', min: 0.95, max: 1.1, desc: 'RMS drives subtle scale glow', color: '#3B82F6' },
  { id: 'camera-pulse', label: 'Camera Pulse', icon: '📷', source: 'audio-beat', target: 'position.z', min: -800, max: -750, desc: 'Beat pulses camera Z', color: '#F59E0B' },
  { id: 'treble-brightness', label: 'Treble Bright', icon: '🎵', source: 'audio-high', target: 'brightness', min: 1, max: 1.3, desc: 'Treble drives brightness', color: '#10B981' },
  { id: 'emphasis-scale', label: 'Emphasis Scale', icon: '⬆', source: 'semantic-emphasis', target: 'scale.uniform', min: 1, max: 1.25, desc: 'Emphasis scales uniformly', color: '#EC4899' },
  { id: 'bass-depth', label: 'Bass Depth', icon: '🎸', source: 'audio-low', target: 'position.z', min: 0, max: 80, desc: 'Bass drives depth forward', color: '#8B5CF6' },
];

const numInputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px',
  color: 'var(--color-fg)', fontSize: '11px', fontFamily: 'var(--font-mono)', padding: '3px 6px', boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = {
  width: '100%', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px',
  color: 'var(--color-fg)', fontSize: '11px', fontFamily: 'var(--font-sans)', padding: '3px 6px', boxSizing: 'border-box',
};

interface SignalBindingPanelProps {
  clipId: string;
}

export default function SignalBindingPanel({ clipId }: SignalBindingPanelProps) {
  const engine = useEngine();
  const { project, activeSequence, dispatchBatch } = engine;

  const clip = activeSequence?.clips.find((c) => c.id === clipId) ?? null;
  const doc = clip && project ? resolveClipMotionDocument(project, clip) : null;

  const [selectedSource, setSelectedSource] = useState<string>('audio-beat');
  const [selectedTarget, setSelectedTarget] = useState<string>('scale.x');
  const [selectedObjectId, setSelectedObjectId] = useState<string>('');
  const [minVal, setMinVal] = useState(0.8);
  const [maxVal, setMaxVal] = useState(1.2);
  const [easingType, setEasingType] = useState<string>('ease-out');
  const [activeTab, setActiveTab] = useState<'starters' | 'custom' | 'active'>('starters');

  const applyMotionOps = useCallback((ops: ReturnType<typeof makeMotionOp>[], description: string) => {
    if (!project || !doc) return;
    const transaction = createMotionTransaction(description, ops);
    const studioOps = motionTransactionToStudioOps(transaction, project);
    if (studioOps.length > 0) dispatchBatch(studioOps, description);
  }, [project, doc, dispatchBatch]);

  if (!doc) {
    return (
      <div style={{ padding: '16px', textAlign: 'center', fontSize: '11px', color: 'var(--color-muted)' }}>
        Select a Motion clip to bind signals
      </div>
    );
  }

  const docDurSecs = motionTimeToSeconds(doc.duration);
  const rootObjs = doc.rootObjectIds.map((id) => doc.objects[id]).filter(Boolean);

  // Collect all active signal bindings across all objects
  const allBindings: Array<{ obj: MotionObject; behavior: MotionBehavior; signal?: MotionSignal }> = [];
  for (const obj of rootObjs) {
    for (const beh of obj.behaviors) {
      if (beh.signalBinding) {
        allBindings.push({ obj, behavior: beh, signal: doc.signals[beh.signalBinding] });
      }
    }
  }

  const applyStarterBinding = (starter: typeof STARTER_BINDINGS[0]) => {
    const targetObj = rootObjs[0];
    if (!targetObj) return;

    const existingSig = Object.values(doc.signals).find((s) => s.kind === starter.source);
    const sigId = existingSig?.id ?? generateMotionId('sig');
    const ops: ReturnType<typeof makeMotionOp>[] = [];

    if (!existingSig) {
      const signal: MotionSignal = {
        id: sigId,
        kind: starter.source as MotionSignal['kind'],
        name: SIGNAL_SOURCES.find((s) => s.kind === starter.source)?.label ?? starter.source,
      };
      ops.push(makeMotionOp('motion.upsertSignal', doc.id, { signal }));
    }

    // Handle camera pulse specially
    if (starter.id === 'camera-pulse') {
      if (!doc.camera) {
        const cam = {
          id: generateMotionId('cam'), name: 'Camera',
          transform: { position: { x: 0, y: 0, z: -800 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, anchor: { x: 0, y: 0, z: 0 }, opacity: 1 },
          keyframes: [], fov: 60, near: 1, far: 10000,
        };
        ops.push(makeMotionOp('motion.setCamera', doc.id, { camera: cam }));
      }
    }

    const easing = starter.source.includes('beat') || starter.source.includes('onset') ? 'spring' : 'ease-out';
    const behavior: MotionBehavior = {
      id: generateMotionId('beh'),
      type: 'signal-reactive',
      startTime: secondsToMotionTime(0),
      duration: secondsToMotionTime(docDurSecs),
      params: { property: starter.target, min: starter.min, max: starter.max },
      signalBinding: sigId,
      easing: easing as MotionBehavior['easing'],
    };

    ops.push(makeMotionOp('motion.addBehavior', doc.id, { objectId: targetObj.id, behavior }));
    applyMotionOps(ops, `Signal: ${starter.label}`);
  };

  const addCustomBinding = () => {
    const targetObj = selectedObjectId ? doc.objects[selectedObjectId] : rootObjs[0];
    if (!targetObj) return;

    const existingSig = Object.values(doc.signals).find((s) => s.kind === selectedSource);
    const sigId = existingSig?.id ?? generateMotionId('sig');
    const ops: ReturnType<typeof makeMotionOp>[] = [];

    if (!existingSig) {
      const signal: MotionSignal = {
        id: sigId,
        kind: selectedSource as MotionSignal['kind'],
        name: SIGNAL_SOURCES.find((s) => s.kind === selectedSource)?.label ?? selectedSource,
      };
      ops.push(makeMotionOp('motion.upsertSignal', doc.id, { signal }));
    }

    const behavior: MotionBehavior = {
      id: generateMotionId('beh'),
      type: 'signal-reactive',
      startTime: secondsToMotionTime(0),
      duration: secondsToMotionTime(docDurSecs),
      params: { property: selectedTarget, min: minVal, max: maxVal },
      signalBinding: sigId,
      easing: easingType as MotionBehavior['easing'],
    };

    ops.push(makeMotionOp('motion.addBehavior', doc.id, { objectId: targetObj.id, behavior }));
    applyMotionOps(ops, `Custom binding: ${selectedSource} → ${selectedTarget}`);
  };

  const removeBinding = (objId: string, behaviorId: string) => {
    applyMotionOps([makeMotionOp('motion.removeBehavior', doc.id, { objectId: objId, behaviorId })], 'Remove signal binding');
  };

  const tabStyle = (active: boolean) => ({
    flex: 1, padding: '4px 6px', background: active ? 'rgba(34,211,238,0.12)' : 'transparent',
    border: 'none', borderBottom: `2px solid ${active ? '#22D3EE' : 'transparent'}`,
    color: active ? '#22D3EE' : 'var(--color-subtle)', cursor: 'pointer', fontSize: '10px',
    fontFamily: 'var(--font-sans)', fontWeight: active ? 600 : 400,
  });

  // Group target properties by group
  const targetGroups = TARGET_PROPERTIES.reduce((acc, tp) => {
    if (!acc[tp.group]) acc[tp.group] = [];
    acc[tp.group].push(tp);
    return acc;
  }, {} as Record<string, typeof TARGET_PROPERTIES>);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        <button style={tabStyle(activeTab === 'starters')} onClick={() => setActiveTab('starters')}>Starters</button>
        <button style={tabStyle(activeTab === 'custom')} onClick={() => setActiveTab('custom')}>Custom</button>
        <button style={tabStyle(activeTab === 'active')} onClick={() => setActiveTab('active')}>
          Active {allBindings.length > 0 ? `(${allBindings.length})` : ''}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {/* Starter Bindings */}
        {activeTab === 'starters' && (
          <div style={{ padding: '8px' }}>
            <div style={{ fontSize: '10px', color: 'var(--color-subtle)', marginBottom: '8px', lineHeight: 1.5 }}>
              One-click bindings. Applied to the first root object. Visible and removable in Active tab.
            </div>
            {STARTER_BINDINGS.map((starter) => (
              <button
                key={starter.id}
                onClick={() => applyStarterBinding(starter)}
                style={{ width: '100%', padding: '7px 8px', background: 'var(--color-well)', border: `1px solid var(--color-border)`, borderRadius: '4px', color: 'var(--color-fg)', cursor: 'pointer', fontSize: '10px', fontFamily: 'var(--font-sans)', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}
              >
                <span style={{ fontSize: '14px', flexShrink: 0 }}>{starter.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '10px' }}>{starter.label}</div>
                  <div style={{ fontSize: '9px', color: 'var(--color-subtle)', marginTop: '1px' }}>{starter.desc}</div>
                </div>
                <div style={{ fontSize: '9px', color: starter.color, fontFamily: 'var(--font-mono)', flexShrink: 0, background: `${starter.color}15`, padding: '1px 5px', borderRadius: '3px' }}>
                  {starter.source.replace('audio-', '').replace('speech-', '').replace('semantic-', '')} → {starter.target.split('.').pop()}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Custom Binding */}
        {activeTab === 'custom' && (
          <div style={{ padding: '8px' }}>
            <Label>Signal Source</Label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px', marginBottom: '8px' }}>
              {SIGNAL_SOURCES.map((s) => (
                <button
                  key={s.kind}
                  onClick={() => setSelectedSource(s.kind)}
                  style={{ padding: '4px 6px', background: selectedSource === s.kind ? `${s.color}22` : 'var(--color-well)', border: `1px solid ${selectedSource === s.kind ? s.color + '66' : 'var(--color-border)'}`, borderRadius: '3px', color: selectedSource === s.kind ? s.color : 'var(--color-muted)', cursor: 'pointer', fontSize: '9px', fontFamily: 'var(--font-sans)', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <span>{s.icon}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                </button>
              ))}
            </div>

            <Label>Target Property</Label>
            <select value={selectedTarget} onChange={(e) => setSelectedTarget(e.target.value)} style={{ ...selectStyle, marginBottom: '8px' }}>
              {Object.entries(targetGroups).map(([group, props]) => (
                <optgroup key={group} label={group}>
                  {props.map((tp) => <option key={tp.prop} value={tp.prop}>{tp.label}</option>)}
                </optgroup>
              ))}
            </select>

            <Label>Target Object</Label>
            <select value={selectedObjectId} onChange={(e) => setSelectedObjectId(e.target.value)} style={{ ...selectStyle, marginBottom: '8px' }}>
              <option value="">First root object</option>
              {rootObjs.map((obj) => <option key={obj.id} value={obj.id}>{obj.name} ({obj.kind})</option>)}
            </select>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '8px' }}>
              <div>
                <Label>Min Value</Label>
                <input type="number" value={minVal} step={0.1} onChange={(e) => setMinVal(+e.target.value)} style={numInputStyle} />
              </div>
              <div>
                <Label>Max Value</Label>
                <input type="number" value={maxVal} step={0.1} onChange={(e) => setMaxVal(+e.target.value)} style={numInputStyle} />
              </div>
            </div>

            <Label>Easing</Label>
            <select value={easingType} onChange={(e) => setEasingType(e.target.value)} style={{ ...selectStyle, marginBottom: '8px' }}>
              {['linear', 'ease-in', 'ease-out', 'ease-in-out', 'spring', 'bounce'].map((e) => <option key={e} value={e}>{e}</option>)}
            </select>

            <button
              onClick={addCustomBinding}
              style={{ width: '100%', padding: '6px', background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.3)', borderRadius: '4px', color: '#22D3EE', cursor: 'pointer', fontSize: '11px', fontFamily: 'var(--font-sans)', fontWeight: 600 }}
            >
              + Add Binding
            </button>
          </div>
        )}

        {/* Active Bindings */}
        {activeTab === 'active' && (
          <div style={{ padding: '8px' }}>
            {allBindings.length === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginBottom: '4px' }}>No active bindings</div>
                <div style={{ fontSize: '11px', color: 'var(--color-subtle)' }}>Add bindings from Starters or Custom tabs.</div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: '10px', color: 'var(--color-subtle)', marginBottom: '8px' }}>
                  {allBindings.length} active binding{allBindings.length !== 1 ? 's' : ''}. All are visible and removable.
                </div>
                {allBindings.map(({ obj, behavior, signal }) => {
                  const sourceInfo = SIGNAL_SOURCES.find((s) => s.kind === signal?.kind);
                  const targetProp = behavior.params.property as string;
                  return (
                    <div
                      key={behavior.id}
                      style={{ padding: '8px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '4px', marginBottom: '4px' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                        <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: sourceInfo?.color ?? '#22D3EE', flexShrink: 0 }} />
                        <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-fg)', flex: 1 }}>
                          {sourceInfo?.label ?? signal?.kind ?? 'Unknown'} → {targetProp}
                        </span>
                        <button
                          onClick={() => removeBinding(obj.id, behavior.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger)', fontSize: '11px', padding: '0 2px' }}
                          title="Remove binding"
                          aria-label="Remove binding"
                        >✕</button>
                      </div>
                      <div style={{ fontSize: '9px', color: 'var(--color-subtle)', fontFamily: 'var(--font-mono)', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <span>obj: {obj.name}</span>
                        <span>min: {behavior.params.min as number}</span>
                        <span>max: {behavior.params.max as number}</span>
                        <span>easing: {behavior.easing ?? 'ease-out'}</span>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: '9px', fontWeight: 600, color: 'var(--color-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px', marginTop: '2px' }}>{children}</div>;
}
