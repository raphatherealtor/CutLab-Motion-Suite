'use client';

/**
 * CutLab AI Creative Operator Panel
 *
 * The real AI editing loop UI:
 * - Intent input
 * - Proposal display (interpreted intent, affected objects, proposed ops, warnings)
 * - Preview / Apply / Discard / Refine / Variant actions
 * - Trace inspection
 * - Self-correction feedback
 *
 * All persistent changes go through canonical MotionTransaction → Studio history.
 * Preview uses preview transactions — canonical state is NEVER mutated during exploration.
 */

import React, { useState, useCallback, useRef } from 'react';
import { useEngine } from '@/engine/store';
import { resolveMotionDocument } from '@/engine/motion-bridge';
import {
  parseIntent,
  buildProposal,
  previewProposal,
  selfCorrectProposal,
  storeProposal,
  updateProposal,
  discardProposal,
  MOTION_GRAMMAR,
  type AIProposal,
  type AIEvaluationTrace,
  type AIWorkspaceContext,
  type MotionGrammarCategory,
} from '@/engine/ai-creative-operator';
import { buildAnalysisContract } from '@/engine/analysis-contract';
import { buildMotionAgentContext } from '@/engine/agent-context';
import { generateVariants, type MotionVariant, type VariantConstraint } from '@/engine/motion-package';
import type { WorkspaceHandoff } from '@/engine/workspace-context';

interface AICreativeOperatorPanelProps {
  workspaceKind: 'studio' | 'motion-animator';
  motionHandoff?: WorkspaceHandoff | null;
  onApplyProposal?: (proposal: AIProposal) => void;
}

const GRAMMAR_CATEGORY_COLORS: Record<MotionGrammarCategory, string> = {
  OBJECT: '#3b82ff',
  STRUCTURE: '#06b6d4',
  PROCEDURAL: '#10b981',
  SIGNAL: '#f59e0b',
  CHOREOGRAPHY: '#8b5cf6',
  BEHAVIOR: '#ec4899',
  TRANSFORMATION: '#ef4444',
  FORM: '#a78bfa',
  SPACE: '#14b8a6',
  RELATION: '#f97316',
  CAMERA: '#64748b',
  MEANING: '#22c55e',
  COMPOSITION: '#6366f1',
};

