'use client';

/**
 * EvaluationTracePanel — "Why is this moving?" inspector.
 * Shows contribution trace for selected Motion object.
 * TIME / VALUE / SPACE / CONTRIBUTORS breakdown.
 * Compact, inspectable, navigable.
 */

import React, { useState, useMemo } from 'react';
import { useEngine } from '@/engine/store';
import { resolveClipMotionDocument } from '@/engine/motion-bridge';
import { buildEvaluationTrace, getWhyIsThisMoving, type EvaluationTrace, type Contribution } from '@/engine/evaluation-trace';
import { motionTimeToSeconds } from '@/motion/types';

const CONTRIBUTION_KIND_COLORS: Record<string, string> = {
  choreography: '#3B82F6',
  keyframe: '#10B981',
  behavior: '#8B5CF6',
  'signal-binding': '#F59E0B',
  'semantic-trigger': '#EC4899',
  'macro-derived': '#F97316',
  'camera-relationship': '#06B6D4',
  'subject-relation': '#34D399',
  'readability-guard': '#6B7280',
  rig: '#A78BFA',
  'scene-script': '#EF4444',
};

const CONTRIBUTION_KIND_ICONS: Record<string, string> = {
  choreography: '🎬',
  keyframe: '◆',
  behavior: '⚙',
  'signal-binding': '〜',
  'semantic-trigger': '🎙',
  'macro-derived': '⚡',
  'camera-relationship': '📷',
  'subject-relation': '👤',
  'readability-guard': '📖',
  rig: '🔗',
  'scene-script': '§',
};

interface EvaluationTracePanelProps {
  clipId: string;
  objectId?: string;
}

