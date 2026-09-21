'use client';

/**
 * Motion Animator Workspace
 * Opens a MotionDocument stored inside the canonical Studio project.
 * Edits commit through MotionTransaction → Studio canonical ops → dispatchBatch → one history entry.
 * Studio sequence time is authoritative. Motion receives clip-local time.
 * NO separate project, NO separate timeline, NO separate history.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useEngine } from '@/engine/store';
import { makeOp } from '@/engine/operations';
import { generateId } from '@/engine/schema';
import { fromSeconds, toSeconds } from '@/engine/time';
import type { MotionDocument, MotionObject, MotionTransaction } from '@/engine/motion-document';
import { evaluateMotionTransform, DEFAULT_MOTION_TRANSFORM } from '@/engine/motion-document';
import { buildRenderPlan } from '@/engine/render-plan';
import { renderFrame } from '@/engine/compositor';

interface MotionAnimatorProps {
  documentId: string;
  clipId: string;
  onClose: () => void;
}

// ── Object type icons ─────────────────────────────────────────

const KIND_ICON: Record<string, string> = {
  text: 'T',
  'text-segment': 'Ts',
  shape: '◼',
  svg: '⬡',
  group: '⊞',
  image: '▣',
  video: '▶',
  camera: '📷',
  'null-object': '◎',
};

// ── Motion Animator component ─────────────────────────────────

export default function MotionAnimator({ documentId, clipId, onClose }: MotionAnimatorProps) {
  const engine = useEngine();
  const { project, session, dispatchBatch, updateSession } = engine;

  const doc = project.motionDocuments?.[documentId];
  const clip = project.sequences[project.activeSequenceId]?.clips.find((c) => c.id === clipId);
  const fps = project.sequences[project.activeSequenceId]?.format.fps ?? 29.97;

  // Motion-local playhead (derived from Studio sequence time)
  const clipStartSecs = clip ? toSeconds(clip.startTime) : 0;
  const clipDurSecs = clip ? toSeconds(clip.duration) : 10;
  const seqTimeSecs = session.playheadFrame / fps;
  const localTimeSecs = Math.max(0, Math.min(clipDurSecs, seqTimeSecs - clipStartSecs));
  const localProgress = clipDurSecs > 0 ? localTimeSecs / clipDurSecs : 0;

  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<'hierarchy' | 'graph' | 'materials'>('hierarchy');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // ── Canvas preview ──────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !doc) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = doc.width;
    canvas.height = doc.height;

    // Build a render plan at current local time and render
    const plan = buildRenderPlan(project, session.playheadFrame);
    if (plan) {
      renderFrame(ctx, plan, project, { playing: false });
    } else {
      ctx.fillStyle = doc.backgroundColor ?? '#000';
      ctx.fillRect(0, 0, doc.width, doc.height);
    }
  }, [doc, project, session.playheadFrame]);

  // ── Commit a MotionTransaction through canonical ops ────────

  const commitTransaction = useCallback((tx: MotionTransaction) => {
    const ops = [
      makeOp(
        'motion.document.patch' as any,
        { documentId, transaction: tx },
        'user'
      ),
    ];
    dispatchBatch(ops, tx.description);
  }, [documentId, dispatchBatch]);

  // ── Add object ──────────────────────────────────────────────

  const handleAddObject = useCallback((kind: MotionObject['kind']) => {
    if (!doc) return;
    const id = generateId('mobj');
    const obj: MotionObject = {
      id,
      kind,
      name: `${kind} ${Object.keys(doc.objects).length + 1}`,
      depth: Object.keys(doc.objects).length,
      transform: { ...DEFAULT_MOTION_TRANSFORM },
      keyframes: [],
      masks: [],
      blendMode: 'normal',
      visible: true,
      solo: false,
      locked: false,
      text: kind === 'text' ? 'New Text' : undefined,
      fontSize: kind === 'text' ? 48 : undefined,
      shapeType: kind === 'shape' ? 'rectangle' : undefined,
    };

    const tx: MotionTransaction = {
      ops: [{ type: 'motion.object.add', documentId, payload: { object: obj } }],
      description: `Add ${kind} object`,
    };
    commitTransaction(tx);
    setSelectedObjectId(id);
  }, [doc, documentId, commitTransaction]);

  // ── Update object property ──────────────────────────────────

  const handleSetObjectProp = useCallback((objectId: string, props: Partial<MotionObject>) => {
    const tx: MotionTransaction = {
      ops: [{ type: 'motion.object.setProps', documentId, payload: { objectId, props } }],
      description: 'Edit object',
    };
    commitTransaction(tx);
  }, [documentId, commitTransaction]);

  // ── Add keyframe ────────────────────────────────────────────

  const handleAddKeyframe = useCallback((objectId: string, property: string, value: number) => {
    const kf = {
      id: generateId('mkf'),
      time: fromSeconds(localTimeSecs, 30000),
      property,
      value,
      easing: 'ease-in-out' as const,
    };
    const tx: MotionTransaction = {
      ops: [{ type: 'motion.keyframe.upsert', documentId, payload: { objectId, keyframe: kf } }],
      description: `Keyframe ${property}`,
    };
    commitTransaction(tx);
  }, [documentId, localTimeSecs, commitTransaction]);

  // ── Remove object ───────────────────────────────────────────

  const handleRemoveObject = useCallback((objectId: string) => {
    const tx: MotionTransaction = {
      ops: [{ type: 'motion.object.remove', documentId, payload: { objectId } }],
      description: 'Remove object',
    };
    commitTransaction(tx);
    if (selectedObjectId === objectId) setSelectedObjectId(null);
  }, [documentId, commitTransaction, selectedObjectId]);

  if (!doc) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(7,10,16,0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
        <div style={{ color: 'var(--color-danger)', fontSize: '14px' }}>MotionDocument not found: {documentId}</div>
        <button onClick={onClose} style={{ marginLeft: '16px', background: 'var(--color-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-fg)', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' }}>Close</button>
      </div>
    );
  }

  const selectedObj = selectedObjectId ? doc.objects[selectedObjectId] : null;
  const rootObjects = doc.rootObjectIds.map((id) => doc.objects[id]).filter(Boolean);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#070A10', display: 'flex', flexDirection: 'column', zIndex: 200, fontFamily: 'var(--font-sans)' }}>
      {/* Top bar */}
      <div style={{ height: '40px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', padding: '0 12px', gap: '10px', flexShrink: 0, background: 'var(--color-surface)' }}>
        <button onClick={onClose} style={{ background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.3)', color: 'var(--color-danger)', borderRadius: '4px', padding: '3px 10px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }} aria-label="Return to Studio">
          ← Studio
        </button>
        <div style={{ width: '1px', height: '16px', background: 'var(--color-border)' }} />
        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-fg)' }}>Motion Animator</span>
        <span style={{ fontSize: '11px', color: 'var(--color-subtle)' }}>— {doc.name}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--color-muted)' }}>
          LOCAL {localTimeSecs.toFixed(3)}s / {clipDurSecs.toFixed(3)}s
        </span>
        <span style={{ fontSize: '10px', color: 'var(--color-subtle)' }}>
          SEQ {(seqTimeSecs).toFixed(3)}s
        </span>
        <div style={{ width: '1px', height: '16px', background: 'var(--color-border)' }} />
        <span style={{ fontSize: '9px', color: 'rgba(52,211,153,0.7)', background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)', padding: '2px 6px', borderRadius: '3px' }}>
          CANONICAL — edits go to Studio undo stack
        </span>
      </div>

      {/* Main layout */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Left: Hierarchy + panels */}
        <div style={{ width: '220px', borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          {/* Panel tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
            {(['hierarchy', 'graph', 'materials'] as const).map((p) => (
              <button key={p} onClick={() => setActivePanel(p)}
                style={{ flex: 1, padding: '6px 4px', fontSize: '9px', fontWeight: 600, background: activePanel === p ? 'rgba(139,92,246,0.12)' : 'transparent', border: 'none', borderBottom: activePanel === p ? '2px solid var(--color-accent-2)' : '2px solid transparent', color: activePanel === p ? 'var(--color-accent-2)' : 'var(--color-subtle)', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {p}
              </button>
            ))}
          </div>

          {/* Add object toolbar */}
          <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: '3px', flexWrap: 'wrap', flexShrink: 0 }}>
            {(['text', 'shape', 'image', 'video', 'group', 'null-object'] as MotionObject['kind'][]).map((kind) => (
              <button key={kind} onClick={() => handleAddObject(kind)}
                style={{ fontSize: '9px', padding: '2px 5px', background: 'var(--color-elevated)', border: '1px solid var(--color-border)', borderRadius: '3px', color: 'var(--color-muted)', cursor: 'pointer' }}
                title={`Add ${kind}`} aria-label={`Add ${kind} object`}>
                {KIND_ICON[kind] ?? kind}
              </button>
            ))}
          </div>

          {/* Hierarchy panel */}
          {activePanel === 'hierarchy' && (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {rootObjects.length === 0 ? (
                <div style={{ padding: '20px 12px', textAlign: 'center', fontSize: '11px', color: 'var(--color-subtle)' }}>
                  No objects. Add one above.
                </div>
              ) : (
                rootObjects.sort((a, b) => b.depth - a.depth).map((obj) => (
                  <HierarchyRow
                    key={obj.id}
                    obj={obj}
                    selected={selectedObjectId === obj.id}
                    onSelect={() => setSelectedObjectId(obj.id)}
                    onRemove={() => handleRemoveObject(obj.id)}
                    onToggleVisible={() => handleSetObjectProp(obj.id, { visible: !obj.visible })}
                  />
                ))
              )}
            </div>
          )}

          {/* Graph editor panel */}
          {activePanel === 'graph' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
              {selectedObj ? (
                <GraphEditor obj={selectedObj} localTimeSecs={localTimeSecs} onAddKeyframe={handleAddKeyframe} />
              ) : (
                <div style={{ fontSize: '11px', color: 'var(--color-subtle)', textAlign: 'center', padding: '20px' }}>Select an object to edit keyframes</div>
              )}
            </div>
          )}

          {/* Materials panel */}
          {activePanel === 'materials' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
              <MaterialsPanel doc={doc} documentId={documentId} commitTransaction={commitTransaction} />
            </div>
          )}
        </div>

        {/* Center: Canvas preview */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0B0F17', position: 'relative' }}>
          <div style={{ position: 'relative', boxShadow: '0 0 0 1px rgba(244,247,255,0.08), 0 8px 32px rgba(0,0,0,0.8)' }}>
            <canvas
              ref={canvasRef}
              style={{ display: 'block', maxWidth: '100%', maxHeight: 'calc(100vh - 200px)', objectFit: 'contain' }}
              aria-label="Motion preview"
            />
          </div>

          {/* Local timeline scrubber */}
          <div style={{ position: 'absolute', bottom: '12px', left: '20px', right: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--color-subtle)', flexShrink: 0 }}>{localTimeSecs.toFixed(2)}s</span>
            <input
              type="range" min={0} max={1} step={0.001} value={localProgress}
              onChange={(e) => {
                const newLocalSecs = parseFloat(e.target.value) * clipDurSecs;
                const newSeqSecs = clipStartSecs + newLocalSecs;
                updateSession({ playheadFrame: Math.round(newSeqSecs * fps) });
              }}
              style={{ flex: 1 }}
              aria-label="Motion local time"
            />
            <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--color-subtle)', flexShrink: 0 }}>{clipDurSecs.toFixed(2)}s</span>
          </div>
        </div>

        {/* Right: Inspector */}
        <div style={{ width: '240px', borderLeft: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--color-border)', fontSize: '10px', fontWeight: 600, color: 'var(--color-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Inspector
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {selectedObj ? (
              <ObjectInspector
                obj={selectedObj}
                localTimeSecs={localTimeSecs}
                onSetProp={(props) => handleSetObjectProp(selectedObj.id, props)}
                onAddKeyframe={(property, value) => handleAddKeyframe(selectedObj.id, property, value)}
              />
            ) : (
              <div style={{ padding: '20px 12px', fontSize: '11px', color: 'var(--color-subtle)', textAlign: 'center' }}>
                Select an object to inspect
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Hierarchy row ─────────────────────────────────────────────

interface HierarchyRowProps {
  obj: MotionObject;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onToggleVisible: () => void;
}

function HierarchyRow({ obj, selected, onSelect, onRemove, onToggleVisible }: HierarchyRowProps) {
  return (
    <div
      onClick={onSelect}
      style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 8px', background: selected ? 'rgba(139,92,246,0.12)' : 'transparent', borderLeft: selected ? '2px solid var(--color-accent-2)' : '2px solid transparent', cursor: 'pointer' }}
      role="option"
      aria-selected={selected}
    >
      <span style={{ fontSize: '10px', color: 'var(--color-accent-2)', width: '16px', textAlign: 'center', flexShrink: 0 }}>{KIND_ICON[obj.kind] ?? '?'}</span>
      <span style={{ flex: 1, fontSize: '11px', color: obj.visible ? 'var(--color-fg)' : 'var(--color-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{obj.name}</span>
      <button onClick={(e) => { e.stopPropagation(); onToggleVisible(); }}
        style={{ background: 'none', border: 'none', color: obj.visible ? 'var(--color-muted)' : 'var(--color-subtle)', cursor: 'pointer', fontSize: '10px', padding: '0 2px', flexShrink: 0 }}
        title={obj.visible ? 'Hide' : 'Show'} aria-label={obj.visible ? 'Hide object' : 'Show object'}>
        {obj.visible ? '●' : '○'}
      </button>
      <button onClick={(e) => { e.stopPropagation(); onRemove(); }}
        style={{ background: 'none', border: 'none', color: 'var(--color-subtle)', cursor: 'pointer', fontSize: '10px', padding: '0 2px', flexShrink: 0 }}
        title="Remove" aria-label="Remove object">
        ✕
      </button>
    </div>
  );
}

// ── Object inspector ──────────────────────────────────────────

interface ObjectInspectorProps {
  obj: MotionObject;
  localTimeSecs: number;
  onSetProp: (props: Partial<MotionObject>) => void;
  onAddKeyframe: (property: string, value: number) => void;
}

function ObjectInspector({ obj, localTimeSecs, onSetProp, onAddKeyframe }: ObjectInspectorProps) {
  const mt = evaluateMotionTransform(obj, localTimeSecs);

  return (
    <div style={{ padding: '8px' }}>
      <InspectorSection label="Name">
        <input
          value={obj.name}
          onChange={(e) => onSetProp({ name: e.target.value })}
          style={{ width: '100%', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px', color: 'var(--color-fg)', fontSize: '11px', padding: '4px 6px' }}
          aria-label="Object name"
        />
      </InspectorSection>

      <InspectorSection label="Transform">
        <TransformRow label="X" value={mt.x} onChange={(v) => onSetProp({ transform: { ...obj.transform, x: v } })} onKeyframe={() => onAddKeyframe('x', mt.x)} />
        <TransformRow label="Y" value={mt.y} onChange={(v) => onSetProp({ transform: { ...obj.transform, y: v } })} onKeyframe={() => onAddKeyframe('y', mt.y)} />
        <TransformRow label="Z" value={mt.z} onChange={(v) => onSetProp({ transform: { ...obj.transform, z: v } })} onKeyframe={() => onAddKeyframe('z', mt.z)} />
        <TransformRow label="Rot Z" value={mt.rotationZ} onChange={(v) => onSetProp({ transform: { ...obj.transform, rotationZ: v } })} onKeyframe={() => onAddKeyframe('rotationZ', mt.rotationZ)} />
        <TransformRow label="Scale X" value={mt.scaleX} onChange={(v) => onSetProp({ transform: { ...obj.transform, scaleX: v } })} onKeyframe={() => onAddKeyframe('scaleX', mt.scaleX)} step={0.01} />
        <TransformRow label="Scale Y" value={mt.scaleY} onChange={(v) => onSetProp({ transform: { ...obj.transform, scaleY: v } })} onKeyframe={() => onAddKeyframe('scaleY', mt.scaleY)} step={0.01} />
        <TransformRow label="Opacity" value={mt.opacity} onChange={(v) => onSetProp({ transform: { ...obj.transform, opacity: Math.max(0, Math.min(1, v)) } })} onKeyframe={() => onAddKeyframe('opacity', mt.opacity)} step={0.01} min={0} max={1} />
      </InspectorSection>

      {obj.kind === 'text' && (
        <InspectorSection label="Text">
          <textarea
            value={obj.text ?? ''}
            onChange={(e) => onSetProp({ text: e.target.value })}
            style={{ width: '100%', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px', color: 'var(--color-fg)', fontSize: '11px', padding: '4px 6px', resize: 'vertical', minHeight: '48px' }}
            aria-label="Text content"
          />
          <TransformRow label="Size" value={obj.fontSize ?? 48} onChange={(v) => onSetProp({ fontSize: v })} onKeyframe={() => onAddKeyframe('fontSize', obj.fontSize ?? 48)} />
        </InspectorSection>
      )}

      {obj.kind === 'shape' && (
        <InspectorSection label="Shape">
          <div style={{ fontSize: '10px', color: 'var(--color-subtle)', marginBottom: '4px' }}>Fill Color</div>
          <input
            type="color"
            value={obj.shapeFillColor ?? '#3B82FF'}
            onChange={(e) => onSetProp({ shapeFillColor: e.target.value })}
            style={{ width: '100%', height: '28px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px', cursor: 'pointer' }}
            aria-label="Shape fill color"
          />
        </InspectorSection>
      )}

      <InspectorSection label="Blend Mode">
        <select
          value={obj.blendMode}
          onChange={(e) => onSetProp({ blendMode: e.target.value as MotionObject['blendMode'] })}
          style={{ width: '100%', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px', color: 'var(--color-fg)', fontSize: '11px', padding: '4px 6px' }}
          aria-label="Blend mode"
        >
          {['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'add', 'difference'].map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </InspectorSection>

      {obj.keyframes.length > 0 && (
        <InspectorSection label={`Keyframes (${obj.keyframes.length})`}>
          {obj.keyframes.slice(0, 8).map((kf) => (
            <div key={kf.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--color-muted)', padding: '2px 0' }}>
              <span style={{ color: 'var(--color-accent-2)' }}>{kf.property}</span>
              <span>{typeof kf.value === 'number' ? kf.value.toFixed(2) : String(kf.value)}</span>
              <span style={{ color: 'var(--color-subtle)' }}>{(toSeconds(kf.time)).toFixed(2)}s</span>
            </div>
          ))}
        </InspectorSection>
      )}
    </div>
  );
}

function InspectorSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ fontSize: '9px', fontWeight: 600, color: 'var(--color-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{label}</div>
      {children}
    </div>
  );
}

interface TransformRowProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  onKeyframe: () => void;
  step?: number;
  min?: number;
  max?: number;
}

function TransformRow({ label, value, onChange, onKeyframe, step = 1, min, max }: TransformRowProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
      <span style={{ fontSize: '10px', color: 'var(--color-subtle)', width: '44px', flexShrink: 0 }}>{label}</span>
      <input
        type="number"
        value={value.toFixed(step < 1 ? 2 : 0)}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        step={step}
        min={min}
        max={max}
        style={{ flex: 1, background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px', color: 'var(--color-fg)', fontSize: '10px', padding: '3px 5px', minWidth: 0 }}
        aria-label={label}
      />
      <button
        onClick={onKeyframe}
        style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '3px', color: 'var(--color-accent-2)', fontSize: '9px', padding: '2px 4px', cursor: 'pointer', flexShrink: 0 }}
        title="Add keyframe at current time"
        aria-label={`Add keyframe for ${label}`}
      >◆</button>
    </div>
  );
}

// ── Graph editor ──────────────────────────────────────────────

interface GraphEditorProps {
  obj: MotionObject;
  localTimeSecs: number;
  onAddKeyframe: (property: string, value: number) => void;
}

function GraphEditor({ obj, localTimeSecs, onAddKeyframe }: GraphEditorProps) {
  const properties = [...new Set(obj.keyframes.map((k) => k.property))];

  return (
    <div>
      <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-subtle)', marginBottom: '8px' }}>
        {obj.name} — {obj.keyframes.length} keyframes
      </div>
      {properties.length === 0 ? (
        <div style={{ fontSize: '10px', color: 'var(--color-subtle)' }}>No keyframes. Use ◆ in Inspector to add.</div>
      ) : (
        properties.map((prop) => {
          const kfs = obj.keyframes.filter((k) => k.property === prop).sort((a, b) => toSeconds(a.time) - toSeconds(b.time));
          return (
            <div key={prop} style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '10px', color: 'var(--color-accent-2)', marginBottom: '4px' }}>{prop}</div>
              <div style={{ position: 'relative', height: '32px', background: 'var(--color-well)', borderRadius: '3px', overflow: 'hidden' }}>
                {kfs.map((kf) => {
                  const maxTime = Math.max(...kfs.map((k) => toSeconds(k.time)), 1);
                  const x = (toSeconds(kf.time) / maxTime) * 100;
                  return (
                    <div key={kf.id}
                      style={{ position: 'absolute', left: `${x}%`, top: '50%', transform: 'translate(-50%, -50%)', width: '6px', height: '6px', background: 'var(--color-accent-2)', borderRadius: '1px', cursor: 'pointer' }}
                      title={`${prop}: ${typeof kf.value === 'number' ? kf.value.toFixed(2) : kf.value} @ ${toSeconds(kf.time).toFixed(2)}s`}
                    />
                  );
                })}
                <div style={{ position: 'absolute', left: `${Math.min(100, (localTimeSecs / Math.max(...kfs.map((k) => toSeconds(k.time)), 1)) * 100)}%`, top: 0, bottom: 0, width: '1px', background: 'var(--color-danger)', opacity: 0.7 }} />
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// ── Materials panel ───────────────────────────────────────────

interface MaterialsPanelProps {
  doc: MotionDocument;
  documentId: string;
  commitTransaction: (tx: MotionTransaction) => void;
}

function MaterialsPanel({ doc, documentId, commitTransaction }: MaterialsPanelProps) {
  const handleAddMaterial = () => {
    const mat = {
      id: generateId('mmat'),
      name: `Material ${Object.keys(doc.materials).length + 1}`,
      type: 'solid' as const,
      color: '#3B82FF',
    };
    commitTransaction({
      ops: [{ type: 'motion.material.upsert', documentId, payload: { material: mat } }],
      description: 'Add material',
    });
  };

  return (
    <div>
      <button onClick={handleAddMaterial}
        style={{ width: '100%', background: 'var(--color-elevated)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'var(--color-muted)', fontSize: '11px', padding: '6px', cursor: 'pointer', marginBottom: '8px' }}>
        + Add Material
      </button>
      {Object.values(doc.materials).map((mat) => (
        <div key={mat.id} style={{ padding: '6px 8px', background: 'var(--color-elevated)', border: '1px solid var(--color-border)', borderRadius: '4px', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ width: '16px', height: '16px', borderRadius: '3px', background: mat.color ?? '#3B82FF', flexShrink: 0 }} />
          <span style={{ fontSize: '11px', color: 'var(--color-fg)', flex: 1 }}>{mat.name}</span>
          <span style={{ fontSize: '9px', color: 'var(--color-subtle)' }}>{mat.type}</span>
        </div>
      ))}
      {Object.keys(doc.materials).length === 0 && (
        <div style={{ fontSize: '10px', color: 'var(--color-subtle)', textAlign: 'center', padding: '12px' }}>No materials</div>
      )}
    </div>
  );
}
