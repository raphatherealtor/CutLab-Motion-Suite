'use client';

/**
 * SignalResourcePanel — First-class editable signal mappings.
 * Shows all available signal channels with real host resources.
 * Supports signal intersection/gating.
 * SOURCE → CHANNEL → MAPPING → TARGET
 */

import React, { useState, useCallback } from 'react';
import { useEngine } from '@/engine/store';
import { resolveClipMotionDocument, motionTransactionToStudioOps } from '@/engine/motion-bridge';
import { SIGNAL_CHANNEL_REGISTRY, createDefaultSignalMapping, PRESET_SIGNAL_GATES, evaluateSignalChannel, type SignalMapping, type SignalGate,  } from '@/engine/signal-resources';
import { makeMotionOp, createMotionTransaction } from '@/motion/transaction';
import { secondsToMotionTime, motionTimeToSeconds } from '@/motion/types';
import { generateMotionId } from '@/motion/utils';
import type { MotionSignal, MotionBehavior } from '@/motion/types';

const CATEGORY_COLORS = {
  audio: '#3B82F6',
  speech: '#A78BFA',
  timeline: '#10B981',
  subject: '#F59E0B',
  data: '#6B7280',
};

const CATEGORY_ICONS = {
  audio: '🔊',
  speech: '🎙',
  timeline: '⏱',
  subject: '👤',
  data: '📊',
};

interface SignalResourcePanelProps {
  clipId: string;
}