export default function EvaluationTracePanel({ clipId, objectId }: EvaluationTracePanelProps) {
  const engine = useEngine();
  const { project, activeSequence, session } = engine;
  const fps = activeSequence?.format.fps ?? 29.97;
  const currentTimeSecs = session.playheadFrame / fps;

  const clip = activeSequence?.clips.find((c) => c.id === clipId) ?? null;
  const doc = clip && project ? resolveClipMotionDocument(project, clip) : null;

  const [activeTab, setActiveTab] = useState<'why' | 'time' | 'value' | 'space'>('why');
  const [selectedProp, setSelectedProp] = useState<string>('position.x');

  const targetObj = useMemo(() => {
    if (!doc) return null;
    if (objectId && doc.objects[objectId]) return doc.objects[objectId];
    const firstId = doc.rootObjectIds[0];
    return firstId ? doc.objects[firstId] : null;
  }, [doc, objectId]);

  const trace = useMemo(() => {
    if (!targetObj || !doc) return null;
    const clipDurSecs = motionTimeToSeconds(doc.duration);
    return buildEvaluationTrace(targetObj, currentTimeSecs, clipDurSecs);
  }, [targetObj, currentTimeSecs, doc]);

  const whyReasons = useMemo(() => {
    if (!trace) return [];
    return getWhyIsThisMoving(trace);
  }, [trace]);

  const tabStyle = (active: boolean) => ({
    flex: 1, padding: '4px 6px', background: active ? 'rgba(34,211,238,0.12)' : 'transparent',
    border: 'none', borderBottom: `2px solid ${active ? '#22D3EE' : 'transparent'}`,
    color: active ? '#22D3EE' : 'var(--color-subtle)', cursor: 'pointer', fontSize: '10px',
    fontFamily: 'var(--font-sans)', fontWeight: active ? 600 : 400,
  });

  if (!doc || !trace) {
    return (
      <div style={{ padding: '16px', textAlign: 'center', fontSize: '11px', color: 'var(--color-muted)' }}>
        Select a Motion clip to inspect evaluation
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Object header */}
      <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-fg)' }}>
          {trace.objectName} <span style={{ color: 'var(--color-subtle)', fontWeight: 400 }}>({trace.objectKind})</span>
        </div>
        <div style={{ fontSize: '9px', color: 'var(--color-subtle)', fontFamily: 'var(--font-mono)' }}>
          t={currentTimeSecs.toFixed(3)}s · {trace.allContributions.length} contributor(s)
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        <button style={tabStyle(activeTab === 'why')} onClick={() => setActiveTab('why')}>Why?</button>
        <button style={tabStyle(activeTab === 'time')} onClick={() => setActiveTab('time')}>Time</button>
        <button style={tabStyle(activeTab === 'value')} onClick={() => setActiveTab('value')}>Value</button>
        <button style={tabStyle(activeTab === 'space')} onClick={() => setActiveTab('space')}>Space</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>

        {/* WHY IS THIS MOVING? */}
        {activeTab === 'why' && (
          <div style={{ padding: '10px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-fg)', marginBottom: '8px' }}>
              Why is this moving?
            </div>

            {whyReasons.length === 0 ? (
              <div style={{ fontSize: '10px', color: 'var(--color-muted)', padding: '8px', background: 'var(--color-well)', borderRadius: '4px' }}>
                No active contributors — object is at rest at this time.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {whyReasons.map((reason, i) => (
                  <div key={i} style={{ padding: '6px 8px', background: 'var(--color-well)', borderRadius: '4px', fontSize: '10px', color: 'var(--color-fg)', borderLeft: '3px solid #22D3EE' }}>
                    {reason}
                  </div>
                ))}
              </div>
            )}

            {/* Top contributors */}
            {trace.topContributors.length > 0 && (
              <div style={{ marginTop: '12px' }}>
                <div style={{ fontSize: '9px', fontWeight: 600, color: 'var(--color-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
                  Top Contributors
                </div>
                {trace.topContributors.map((contrib, i) => (
                  <ContributionRow key={i} contribution={contrib} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* TIME TRACE */}
        {activeTab === 'time' && (
          <div style={{ padding: '10px' }}>
            <div style={{ fontSize: '9px', fontWeight: 600, color: 'var(--color-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
              Time Trace
            </div>

            <TraceRow label="Sequence Time" value={`${trace.timeTrace.sequenceTimeSecs.toFixed(3)}s`} />
            <TraceRow label="Clip-Local Time" value={`${trace.timeTrace.clipLocalTimeSecs.toFixed(3)}s`} />
            <TraceRow label="Clip Progress" value={`${(trace.timeTrace.clipProgress * 100).toFixed(1)}%`} />

            {trace.timeTrace.activeBehaviorLabels.length > 0 && (
              <div style={{ marginTop: '8px' }}>
                <div style={{ fontSize: '9px', color: 'var(--color-subtle)', marginBottom: '4px' }}>Active Behaviors</div>
                {trace.timeTrace.activeBehaviorLabels.map((label, i) => (
                  <div key={i} style={{ padding: '3px 6px', background: 'rgba(139,92,246,0.1)', borderRadius: '3px', fontSize: '10px', color: '#A78BFA', marginBottom: '2px' }}>
                    ⚙ {label}
                  </div>
                ))}
              </div>
            )}

            {/* Progress bar */}
            <div style={{ marginTop: '10px' }}>
              <div style={{ fontSize: '9px', color: 'var(--color-subtle)', marginBottom: '4px' }}>Clip Progress</div>
              <div style={{ height: '6px', background: 'var(--color-border)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${trace.timeTrace.clipProgress * 100}%`, background: 'linear-gradient(90deg, #3B82F6, #8B5CF6)', borderRadius: '3px' }} />
              </div>
            </div>
          </div>
        )}

        {/* VALUE TRACE */}
        {activeTab === 'value' && (
          <div style={{ padding: '10px' }}>
            <div style={{ fontSize: '9px', fontWeight: 600, color: 'var(--color-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
              Value Trace
            </div>

            {/* Property selector */}
            <select
              value={selectedProp}
              onChange={(e) => setSelectedProp(e.target.value)}
              style={{ width: '100%', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px', color: 'var(--color-fg)', fontSize: '11px', padding: '3px 6px', marginBottom: '8px' }}
            >
              {trace.valueTraces.map((vt) => (
                <option key={vt.property} value={vt.property}>{vt.property}</option>
              ))}
            </select>

            {trace.valueTraces.filter((vt) => vt.property === selectedProp).map((vt) => (
              <div key={vt.property}>
                <TraceRow label="Base Value" value={vt.baseValue.toFixed(4)} />
                {vt.keyframeValue !== undefined && <TraceRow label="Keyframe" value={vt.keyframeValue.toFixed(4)} highlight />}
                {vt.signalModulation !== undefined && <TraceRow label="Signal Mod" value={vt.signalModulation.toFixed(4)} highlight />}
                {vt.behaviorContribution !== undefined && <TraceRow label="Behavior" value={vt.behaviorContribution.toFixed(4)} highlight />}
                {vt.readabilityGuardApplied && <TraceRow label="Readability Guard" value="applied" />}
                <div style={{ height: '1px', background: 'var(--color-border)', margin: '6px 0' }} />
                <TraceRow label="Final Value" value={vt.finalValue.toFixed(4)} bold />

                {vt.contributions.length > 0 && (
                  <div style={{ marginTop: '8px' }}>
                    <div style={{ fontSize: '9px', color: 'var(--color-subtle)', marginBottom: '4px' }}>Contributors</div>
                    {vt.contributions.map((c, i) => (
                      <ContributionRow key={i} contribution={c} compact />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* SPACE TRACE */}
        {activeTab === 'space' && (
          <div style={{ padding: '10px' }}>
            <div style={{ fontSize: '9px', fontWeight: 600, color: 'var(--color-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
              Space Trace
            </div>

            <div style={{ fontSize: '9px', color: 'var(--color-subtle)', marginBottom: '4px' }}>Local Transform</div>
            <TraceRow label="X" value={trace.spaceTrace.localTransform.x.toFixed(2)} />
            <TraceRow label="Y" value={trace.spaceTrace.localTransform.y.toFixed(2)} />
            <TraceRow label="Z" value={trace.spaceTrace.localTransform.z.toFixed(2)} />
            <TraceRow label="Scale X" value={trace.spaceTrace.localTransform.scaleX.toFixed(3)} />
            <TraceRow label="Scale Y" value={trace.spaceTrace.localTransform.scaleY.toFixed(3)} />
            <TraceRow label="Rotation" value={`${trace.spaceTrace.localTransform.rotation.toFixed(2)}°`} />

            <div style={{ height: '1px', background: 'var(--color-border)', margin: '8px 0' }} />
            <div style={{ fontSize: '9px', color: 'var(--color-subtle)', marginBottom: '4px' }}>Depth</div>
            <TraceRow label="Depth Displacement" value={`${trace.spaceTrace.depthDisplacement.toFixed(1)}px`} />

            <div style={{ height: '1px', background: 'var(--color-border)', margin: '8px 0' }} />
            <div style={{ fontSize: '9px', color: 'var(--color-subtle)', marginBottom: '4px' }}>World Position</div>
            <TraceRow label="World X" value={trace.spaceTrace.worldPosition.x.toFixed(2)} bold />
            <TraceRow label="World Y" value={trace.spaceTrace.worldPosition.y.toFixed(2)} bold />
            <TraceRow label="World Z" value={trace.spaceTrace.worldPosition.z.toFixed(2)} bold />

            {trace.spaceTrace.subjectRelation && (
              <>
                <div style={{ height: '1px', background: 'var(--color-border)', margin: '8px 0' }} />
                <div style={{ fontSize: '9px', color: 'var(--color-subtle)', marginBottom: '4px' }}>Subject Relation</div>
                <TraceRow label="Role" value={trace.spaceTrace.subjectRelation.role} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────

function TraceRow({ label, value, highlight, bold }: { label: string; value: string; highlight?: boolean; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: '10px' }}>
      <span style={{ color: 'var(--color-subtle)' }}>{label}</span>
      <span style={{ color: highlight ? '#22D3EE' : 'var(--color-fg)', fontFamily: 'var(--font-mono)', fontWeight: bold ? 600 : 400 }}>{value}</span>
    </div>
  );
}

function ContributionRow({ contribution, compact }: { contribution: Contribution; compact?: boolean }) {
  const color = CONTRIBUTION_KIND_COLORS[contribution.kind] ?? '#6B7280';
  const icon = CONTRIBUTION_KIND_ICONS[contribution.kind] ?? '•';

  return (
    <div style={{
      padding: compact ? '3px 6px' : '5px 8px',
      background: `${color}11`,
      borderRadius: '3px',
      marginBottom: '3px',
      borderLeft: `2px solid ${color}`,
      opacity: contribution.active ? 1 : 0.5,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
        <span style={{ fontSize: '10px', flexShrink: 0 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '10px', color: 'var(--color-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {contribution.label}
          </div>
          {!compact && contribution.context && (
            <div style={{ fontSize: '9px', color: 'var(--color-subtle)' }}>{contribution.context}</div>
          )}
        </div>
        {/* Influence bar */}
        <div style={{ width: '30px', flexShrink: 0 }}>
          <div style={{ height: '3px', background: 'var(--color-border)', borderRadius: '2px' }}>
            <div style={{ height: '100%', width: `${contribution.influence * 100}%`, background: color, borderRadius: '2px' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