export default function AICreativeOperatorPanel({
  workspaceKind,
  motionHandoff,
  onApplyProposal,
}: AICreativeOperatorPanelProps) {
  const engine = useEngine();
  const { project, session } = engine;

  const [intent, setIntent] = useState('');
  const [activeProposal, setActiveProposal] = useState<AIProposal | null>(null);
  const [traceResult, setTraceResult] = useState<AIEvaluationTrace | null>(null);
  const [activeTab, setActiveTab] = useState<'compose' | 'grammar' | 'variants' | 'trace'>('compose');
  const [variants, setVariants] = useState<MotionVariant[]>([]);
  const [variantConstraint, setVariantConstraint] = useState<VariantConstraint>({
    keep: ['timing', 'text'],
    change: ['energy', 'depth'],
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [refineInput, setRefineInput] = useState('');
  const [showGrammarCategory, setShowGrammarCategory] = useState<MotionGrammarCategory | null>(null);

  const seq = project.sequences[project.activeSequenceId];
  const fps = seq?.format.fps ?? 29.97;
  const playheadSecs = session.playheadFrame / fps;

  // Build workspace context
  const buildContext = useCallback((): AIWorkspaceContext => {
    const contract = buildAnalysisContract(project, seq ?? null, session.playheadFrame);
    const motionContext = buildMotionAgentContext(project, session.playheadFrame, Array.from(session.selectedClipIds));

    if (workspaceKind === 'motion-animator' && motionHandoff) {
      let doc = resolveMotionDocument(project, motionHandoff.motionDocumentId);
      return {
        workspace: 'motion-animator',
        motionDocument: doc!,
        selectedObjectId: motionHandoff.selectedMotionObjectId ?? undefined,
        objectCount: doc ? Object.keys(doc.objects).length : 0,
        textObjectCount: doc ? Object.values(doc.objects).filter((o) => o.kind === 'text').length : 0,
        availableSignals: Object.keys(doc?.signals ?? {}),
        activeBehaviors: doc ? Object.values(doc.objects).flatMap((o) => (o.behaviors ?? []).map((b) => ({ objectId: o.id, behaviorType: b.type }))) : [],
        rendererTier: motionHandoff.rendererTier ?? 'hybrid',
        analysis: contract,
        motionContext,
      };
    }

    const nearbyClips = (seq?.clips ?? [])
      .filter((c) => {
        const start = c.startTime.value / c.startTime.timescale;
        const end = start + c.duration.value / c.duration.timescale;
        return Math.abs(start - playheadSecs) < 5 || (start <= playheadSecs && end >= playheadSecs);
      })
      .slice(0, 8)
      .map((c) => ({ id: c.id, name: c.name, kind: c.kind, startSecs: c.startTime.value / c.startTime.timescale, durationSecs: c.duration.value / c.duration.timescale }));

    return {
      workspace: 'studio',
      nearbyClips,
      transcriptSlice: [],
      speakers: [],
      activeCues: [],
      motionClips: (seq?.clips ?? []).filter((c) => c.kind === 'motion' && c.motionDocumentId).map((c) => ({ id: c.id, name: c.name, motionDocumentId: c.motionDocumentId! })),
      selectedClipId: Array.from(session.selectedClipIds)[0],
      analysis: contract,
    };
  }, [project, seq, session, workspaceKind, motionHandoff, playheadSecs]);

  const handleGenerate = useCallback(async () => {
    if (!intent.trim()) return;
    setIsProcessing(true);

    try {
      const ctx = buildContext();
      const parsed = parseIntent(intent, ctx);

      // Get motion document if available
      let doc = null;
      if (workspaceKind === 'motion-animator' && motionHandoff) {
        doc = resolveMotionDocument(project, motionHandoff.motionDocumentId);
      } else {
        const firstSelectedId = Array.from(session.selectedClipIds)[0];
        const selectedClip = firstSelectedId ? seq?.clips.find((c) => c.id === firstSelectedId) : null;
        if (selectedClip?.motionDocumentId) {
          doc = resolveMotionDocument(project, selectedClip.motionDocumentId);
        }
      }

      const proposal = buildProposal(intent, parsed, ctx, doc);
      storeProposal(proposal);

      // Auto-preview if we have a doc
      if (doc) {
        const contract = buildAnalysisContract(project, seq ?? null, session.playheadFrame);
        const signalValues: Record<string, number> = {
          'audio-rms': contract.audio.rms,
          'audio-beat': contract.audio.beat,
          'audio-onset': contract.audio.onset,
          'speech-active-word': contract.speech.activeWordProgress,
          'speech-emphasis': contract.speech.emphasisScore,
        };
        const localTimeSecs = workspaceKind === 'motion-animator' && motionHandoff
          ? motionHandoff.clipLocalTimeSecs
          : 0;
        const { frameState, trace } = previewProposal(proposal, doc, localTimeSecs, signalValues);
        proposal.previewFrameState = frameState;
        proposal.previewTrace = trace;
        setTraceResult(trace);

        // Self-correct if needed
        if (trace.confidence < 0.7 && proposal.selfCorrectionCount < proposal.maxSelfCorrections) {
          const corrected = selfCorrectProposal(proposal, trace, doc);
          setActiveProposal(corrected);
        } else {
          setActiveProposal(proposal);
        }
      } else {
        setActiveProposal(proposal);
      }
    } finally {
      setIsProcessing(false);
    }
  }, [intent, buildContext, project, seq, session, workspaceKind, motionHandoff]);

  const handleApply = useCallback(() => {
    if (!activeProposal || !onApplyProposal) return;
    onApplyProposal(activeProposal);
    updateProposal(activeProposal.id, { status: 'applied' });
    setActiveProposal({ ...activeProposal, status: 'applied' });
  }, [activeProposal, onApplyProposal]);

  const handleDiscard = useCallback(() => {
    if (!activeProposal) return;
    discardProposal(activeProposal.id);
    setActiveProposal(null);
    setTraceResult(null);
    setIntent('');
  }, [activeProposal]);

  const handleRefine = useCallback(async () => {
    if (!activeProposal || !refineInput.trim()) return;
    const combinedIntent = `${activeProposal.intent} — refine: ${refineInput}`;
    setIntent(combinedIntent);
    setRefineInput('');
    setActiveProposal({ ...activeProposal, status: 'refining' });
    // Re-generate with combined intent
    setTimeout(() => handleGenerate(), 100);
  }, [activeProposal, refineInput, handleGenerate]);

  const handleGenerateVariants = useCallback(() => {
    if (!activeProposal) return;
    let doc = workspaceKind === 'motion-animator' && motionHandoff
      ? resolveMotionDocument(project, motionHandoff.motionDocumentId)
      : null;
    if (!doc) return;
    const newVariants = generateVariants(doc, variantConstraint, 3);
    setVariants(newVariants);
    setActiveTab('variants');
  }, [activeProposal, workspaceKind, motionHandoff, project, variantConstraint]);

  const grammarCategories = Array.from(new Set(MOTION_GRAMMAR.map((t) => t.category)));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--color-surface)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'linear-gradient(135deg, #8b5cf6, #3b82ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px' }}>✦</div>
        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-fg)', letterSpacing: '0.05em' }}>AI CREATIVE OPERATOR</span>
        <div style={{ marginLeft: 'auto', fontSize: '9px', color: 'var(--color-muted)', background: 'rgba(139,92,246,0.1)', padding: '2px 6px', borderRadius: '3px', border: '1px solid rgba(139,92,246,0.2)' }}>
          {workspaceKind === 'motion-animator' ? 'MOTION ANIMATOR' : 'STUDIO'}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        {(['compose', 'grammar', 'variants', 'trace'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1,
              padding: '6px 4px',
              background: activeTab === tab ? 'rgba(139,92,246,0.1)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid #8b5cf6' : '2px solid transparent',
              color: activeTab === tab ? '#8b5cf6' : 'var(--color-muted)',
              fontSize: '9px',
              cursor: 'pointer',
              fontWeight: activeTab === tab ? 600 : 400,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* COMPOSE TAB */}
        {activeTab === 'compose' && (
          <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Intent Input */}
            <div>
              <div style={{ fontSize: '10px', color: 'var(--color-muted)', marginBottom: '6px', letterSpacing: '0.05em' }}>DESCRIBE YOUR INTENT</div>
              <textarea
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate(); }}
                placeholder={workspaceKind === 'motion-animator' ?'e.g. "Make the word different step forward, shift to chrome, push the camera slightly"'
                  : 'e.g. "Add depth to the caption, bind to speech emphasis, protect readability"'}
                style={{
                  width: '100%',
                  minHeight: '72px',
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '6px',
                  color: 'var(--color-fg)',
                  fontSize: '11px',
                  padding: '8px',
                  resize: 'vertical',
                  fontFamily: 'var(--font-sans)',
                  lineHeight: 1.5,
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                <button
                  onClick={handleGenerate}
                  disabled={isProcessing || !intent.trim()}
                  style={{
                    flex: 1,
                    padding: '7px 12px',
                    background: isProcessing ? 'rgba(139,92,246,0.2)' : 'rgba(139,92,246,0.8)',
                    border: '1px solid rgba(139,92,246,0.4)',
                    borderRadius: '5px',
                    color: '#fff',
                    fontSize: '11px',
                    cursor: isProcessing ? 'wait' : 'pointer',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                >
                  {isProcessing ? (
                    <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span> Processing...</>
                  ) : (
                    <><span>✦</span> Generate Proposal</>
                  )}
                </button>
              </div>
            </div>

            {/* Proposal Display */}
            {activeProposal && (
              <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--color-border)', borderRadius: '8px', overflow: 'hidden' }}>
                {/* Proposal Header */}
                <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '10px', color: 'var(--color-muted)', marginBottom: '4px', letterSpacing: '0.05em' }}>INTERPRETED INTENT</div>
                    <div style={{ fontSize: '11px', color: 'var(--color-fg)', lineHeight: 1.4 }}>{activeProposal.interpretedIntent}</div>
                  </div>
                  <div style={{
                    fontSize: '9px',
                    padding: '3px 7px',
                    borderRadius: '3px',
                    background: activeProposal.status === 'applied' ? 'rgba(16,185,129,0.15)' : activeProposal.status === 'discarded' ? 'rgba(239,68,68,0.15)' : 'rgba(139,92,246,0.15)',
                    color: activeProposal.status === 'applied' ? '#10b981' : activeProposal.status === 'discarded' ? '#ef4444' : '#8b5cf6',
                    border: `1px solid ${activeProposal.status === 'applied' ? 'rgba(16,185,129,0.3)' : activeProposal.status === 'discarded' ? 'rgba(239,68,68,0.3)' : 'rgba(139,92,246,0.3)'}`,
                    flexShrink: 0,
                  }}>
                    {activeProposal.status.toUpperCase()}
                  </div>
                </div>

                {/* Proposed Ops */}
                {activeProposal.proposedOps.length > 0 && (
                  <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>
                    <div style={{ fontSize: '10px', color: 'var(--color-muted)', marginBottom: '6px', letterSpacing: '0.05em' }}>PROPOSED OPERATIONS</div>
                    {activeProposal.proposedOps.map((op, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', marginBottom: '4px' }}>
                        <span style={{ fontSize: '9px', color: '#8b5cf6', marginTop: '1px', flexShrink: 0 }}>→</span>
                        <div>
                          <div style={{ fontSize: '11px', color: 'var(--color-fg)' }}>{op.description}</div>
                          <div style={{ fontSize: '9px', color: 'var(--color-muted)' }}>{op.opType} · {op.paramSummary}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Affected Objects */}
                {activeProposal.affectedObjectIds.length > 0 && (
                  <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>
                    <div style={{ fontSize: '10px', color: 'var(--color-muted)', marginBottom: '4px', letterSpacing: '0.05em' }}>AFFECTED OBJECTS</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {activeProposal.affectedObjectIds.map((id) => (
                        <span key={id} style={{ fontSize: '9px', padding: '2px 6px', background: 'rgba(59,130,255,0.1)', border: '1px solid rgba(59,130,255,0.2)', borderRadius: '3px', color: '#3b82ff' }}>
                          {id.slice(0, 8)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Signals Involved */}
                {activeProposal.signalsInvolved.length > 0 && (
                  <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>
                    <div style={{ fontSize: '10px', color: 'var(--color-muted)', marginBottom: '4px', letterSpacing: '0.05em' }}>SIGNALS INVOLVED</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {activeProposal.signalsInvolved.map((s) => (
                        <span key={s} style={{ fontSize: '9px', padding: '2px 6px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '3px', color: '#f59e0b' }}>
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Warnings */}
                {activeProposal.warnings.length > 0 && (
                  <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>
                    {activeProposal.warnings.map((w, i) => (
                      <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '4px', padding: '6px 8px', background: 'rgba(245,158,11,0.08)', borderRadius: '4px', border: '1px solid rgba(245,158,11,0.15)' }}>
                        <span style={{ fontSize: '10px', color: '#f59e0b', flexShrink: 0 }}>⚠</span>
                        <span style={{ fontSize: '10px', color: 'rgba(245,158,11,0.9)' }}>{w.message}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Trace confidence */}
                {traceResult && (
                  <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ fontSize: '10px', color: 'var(--color-muted)' }}>CONFIDENCE</div>
                      <div style={{ flex: 1, height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ width: `${traceResult.confidence * 100}%`, height: '100%', background: traceResult.confidence > 0.7 ? '#10b981' : traceResult.confidence > 0.4 ? '#f59e0b' : '#ef4444', borderRadius: '2px' }} />
                      </div>
                      <div style={{ fontSize: '10px', color: traceResult.confidence > 0.7 ? '#10b981' : traceResult.confidence > 0.4 ? '#f59e0b' : '#ef4444', minWidth: '32px', textAlign: 'right' }}>
                        {Math.round(traceResult.confidence * 100)}%
                      </div>
                    </div>
                    {activeProposal.selfCorrectionCount > 0 && (
                      <div style={{ fontSize: '9px', color: 'var(--color-muted)', marginTop: '4px' }}>
                        Self-corrected {activeProposal.selfCorrectionCount}× / {activeProposal.maxSelfCorrections} max
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                {activeProposal.status !== 'applied' && activeProposal.status !== 'discarded' && (
                  <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={handleApply}
                        style={{ flex: 1, padding: '7px', background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '5px', color: '#10b981', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
                      >
                        ✓ APPLY
                      </button>
                      <button
                        onClick={handleDiscard}
                        style={{ flex: 1, padding: '7px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '5px', color: '#ef4444', fontSize: '11px', cursor: 'pointer' }}
                      >
                        ✕ DISCARD
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={() => setActiveTab('trace')}
                        style={{ flex: 1, padding: '6px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-border)', borderRadius: '5px', color: 'var(--color-muted)', fontSize: '10px', cursor: 'pointer' }}
                      >
                        INSPECT TRACE
                      </button>
                      <button
                        onClick={handleGenerateVariants}
                        style={{ flex: 1, padding: '6px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-border)', borderRadius: '5px', color: 'var(--color-muted)', fontSize: '10px', cursor: 'pointer' }}
                      >
                        VARIANTS
                      </button>
                    </div>
                    {/* Refine */}
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <input
                        value={refineInput}
                        onChange={(e) => setRefineInput(e.target.value)}
                        placeholder="Refine: e.g. less camera, more depth..."
                        style={{ flex: 1, background: 'rgba(0,0,0,0.3)', border: '1px solid var(--color-border)', borderRadius: '5px', color: 'var(--color-fg)', fontSize: '10px', padding: '6px 8px' }}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleRefine(); }}
                      />
                      <button
                        onClick={handleRefine}
                        disabled={!refineInput.trim()}
                        style={{ padding: '6px 10px', background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '5px', color: '#8b5cf6', fontSize: '10px', cursor: 'pointer' }}
                      >
                        REFINE
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Quick intent suggestions */}
            {!activeProposal && (
              <div>
                <div style={{ fontSize: '10px', color: 'var(--color-muted)', marginBottom: '6px', letterSpacing: '0.05em' }}>QUICK INTENTS</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {(workspaceKind === 'motion-animator' ? [
                    'Step the selected word forward in depth',
                    'Apply chrome material to the text',
                    'Bind audio beat to scale',
                    'Add a camera push on emphasis',
                    'Make the text settle during pause',
                  ] : [
                    'Add depth to the active caption',
                    'Bind speech emphasis to scale',
                    'Apply projector typography treatment',
                    'Add beat-reactive glow to the title',
                    'Make captions step forward when spoken',
                  ]).map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => setIntent(suggestion)}
                      style={{ padding: '6px 8px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'var(--color-muted)', fontSize: '10px', cursor: 'pointer', textAlign: 'left' }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* GRAMMAR TAB */}
        {activeTab === 'grammar' && (
          <div style={{ padding: '12px' }}>
            <div style={{ fontSize: '10px', color: 'var(--color-muted)', marginBottom: '10px', lineHeight: 1.5 }}>
              The full Motion grammar vocabulary. AI composes canonical primitives from these terms.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '12px' }}>
              {grammarCategories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setShowGrammarCategory(showGrammarCategory === cat ? null : cat)}
                  style={{
                    padding: '3px 8px',
                    background: showGrammarCategory === cat ? `${GRAMMAR_CATEGORY_COLORS[cat]}20` : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${showGrammarCategory === cat ? GRAMMAR_CATEGORY_COLORS[cat] + '60' : 'var(--color-border)'}`,
                    borderRadius: '3px',
                    color: showGrammarCategory === cat ? GRAMMAR_CATEGORY_COLORS[cat] : 'var(--color-muted)',
                    fontSize: '9px',
                    cursor: 'pointer',
                    fontWeight: showGrammarCategory === cat ? 600 : 400,
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
            {MOTION_GRAMMAR.filter((t) => !showGrammarCategory || t.category === showGrammarCategory).map((term) => (
              <div
                key={term.term}
                style={{ marginBottom: '6px', padding: '7px 10px', background: 'rgba(0,0,0,0.2)', borderRadius: '5px', border: '1px solid var(--color-border)', cursor: 'pointer' }}
                onClick={() => setIntent((prev) => prev ? `${prev} ${term.term}` : term.term)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                  <span style={{ fontSize: '9px', padding: '1px 5px', borderRadius: '2px', background: `${GRAMMAR_CATEGORY_COLORS[term.category]}20`, color: GRAMMAR_CATEGORY_COLORS[term.category], border: `1px solid ${GRAMMAR_CATEGORY_COLORS[term.category]}40` }}>
                    {term.category}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--color-fg)', fontWeight: 500 }}>{term.term}</span>
                </div>
                <div style={{ fontSize: '10px', color: 'var(--color-muted)' }}>{term.description}</div>
                <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.2)', marginTop: '2px' }}>→ {term.compilesTo.join(', ')}</div>
              </div>
            ))}
          </div>
        )}

        {/* VARIANTS TAB */}
        {activeTab === 'variants' && (
          <div style={{ padding: '12px' }}>
            <div style={{ fontSize: '10px', color: 'var(--color-muted)', marginBottom: '10px' }}>
              Generate deterministic creative variants. Variants are canonical diffs, not duplicate projects.
            </div>

            {/* Constraint builder */}
            <div style={{ marginBottom: '12px', padding: '10px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: '10px', color: 'var(--color-muted)', marginBottom: '8px', letterSpacing: '0.05em' }}>KEEP</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '10px' }}>
                {(['timing', 'text', 'layout', 'material', 'motion', 'camera'] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setVariantConstraint((prev) => ({
                      ...prev,
                      keep: prev.keep.includes(k) ? prev.keep.filter((x) => x !== k) : [...prev.keep, k],
                    }))}
                    style={{
                      padding: '3px 8px',
                      background: variantConstraint.keep.includes(k) ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${variantConstraint.keep.includes(k) ? 'rgba(16,185,129,0.3)' : 'var(--color-border)'}`,
                      borderRadius: '3px',
                      color: variantConstraint.keep.includes(k) ? '#10b981' : 'var(--color-muted)',
                      fontSize: '9px',
                      cursor: 'pointer',
                    }}
                  >
                    {k}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--color-muted)', marginBottom: '8px', letterSpacing: '0.05em' }}>CHANGE</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {(['energy', 'depth', 'material', 'choreography', 'camera', 'spatial'] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setVariantConstraint((prev) => ({
                      ...prev,
                      change: prev.change.includes(k) ? prev.change.filter((x) => x !== k) : [...prev.change, k],
                    }))}
                    style={{
                      padding: '3px 8px',
                      background: variantConstraint.change.includes(k) ? 'rgba(139,92,246,0.15)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${variantConstraint.change.includes(k) ? 'rgba(139,92,246,0.3)' : 'var(--color-border)'}`,
                      borderRadius: '3px',
                      color: variantConstraint.change.includes(k) ? '#8b5cf6' : 'var(--color-muted)',
                      fontSize: '9px',
                      cursor: 'pointer',
                    }}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleGenerateVariants}
              disabled={!activeProposal}
              style={{ width: '100%', padding: '8px', background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '5px', color: '#8b5cf6', fontSize: '11px', cursor: 'pointer', marginBottom: '12px' }}
            >
              Generate 3 Variants
            </button>

            {variants.map((variant, i) => (
              <div key={variant.id} style={{ marginBottom: '8px', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                <div style={{ height: '40px', background: variant.previewGradient, display: 'flex', alignItems: 'center', padding: '0 10px', gap: '8px' }}>
                  <span style={{ fontSize: '11px', color: '#fff', fontWeight: 600 }}>{variant.label}</span>
                  <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)' }}>{variant.description}</span>
                </div>
                <div style={{ padding: '8px 10px', background: 'rgba(0,0,0,0.2)', display: 'flex', gap: '6px' }}>
                  <button
                    onClick={() => {
                      if (onApplyProposal && activeProposal) {
                        onApplyProposal({ ...activeProposal, canonicalOps: variant.diffOps, id: variant.id });
                      }
                    }}
                    style={{ flex: 1, padding: '5px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '4px', color: '#10b981', fontSize: '10px', cursor: 'pointer' }}
                  >
                    APPLY
                  </button>
                  <button
                    style={{ flex: 1, padding: '5px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'var(--color-muted)', fontSize: '10px', cursor: 'pointer' }}
                  >
                    PREVIEW
                  </button>
                </div>
              </div>
            ))}

            {variants.length === 0 && (
              <div style={{ textAlign: 'center', padding: '20px', fontSize: '11px', color: 'var(--color-muted)' }}>
                Generate a proposal first, then create variants
              </div>
            )}
          </div>
        )}

        {/* TRACE TAB */}
        {activeTab === 'trace' && (
          <div style={{ padding: '12px' }}>
            {traceResult ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '10px', color: 'var(--color-muted)', marginBottom: '4px', letterSpacing: '0.05em' }}>EVALUATION TRACE</div>

                {/* Status indicators */}
                {[
                  { label: 'Target Moved', value: traceResult.targetMoved, good: true },
                  { label: 'Signals Available', value: traceResult.signalsAvailable, good: true },
                  { label: 'Renderer Supported', value: traceResult.rendererSupported, good: true },
                  { label: 'Camera Overwhelmed', value: traceResult.cameraOverwhelmed, good: false },
                  { label: 'Subject Matte Available', value: traceResult.subjectMatteAvailable, good: true },
                  { label: 'Macro Guard Active', value: traceResult.macroGuardActive, good: false },
                ].map(({ label, value, good }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', background: 'rgba(0,0,0,0.2)', borderRadius: '4px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: (value === good) ? '#10b981' : '#ef4444', flexShrink: 0 }} />
                    <span style={{ fontSize: '11px', color: 'var(--color-fg)', flex: 1 }}>{label}</span>
                    <span style={{ fontSize: '10px', color: (value === good) ? '#10b981' : '#ef4444' }}>{value ? 'YES' : 'NO'}</span>
                  </div>
                ))}

                {/* Corrections */}
                {traceResult.corrections.length > 0 && (
                  <div style={{ marginTop: '8px' }}>
                    <div style={{ fontSize: '10px', color: 'var(--color-muted)', marginBottom: '6px', letterSpacing: '0.05em' }}>SELF-CORRECTION SUGGESTIONS</div>
                    {traceResult.corrections.map((c, i) => (
                      <div key={i} style={{ padding: '8px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)', borderRadius: '5px', marginBottom: '6px' }}>
                        <div style={{ fontSize: '10px', color: '#f59e0b', marginBottom: '3px' }}>Issue: {c.issue}</div>
                        <div style={{ fontSize: '10px', color: 'var(--color-muted)' }}>→ {c.suggestion}</div>
                        {c.autoApplicable && (
                          <div style={{ fontSize: '9px', color: 'rgba(16,185,129,0.7)', marginTop: '3px' }}>Auto-applicable</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Confidence */}
                <div style={{ padding: '10px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--color-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '10px', color: 'var(--color-muted)' }}>OVERALL CONFIDENCE</span>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: traceResult.confidence > 0.7 ? '#10b981' : traceResult.confidence > 0.4 ? '#f59e0b' : '#ef4444' }}>
                      {Math.round(traceResult.confidence * 100)}%
                    </span>
                  </div>
                  <div style={{ height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ width: `${traceResult.confidence * 100}%`, height: '100%', background: traceResult.confidence > 0.7 ? '#10b981' : traceResult.confidence > 0.4 ? '#f59e0b' : '#ef4444', borderRadius: '3px', transition: 'width 0.3s ease' }} />
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '30px', fontSize: '11px', color: 'var(--color-muted)' }}>
                Generate a proposal to see the evaluation trace
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