export default function SignalResourcePanel({ clipId }: SignalResourcePanelProps) {
  const engine = useEngine();
  const { project, activeSequence, session, dispatchBatch } = engine;
  const fps = activeSequence?.format.fps ?? 29.97;
  const currentTimeSecs = session.playheadFrame / fps;

  const clip = activeSequence?.clips.find((c) => c.id === clipId) ?? null;
  const doc = clip && project ? resolveClipMotionDocument(project, clip) : null;

  const [activeTab, setActiveTab] = useState<'channels' | 'mappings' | 'gates' | 'active'>('channels');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [editingMapping, setEditingMapping] = useState<SignalMapping | null>(null);
  const [expandedGateId, setExpandedGateId] = useState<string | null>(null);

  const applyMotionOps = useCallback((ops: ReturnType<typeof makeMotionOp>[], description: string) => {
    if (!project || !doc) return;
    const transaction = createMotionTransaction(description, ops);
    const studioOps = motionTransactionToStudioOps(transaction, project);
    if (studioOps.length > 0) dispatchBatch(studioOps, description);
  }, [project, doc, dispatchBatch]);

  // Build signal host context for live preview
  const signalCtx = {
    timeSecs: currentTimeSecs,
    clipDurationSecs: doc ? motionTimeToSeconds(doc.duration) : 10,
  };

  const filteredChannels = SIGNAL_CHANNEL_REGISTRY.filter(
    (ch) => selectedCategory === 'all' || ch.category === selectedCategory
  );

  const addSignalBinding = useCallback((channelId: string, targetProp: string) => {
    if (!doc) return;
    const targetObj = doc.rootObjectIds.map((id) => doc.objects[id]).filter(Boolean)[0];
    if (!targetObj) return;

    const docDurSecs = motionTimeToSeconds(doc.duration);
    const sigId = generateMotionId('sig');
    const ops: ReturnType<typeof makeMotionOp>[] = [];

    const signal: MotionSignal = {
      id: sigId,
      kind: channelId.replace('.', '-') as MotionSignal['kind'],
      name: SIGNAL_CHANNEL_REGISTRY.find((c) => c.id === channelId)?.label ?? channelId,
    };
    ops.push(makeMotionOp('motion.upsertSignal', doc.id, { signal }));

    const behavior: MotionBehavior = {
      id: generateMotionId('beh'),
      type: 'signal-reactive',
      startTime: secondsToMotionTime(0),
      duration: secondsToMotionTime(docDurSecs),
      params: { property: targetProp, min: 0, max: 1, channelId },
      signalBinding: sigId,
      easing: 'ease-out',
    };
    ops.push(makeMotionOp('motion.addBehavior', doc.id, { objectId: targetObj.id, behavior }));
    applyMotionOps(ops, `Bind ${channelId} → ${targetProp}`);
  }, [doc, applyMotionOps]);

  const addGateBinding = useCallback((gate: Omit<SignalGate, 'id'>) => {
    if (!doc) return;
    const targetObj = doc.rootObjectIds.map((id) => doc.objects[id]).filter(Boolean)[0];
    if (!targetObj) return;

    const docDurSecs = motionTimeToSeconds(doc.duration);
    const primarySigId = generateMotionId('sig');
    const gateSigId = generateMotionId('sig');
    const ops: ReturnType<typeof makeMotionOp>[] = [];

    const primarySignal: MotionSignal = {
      id: primarySigId,
      kind: gate.primaryChannelId.replace('.', '-') as MotionSignal['kind'],
      name: `${gate.label} (primary)`,
    };
    const gateSignal: MotionSignal = {
      id: gateSigId,
      kind: gate.gateChannelId.replace('.', '-') as MotionSignal['kind'],
      name: `${gate.label} (gate)`,
    };
    ops.push(makeMotionOp('motion.upsertSignal', doc.id, { signal: primarySignal }));
    ops.push(makeMotionOp('motion.upsertSignal', doc.id, { signal: gateSignal }));

    const behavior: MotionBehavior = {
      id: generateMotionId('beh'),
      type: 'signal-reactive',
      startTime: secondsToMotionTime(0),
      duration: secondsToMotionTime(docDurSecs),
      params: {
        property: gate.outputMapping.targetProperty,
        min: gate.outputMapping.outputMin,
        max: gate.outputMapping.outputMax,
        gateMode: gate.gateMode,
        gateThreshold: gate.gateThreshold,
        gateChannelId: gate.gateChannelId,
        label: gate.label,
      },
      signalBinding: primarySigId,
      easing: 'ease-out',
    };
    ops.push(makeMotionOp('motion.addBehavior', doc.id, { objectId: targetObj.id, behavior }));
    applyMotionOps(ops, `Gate: ${gate.label}`);
  }, [doc, applyMotionOps]);

  const tabStyle = (active: boolean) => ({
    flex: 1, padding: '4px 6px', background: active ? 'rgba(34,211,238,0.12)' : 'transparent',
    border: 'none', borderBottom: `2px solid ${active ? '#22D3EE' : 'transparent'}`,
    color: active ? '#22D3EE' : 'var(--color-subtle)', cursor: 'pointer', fontSize: '10px',
    fontFamily: 'var(--font-sans)', fontWeight: active ? 600 : 400,
  });

  if (!doc) {
    return (
      <div style={{ padding: '16px', textAlign: 'center', fontSize: '11px', color: 'var(--color-muted)' }}>
        Select a Motion clip to access signal resources
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        <button style={tabStyle(activeTab === 'channels')} onClick={() => setActiveTab('channels')}>Channels</button>
        <button style={tabStyle(activeTab === 'mappings')} onClick={() => setActiveTab('mappings')}>Mappings</button>
        <button style={tabStyle(activeTab === 'gates')} onClick={() => setActiveTab('gates')}>Gates</button>
        <button style={tabStyle(activeTab === 'active')} onClick={() => setActiveTab('active')}>
          Active ({Object.values(doc.objects).reduce((n, o) => n + o.behaviors.filter((b) => b.signalBinding).length, 0)})
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>

        {/* CHANNELS TAB */}
        {activeTab === 'channels' && (
          <div>
            {/* Category filter */}
            <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {['all', 'audio', 'speech', 'timeline', 'subject', 'data'].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  style={{
                    padding: '2px 7px', fontSize: '9px', borderRadius: '3px', cursor: 'pointer',
                    background: selectedCategory === cat ? (cat === 'all' ? '#22D3EE22' : CATEGORY_COLORS[cat as keyof typeof CATEGORY_COLORS] + '22') : 'var(--color-well)',
                    border: `1px solid ${selectedCategory === cat ? (cat === 'all' ? '#22D3EE' : CATEGORY_COLORS[cat as keyof typeof CATEGORY_COLORS]) : 'var(--color-border)'}`,
                    color: selectedCategory === cat ? (cat === 'all' ? '#22D3EE' : CATEGORY_COLORS[cat as keyof typeof CATEGORY_COLORS]) : 'var(--color-subtle)',
                  }}
                >
                  {cat === 'all' ? 'All' : `${CATEGORY_ICONS[cat as keyof typeof CATEGORY_ICONS]} ${cat}`}
                </button>
              ))}
            </div>

            {filteredChannels.map((ch) => {
              const liveValue = evaluateSignalChannel(ch.id, signalCtx);
              const color = CATEGORY_COLORS[ch.category];

              return (
                <div key={ch.id} style={{ padding: '6px 10px', borderBottom: '1px solid var(--color-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '10px', flexShrink: 0 }}>{CATEGORY_ICONS[ch.category]}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-fg)' }}>{ch.label}</div>
                      <div style={{ fontSize: '9px', color: 'var(--color-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.description}</div>
                    </div>
                    {/* Live value bar */}
                    <div style={{ width: '50px', flexShrink: 0 }}>
                      <div style={{ height: '3px', background: 'var(--color-border)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${liveValue * 100}%`, background: color, borderRadius: '2px', transition: 'width 0.1s' }} />
                      </div>
                      <div style={{ fontSize: '8px', color: 'var(--color-subtle)', textAlign: 'right', marginTop: '1px', fontFamily: 'var(--font-mono)' }}>
                        {liveValue.toFixed(2)}
                      </div>
                    </div>
                    <button
                      onClick={() => addSignalBinding(ch.id, 'scale.uniform')}
                      style={{ fontSize: '9px', padding: '2px 6px', background: color + '22', border: `1px solid ${color}44`, borderRadius: '3px', color, cursor: 'pointer', flexShrink: 0 }}
                      title="Bind to scale"
                    >+</button>
                  </div>
                  {!ch.hasFixture && ch.requiresAnalysis && (
                    <div style={{ fontSize: '8px', color: '#F59E0B', marginTop: '2px' }}>⚠ Requires real analysis data</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* MAPPINGS TAB */}
        {activeTab === 'mappings' && (
          <div style={{ padding: '8px' }}>
            <div style={{ fontSize: '10px', color: 'var(--color-subtle)', marginBottom: '8px', lineHeight: 1.5 }}>
              Signal mappings are first-class editable objects.
              SOURCE → CHANNEL → MAPPING → TARGET
            </div>

            {/* Mapping editor */}
            {editingMapping ? (
              <MappingEditor
                mapping={editingMapping}
                onChange={setEditingMapping}
                onApply={(m) => {
                  // Apply mapping as a signal behavior
                  addSignalBinding(m.sourceChannelId, m.targetProperty);
                  setEditingMapping(null);
                }}
                onCancel={() => setEditingMapping(null)}
              />
            ) : (
              <button
                onClick={() => setEditingMapping(createDefaultSignalMapping('audio.rms', 'scale.uniform', 'New Mapping'))}
                style={{ width: '100%', padding: '8px', background: 'var(--color-well)', border: '1px dashed var(--color-border)', borderRadius: '4px', color: 'var(--color-subtle)', cursor: 'pointer', fontSize: '10px' }}
              >
                + New Signal Mapping
              </button>
            )}
          </div>
        )}

        {/* GATES TAB */}
        {activeTab === 'gates' && (
          <div>
            <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--color-border)', fontSize: '10px', color: 'var(--color-subtle)', lineHeight: 1.5 }}>
              Signal gates combine two signals. Primary fires only when gate condition is met.
            </div>

            {PRESET_SIGNAL_GATES.map((gate, i) => {
              const gateId = `gate-${i}`;
              const isExpanded = expandedGateId === gateId;
              const primaryVal = evaluateSignalChannel(gate.primaryChannelId, signalCtx);
              const gateVal = evaluateSignalChannel(gate.gateChannelId, signalCtx);
              const gateActive = gateVal >= gate.gateThreshold;

              return (
                <div key={gateId} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <div
                    style={{ padding: '7px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                    onClick={() => setExpandedGateId(isExpanded ? null : gateId)}
                  >
                    <span style={{ fontSize: '10px', color: gateActive ? '#10B981' : 'var(--color-subtle)' }}>
                      {gateActive ? '●' : '○'}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-fg)' }}>{gate.label}</div>
                      <div style={{ fontSize: '9px', color: 'var(--color-subtle)' }}>
                        {gate.primaryChannelId} × {gate.gateChannelId} ({gate.gateMode})
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); addGateBinding(gate); }}
                      style={{ fontSize: '9px', padding: '2px 7px', background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '3px', color: '#A78BFA', cursor: 'pointer' }}
                    >Apply</button>
                  </div>

                  {isExpanded && (
                    <div style={{ padding: '6px 10px 8px', background: 'var(--color-well)', fontSize: '9px', color: 'var(--color-subtle)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                        <div>Primary: <span style={{ color: 'var(--color-fg)' }}>{gate.primaryChannelId}</span></div>
                        <div>Gate: <span style={{ color: 'var(--color-fg)' }}>{gate.gateChannelId}</span></div>
                        <div>Mode: <span style={{ color: 'var(--color-fg)' }}>{gate.gateMode}</span></div>
                        <div>Threshold: <span style={{ color: 'var(--color-fg)' }}>{gate.gateThreshold}</span></div>
                        <div>Target: <span style={{ color: 'var(--color-fg)' }}>{gate.outputMapping.targetProperty}</span></div>
                        <div>Output: <span style={{ color: 'var(--color-fg)' }}>{gate.outputMapping.outputMin}..{gate.outputMapping.outputMax}</span></div>
                      </div>
                      {/* Live values */}
                      <div style={{ marginTop: '6px', display: 'flex', gap: '8px' }}>
                        <div>
                          <div style={{ marginBottom: '2px' }}>Primary: {primaryVal.toFixed(2)}</div>
                          <div style={{ height: '3px', width: '60px', background: 'var(--color-border)', borderRadius: '2px' }}>
                            <div style={{ height: '100%', width: `${primaryVal * 100}%`, background: '#3B82F6', borderRadius: '2px' }} />
                          </div>
                        </div>
                        <div>
                          <div style={{ marginBottom: '2px' }}>Gate: {gateVal.toFixed(2)} {gateActive ? '✓' : '✗'}</div>
                          <div style={{ height: '3px', width: '60px', background: 'var(--color-border)', borderRadius: '2px' }}>
                            <div style={{ height: '100%', width: `${gateVal * 100}%`, background: gateActive ? '#10B981' : '#6B7280', borderRadius: '2px' }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ACTIVE TAB */}
        {activeTab === 'active' && (
          <div>
            {Object.values(doc.objects).map((obj) => {
              const signalBehaviors = obj.behaviors.filter((b) => b.signalBinding);
              if (signalBehaviors.length === 0) return null;

              return (
                <div key={obj.id}>
                  <div style={{ padding: '5px 10px', background: 'var(--color-surface)', fontSize: '9px', fontWeight: 600, color: 'var(--color-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {obj.name}
                  </div>
                  {signalBehaviors.map((beh) => {
                    const sig = doc.signals[beh.signalBinding!];
                    // Canonical signals carry name/id (no legacy `kind` channel field) —
                    // derive the channel from the signal name, e.g. "Audio Beat" -> "audio.beat".
                    const sigChannel = sig
                      ? (sig.name || sig.id).toLowerCase().replace(/[\s_]+/g, '-').replace('-', '.')
                      : '';
                    const liveVal = sigChannel ? evaluateSignalChannel(sigChannel, signalCtx) : 0;

                    return (
                      <div key={beh.id} style={{ padding: '6px 10px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '10px', color: 'var(--color-fg)' }}>
                            {sig?.name ?? beh.signalBinding} → {beh.params.property as string}
                          </div>
                          <div style={{ fontSize: '9px', color: 'var(--color-subtle)' }}>
                            {beh.params.min as number} .. {beh.params.max as number}
                          </div>
                        </div>
                        <div style={{ width: '40px', flexShrink: 0 }}>
                          <div style={{ height: '3px', background: 'var(--color-border)', borderRadius: '2px' }}>
                            <div style={{ height: '100%', width: `${liveVal * 100}%`, background: '#22D3EE', borderRadius: '2px' }} />
                          </div>
                          <div style={{ fontSize: '8px', color: 'var(--color-subtle)', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{liveVal.toFixed(2)}</div>
                        </div>
                        <button
                          onClick={() => {
                            const ops = [makeMotionOp('motion.removeBehavior', doc.id, { objectId: obj.id, behaviorId: beh.id })];
                            applyMotionOps(ops, 'Remove signal binding');
                          }}
                          style={{ fontSize: '10px', padding: '1px 5px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: '3px', color: 'var(--color-subtle)', cursor: 'pointer' }}
                          title="Remove binding"
                        >✕</button>
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {Object.values(doc.objects).every((o) => o.behaviors.filter((b) => b.signalBinding).length === 0) && (
              <div style={{ padding: '16px', textAlign: 'center', fontSize: '11px', color: 'var(--color-muted)' }}>
                No active signal bindings. Add from Channels or Gates tab.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Mapping Editor ────────────────────────────────────────────

interface MappingEditorProps {
  mapping: SignalMapping;
  onChange: (m: SignalMapping) => void;
  onApply: (m: SignalMapping) => void;
  onCancel: () => void;
}

function MappingEditor({ mapping, onChange, onApply, onCancel }: MappingEditorProps) {
  const update = (key: keyof SignalMapping, value: unknown) => onChange({ ...mapping, [key]: value });

  const inputStyle: React.CSSProperties = {
    width: '100%', background: 'var(--color-well)', border: '1px solid var(--color-border)',
    borderRadius: '3px', color: 'var(--color-fg)', fontSize: '11px', fontFamily: 'var(--font-mono)',
    padding: '3px 6px', boxSizing: 'border-box',
  };
  const selectStyle: React.CSSProperties = { ...inputStyle, fontFamily: 'var(--font-sans)' };
  const labelStyle: React.CSSProperties = { fontSize: '9px', fontWeight: 600, color: 'var(--color-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '3px', marginTop: '6px' };

  return (
    <div style={{ background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '10px' }}>
      <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-fg)', marginBottom: '8px' }}>Signal Mapping</div>

      <div style={labelStyle}>Source Channel</div>
      <select value={mapping.sourceChannelId} onChange={(e) => update('sourceChannelId', e.target.value)} style={selectStyle}>
        {SIGNAL_CHANNEL_REGISTRY.map((ch) => (
          <option key={ch.id} value={ch.id}>{ch.label} ({ch.category})</option>
        ))}
      </select>

      <div style={labelStyle}>Target Property</div>
      <input value={mapping.targetProperty} onChange={(e) => update('targetProperty', e.target.value)} style={inputStyle} placeholder="e.g. scale.uniform" />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '4px' }}>
        <div>
          <div style={labelStyle}>Input Min</div>
          <input type="number" value={mapping.inputMin} onChange={(e) => update('inputMin', parseFloat(e.target.value))} style={inputStyle} step="0.1" />
        </div>
        <div>
          <div style={labelStyle}>Input Max</div>
          <input type="number" value={mapping.inputMax} onChange={(e) => update('inputMax', parseFloat(e.target.value))} style={inputStyle} step="0.1" />
        </div>
        <div>
          <div style={labelStyle}>Output Min</div>
          <input type="number" value={mapping.outputMin} onChange={(e) => update('outputMin', parseFloat(e.target.value))} style={inputStyle} step="0.1" />
        </div>
        <div>
          <div style={labelStyle}>Output Max</div>
          <input type="number" value={mapping.outputMax} onChange={(e) => update('outputMax', parseFloat(e.target.value))} style={inputStyle} step="0.1" />
        </div>
        <div>
          <div style={labelStyle}>Gain</div>
          <input type="number" value={mapping.gain} onChange={(e) => update('gain', parseFloat(e.target.value))} style={inputStyle} step="0.1" />
        </div>
        <div>
          <div style={labelStyle}>Offset</div>
          <input type="number" value={mapping.offset} onChange={(e) => update('offset', parseFloat(e.target.value))} style={inputStyle} step="0.1" />
        </div>
      </div>

      <div style={labelStyle}>Easing</div>
      <select value={mapping.easing} onChange={(e) => update('easing', e.target.value)} style={selectStyle}>
        {['linear', 'ease-in', 'ease-out', 'ease-in-out', 'exponential', 'logarithmic'].map((e) => (
          <option key={e} value={e}>{e}</option>
        ))}
      </select>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '4px' }}>
        <div>
          <div style={labelStyle}>Smoothing</div>
          <input type="range" min={0} max={1} step={0.05} value={mapping.smoothing} onChange={(e) => update('smoothing', parseFloat(e.target.value))} style={{ width: '100%' }} />
        </div>
        <div>
          <div style={labelStyle}>Threshold</div>
          <input type="range" min={0} max={1} step={0.05} value={mapping.threshold} onChange={(e) => update('threshold', parseFloat(e.target.value))} style={{ width: '100%' }} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '9px', color: 'var(--color-subtle)', cursor: 'pointer' }}>
          <input type="checkbox" checked={mapping.invert} onChange={(e) => update('invert', e.target.checked)} />
          Invert
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '9px', color: 'var(--color-subtle)', cursor: 'pointer' }}>
          <input type="checkbox" checked={mapping.clamp} onChange={(e) => update('clamp', e.target.checked)} />
          Clamp
        </label>
      </div>

      <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
        <button onClick={() => onApply(mapping)} style={{ flex: 1, padding: '5px', background: 'rgba(34,211,238,0.15)', border: '1px solid rgba(34,211,238,0.3)', borderRadius: '3px', color: '#22D3EE', cursor: 'pointer', fontSize: '10px' }}>
          Apply Binding
        </button>
        <button onClick={onCancel} style={{ padding: '5px 10px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px', color: 'var(--color-subtle)', cursor: 'pointer', fontSize: '10px' }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
