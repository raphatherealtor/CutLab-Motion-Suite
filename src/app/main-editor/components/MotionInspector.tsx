'use client';

/**
 * CutLab Motion Inspector — Extended
 * Integrates: Objects, Properties, Text, Behaviors, Signals, Curves, Dope Sheet,
 * Camera, Macros, Spatial/2.5D, Signal Binding, Diagnostics
 *
 * Typed against the CANONICAL engine MotionDocument (ProjectData.motionDocuments).
 * All edits flow: MotionOp[] → MotionTransaction → motionTransactionToStudioOps → one history entry.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useEngine } from '@/engine/store';
import { resolveClipMotionDocument, motionTransactionToStudioOps, studioTimeToMotionTime } from '@/engine/motion-bridge';
import type { MotionDocument, MotionObject, MotionBehavior, MotionMaterial, MotionKeyframe } from '@/engine/motion-document';
import { DEFAULT_MOTION_TRANSFORM } from '@/engine/motion-document';
import { type FrameState, evaluateMotionClip } from '@/engine/motion-document-utils';
import { makeOp as makeMotionOp, createMotionTransaction, generateMotionId, motionTimeToSeconds, secondsToMotionTime } from '@/engine/motion-document-utils';
import TextMotionPanel from './TextMotionPanel';
import CreativeMacrosPanel from './CreativeMacrosPanel';
import SignalBindingPanel from './SignalBindingPanel';
import SpatialDepthPanel from './SpatialDepthPanel';
import SceneScriptPanel from './SceneScriptPanel';
import SignalResourcePanel from './SignalResourcePanel';
import EvaluationTracePanel from './EvaluationTracePanel';

type MotionInspectorTab = 'objects' | 'properties' | 'text' | 'behaviors' | 'signals' | 'resources' | 'curves' | 'dope' | 'camera' | 'macros' | 'spatial' | 'scene' | 'trace' | 'diagnostics';

interface MotionInspectorProps {
  clipId: string;
}

export default function MotionInspector({ clipId }: MotionInspectorProps) {
  const engine = useEngine();
  const { project, activeSequence, session, dispatch, dispatchBatch } = engine;
  const fps = activeSequence?.format.fps ?? 29.97;

  const clip = activeSequence?.clips.find((c) => c.id === clipId) ?? null;
  const doc = clip && project ? resolveClipMotionDocument(project, clip) : null;

  const [tab, setTab] = useState<MotionInspectorTab>('objects');
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [frameState, setFrameState] = useState<FrameState | null>(null);

  useEffect(() => {
    if (!clip || !project) return;
    const timeSecs = session.playheadFrame / fps;
    const fs = evaluateMotionClip(project, clip, timeSecs);
    setFrameState(fs);
  }, [session.playheadFrame, clip, project, fps]);

  useEffect(() => {
    if (doc && doc.rootObjectIds.length > 0 && !selectedObjectId) {
      setSelectedObjectId(doc.rootObjectIds[0]);
    }
  }, [doc?.id]);

  const selectedObject = doc && selectedObjectId ? doc.objects[selectedObjectId] : null;

  const applyMotionOps = useCallback((ops: ReturnType<typeof makeMotionOp>[], description: string) => {
    if (!project || !doc) return;
    const transaction = createMotionTransaction(description, ops);
    const studioOps = motionTransactionToStudioOps(transaction, project);
    if (studioOps.length > 0) {
      dispatchBatch(studioOps, description);
    }
  }, [project, doc, dispatchBatch]);

  if (!clip || !doc) {
    return (
      <div style={{ padding: '16px', textAlign: 'center' }}>
        <div style={{ fontSize: '11px', color: 'var(--color-muted)' }}>No Motion document</div>
        <div style={{ fontSize: '10px', color: 'var(--color-subtle)', marginTop: '4px' }}>Select a Motion clip to edit</div>
      </div>
    );
  }

  const tabs: { id: MotionInspectorTab; label: string; title: string }[] = [
    { id: 'objects', label: 'Objects', title: 'Object hierarchy' },
    { id: 'properties', label: 'Props', title: 'Transform & properties' },
    { id: 'text', label: 'Text', title: 'Text authoring — typography, word motion, materials, spatial' },
    { id: 'behaviors', label: 'Behaviors', title: 'Motion behaviors' },
    { id: 'signals', label: 'Signals', title: 'Signal binding' },
    { id: 'resources', label: 'Resources', title: 'Signal resources' },
    { id: 'curves', label: 'Curves', title: 'Keyframe graph editor' },
    { id: 'dope', label: 'Dope', title: 'Dope sheet' },
    { id: 'camera', label: 'Camera', title: 'Camera controls' },
    { id: 'macros', label: 'Macros', title: 'Creative macros' },
    { id: 'spatial', label: '2.5D', title: 'Spatial depth & rigs' },
    { id: 'scene', label: 'Scene', title: 'Scene script & resources' },
    { id: 'trace', label: 'Trace', title: 'Evaluation trace' },
    { id: 'diagnostics', label: 'Diag', title: 'Diagnostics & evaluation trace' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Motion doc header */}
      <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#8B5CF6', flexShrink: 0 }} />
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</div>
          <div style={{ fontSize: '10px', color: 'var(--color-subtle)', fontFamily: 'var(--font-mono)', marginLeft: 'auto', flexShrink: 0 }}>
            {doc.fps}fps · {doc.width}×{doc.height}
          </div>
        </div>
        <div style={{ fontSize: '10px', color: 'var(--color-subtle)', marginTop: '2px' }}>
          {Object.keys(doc.objects).length} objects · {doc.rootObjectIds.length} root
          {doc.templateId && <span style={{ marginLeft: '6px', color: 'var(--color-accent-2)' }}>from {doc.templateId}</span>}
          {frameState && <span style={{ marginLeft: '6px', color: '#34D399' }}>● {frameState.localTimeSecs.toFixed(2)}s</span>}
        </div>
      </div>

      {/* Tab bar — scrollable */}
      <div style={{ padding: '3px 6px', borderBottom: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', gap: '2px', overflowX: 'auto' }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            title={t.title}
            style={{
              background: tab === t.id ? 'rgba(139,92,246,0.15)' : 'transparent',
              border: 'none',
              borderRadius: '3px',
              padding: '3px 6px',
              fontSize: '10px',
              color: tab === t.id ? 'var(--color-accent-2)' : 'var(--color-subtle)',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
            aria-pressed={tab === t.id}
          >{t.label}</button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {tab === 'objects' && (
          <ObjectsPanel doc={doc} selectedObjectId={selectedObjectId} onSelect={setSelectedObjectId} onApplyOps={applyMotionOps} />
        )}
        {tab === 'properties' && selectedObject && (
          <PropertiesPanel doc={doc} obj={selectedObject} onApplyOps={applyMotionOps} />
        )}
        {tab === 'text' && selectedObject && selectedObject.kind === 'text' && (
          <TextMotionPanel clipId={clipId} objectId={selectedObject.id} />
        )}
        {tab === 'text' && (!selectedObject || selectedObject.kind !== 'text') && (
          <div style={{ padding: '16px', textAlign: 'center', fontSize: '11px', color: 'var(--color-muted)' }}>
            Select a text object in the Objects tab
          </div>
        )}
        {tab === 'behaviors' && selectedObject && (
          <BehaviorsPanel doc={doc} obj={selectedObject} onApplyOps={applyMotionOps} />
        )}
        {tab === 'signals' && (
          <SignalBindingPanel clipId={clipId} />
        )}
        {tab === 'resources' && (
          <SignalResourcePanel clipId={clipId} />
        )}
        {tab === 'curves' && selectedObject && (
          <CurvesPanel
            doc={doc}
            obj={selectedObject}
            localTimeSecs={clip ? studioTimeToMotionTime(session.playheadFrame / fps, clip) : 0}
            onApplyOps={applyMotionOps}
          />
        )}
        {tab === 'dope' && (
          <DopeSheetPanel
            doc={doc}
            selectedObjectId={selectedObjectId}
            onSelect={setSelectedObjectId}
            localTimeSecs={clip ? studioTimeToMotionTime(session.playheadFrame / fps, clip) : 0}
          />
        )}
        {tab === 'camera' && (
          <CameraPanel doc={doc} onApplyOps={applyMotionOps} />
        )}
        {tab === 'macros' && (
          <CreativeMacrosPanel clipId={clipId} />
        )}
        {tab === 'spatial' && (
          <SpatialDepthPanel clipId={clipId} />
        )}
        {tab === 'scene' && (
          <SceneScriptPanel />
        )}
        {tab === 'trace' && (
          <EvaluationTracePanel clipId={clipId} objectId={selectedObjectId ?? undefined} />
        )}
        {tab === 'diagnostics' && (
          <DiagnosticsPanel doc={doc} frameState={frameState} />
        )}
        {(tab === 'properties' || tab === 'behaviors' || tab === 'curves') && !selectedObject && (
          <div style={{ padding: '16px', textAlign: 'center', fontSize: '11px', color: 'var(--color-muted)' }}>
            Select an object in the Objects tab
          </div>
        )}
      </div>
    </div>
  );
}

// ── Objects Panel ─────────────────────────────────────────────

interface ObjectsPanelProps {
  doc: MotionDocument;
  selectedObjectId: string | null;
  onSelect: (id: string) => void;
  onApplyOps: (ops: ReturnType<typeof makeMotionOp>[], desc: string) => void;
}

function ObjectsPanel({ doc, selectedObjectId, onSelect, onApplyOps }: ObjectsPanelProps) {
  const kindIcon: Record<string, string> = {
    text: 'T', 'text-segment': 'T', shape: '◻', image: '🖼', video: '▶', group: '⊞', camera: '📷',
    light: '💡', particle: '✦', path: '⌇', mask: '⬡', 'null-object': '○', null: '○', svg: 'S',
  };

  const addTextObject = () => {
    const objId = generateMotionId('obj');
    const obj: MotionObject = {
      id: objId, kind: 'text', name: 'New Text', depth: 0,
      transform: { ...DEFAULT_MOTION_TRANSFORM },
      keyframes: [], behaviors: [], masks: [],
      blendMode: 'normal', visible: true, solo: false, locked: false,
      text: 'New Text',
      textAlign: 'center',
      textSegments: [{
        id: generateMotionId('seg'), text: 'New Text',
        startTime: { value: 0, timescale: 30000 }, endTime: { value: 30000, timescale: 30000 },
        fontSize: 48, fontWeight: 700,
      }],
    };
    onApplyOps([makeMotionOp('motion.addObject', doc.id, { object: obj, addToRoot: true })], 'Add text object');
    onSelect(objId);
  };

  const addShapeObject = () => {
    const objId = generateMotionId('obj');
    const obj: MotionObject = {
      id: objId, kind: 'shape', name: 'New Shape', depth: 0,
      transform: { ...DEFAULT_MOTION_TRANSFORM },
      keyframes: [], behaviors: [], masks: [],
      blendMode: 'normal', visible: true, solo: false, locked: false,
      materialId: undefined,
      shapeType: 'rectangle',
      shapeFillColor: '#3B82FF',
    };
    const matId = generateMotionId('mat');
    onApplyOps([
      makeMotionOp('motion.addObject', doc.id, { object: obj, addToRoot: true }),
      makeMotionOp('motion.setMaterial', doc.id, { objectId: objId, material: { id: matId, name: 'Shape Fill', type: 'solid', color: '#3B82FF' } }),
    ], 'Add shape object');
    onSelect(objId);
  };

  const removeObject = (objId: string) => {
    onApplyOps([makeMotionOp('motion.removeObject', doc.id, { objectId: objId })], 'Remove object');
  };

  const toggleVisibility = (obj: MotionObject) => {
    onApplyOps([makeMotionOp('motion.setObjectProp', doc.id, { objectId: obj.id, props: { visible: !obj.visible } })], 'Toggle visibility');
  };

  return (
    <div style={{ padding: '6px' }}>
      <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
        <button onClick={addTextObject} style={{ flex: 1, fontSize: '10px', padding: '4px 6px', background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '3px', color: 'var(--color-accent-2)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>+ Text</button>
        <button onClick={addShapeObject} style={{ flex: 1, fontSize: '10px', padding: '4px 6px', background: 'rgba(59,130,255,0.1)', border: '1px solid rgba(59,130,255,0.3)', borderRadius: '3px', color: 'var(--color-accent)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>+ Shape</button>
      </div>
      {doc.rootObjectIds.length === 0 ? (
        <div style={{ padding: '12px', textAlign: 'center', fontSize: '11px', color: 'var(--color-subtle)' }}>No objects</div>
      ) : (
        doc.rootObjectIds.map((objId) => {
          const obj = doc.objects[objId];
          if (!obj) return null;
          const isSelected = selectedObjectId === objId;
          return (
            <div key={objId} onClick={() => onSelect(objId)} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 6px', borderRadius: '3px', background: isSelected ? 'rgba(139,92,246,0.12)' : 'transparent', border: `1px solid ${isSelected ? 'rgba(139,92,246,0.3)' : 'transparent'}`, cursor: 'pointer', marginBottom: '2px' }}>
              <span style={{ fontSize: '10px', color: 'var(--color-accent-2)', width: '14px', textAlign: 'center', flexShrink: 0 }}>{kindIcon[obj.kind] ?? '?'}</span>
              <span style={{ fontSize: '11px', color: 'var(--color-fg)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{obj.name}</span>
              <span style={{ fontSize: '9px', color: 'var(--color-subtle)', fontFamily: 'var(--font-mono)' }}>z:{obj.depth}</span>
              <button onClick={(e) => { e.stopPropagation(); toggleVisibility(obj); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: obj.visible ? 'var(--color-subtle)' : 'var(--color-muted)', fontSize: '10px', padding: '1px 3px' }} title={obj.visible ? 'Hide' : 'Show'} aria-label={obj.visible ? 'Hide object' : 'Show object'}>{obj.visible ? '👁' : '○'}</button>
              <button onClick={(e) => { e.stopPropagation(); removeObject(objId); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger)', fontSize: '10px', padding: '1px 3px' }} title="Remove object" aria-label="Remove object">✕</button>
            </div>
          );
        })
      )}
    </div>
  );
}

// ── Properties Panel ──────────────────────────────────────────

interface PropertiesPanelProps {
  doc: MotionDocument;
  obj: MotionObject;
  onApplyOps: (ops: ReturnType<typeof makeMotionOp>[], desc: string) => void;
}

function PropertiesPanel({ doc, obj, onApplyOps }: PropertiesPanelProps) {
  const objMaterial: MotionMaterial | undefined = obj.materialId ? doc.materials[obj.materialId] : undefined;
  const [localX, setLocalX] = useState(obj.transform.x);
  const [localY, setLocalY] = useState(obj.transform.y);
  const [localZ, setLocalZ] = useState(obj.transform.z);
  const [localRotZ, setLocalRotZ] = useState(obj.transform.rotationZ);
  const [localScaleX, setLocalScaleX] = useState(obj.transform.scaleX);
  const [localScaleY, setLocalScaleY] = useState(obj.transform.scaleY);
  const [localOpacity, setLocalOpacity] = useState(obj.transform.opacity * 100);
  const [localDepth, setLocalDepth] = useState(obj.depth);
  const [localText, setLocalText] = useState(obj.textSegments?.[0]?.text ?? '');
  const [localFontSize, setLocalFontSize] = useState(obj.textSegments?.[0]?.fontSize ?? 48);
  const [localColor, setLocalColor] = useState(objMaterial?.color ?? '#ffffff');

  useEffect(() => {
    setLocalX(obj.transform.x);
    setLocalY(obj.transform.y);
    setLocalZ(obj.transform.z);
    setLocalRotZ(obj.transform.rotationZ);
    setLocalScaleX(obj.transform.scaleX);
    setLocalScaleY(obj.transform.scaleY);
    setLocalOpacity(obj.transform.opacity * 100);
    setLocalDepth(obj.depth);
    setLocalText(obj.textSegments?.[0]?.text ?? '');
    setLocalFontSize(obj.textSegments?.[0]?.fontSize ?? 48);
    setLocalColor(objMaterial?.color ?? '#ffffff');
    // Resync on object/material identity (not just id): the reducer rebuilds
    // references every revision, so undo/redo on the SAME object refreshes
    // these inputs instead of leaving pre-undo values in the fields.
  }, [obj, objMaterial]);

  const commitTransform = (patch: Partial<MotionObject['transform']>) => {
    onApplyOps([makeMotionOp('motion.setObjectTransform', doc.id, { objectId: obj.id, transform: patch })], 'Set transform');
  };

  const commitText = (text: string) => {
    if (!obj.textSegments?.[0]) return;
    const seg = { ...obj.textSegments[0], text };
    onApplyOps([makeMotionOp('motion.setTextSegment', doc.id, { objectId: obj.id, segment: seg })], 'Set text');
  };

  const commitFontSize = (fontSize: number) => {
    if (!obj.textSegments?.[0]) return;
    const seg = { ...obj.textSegments[0], fontSize };
    onApplyOps([makeMotionOp('motion.setTextSegment', doc.id, { objectId: obj.id, segment: seg })], 'Set font size');
  };

  const commitColor = (hex: string) => {
    const material: MotionMaterial = objMaterial
      ? { ...objMaterial, color: hex }
      : { id: generateMotionId('mat'), name: 'Fill', type: 'solid', color: hex };
    onApplyOps([makeMotionOp('motion.setMaterial', doc.id, { objectId: obj.id, material })], 'Set color');
  };

  const commitDepth = (depth: number) => {
    onApplyOps([makeMotionOp('motion.setObjectProp', doc.id, { objectId: obj.id, props: { depth } })], 'Set depth');
  };

  const row = (label: string, content: React.ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '5px' }}>
      <span style={{ fontSize: '10px', color: 'var(--color-subtle)', width: '52px', flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1 }}>{content}</div>
    </div>
  );

  const numInput = (value: number, onChange: (v: number) => void, onCommit: (v: number) => void, step = 1) => (
    <input type="number" value={Math.round(value * 100) / 100} step={step}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      onBlur={(e) => onCommit(parseFloat(e.target.value) || 0)}
      onKeyDown={(e) => e.key === 'Enter' && onCommit(parseFloat((e.target as HTMLInputElement).value) || 0)}
      style={{ width: '100%', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px', color: 'var(--color-fg)', fontSize: '11px', fontFamily: 'var(--font-mono)', padding: '3px 6px' }}
    />
  );

  return (
    <div style={{ padding: '8px' }}>
      <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Transform</div>
      {row('X', numInput(localX, setLocalX, (v) => { setLocalX(v); commitTransform({ x: v }); }))}
      {row('Y', numInput(localY, setLocalY, (v) => { setLocalY(v); commitTransform({ y: v }); }))}
      {row('Z (depth)', numInput(localZ, setLocalZ, (v) => { setLocalZ(v); commitTransform({ z: v }); }))}
      {row('Rot Z', numInput(localRotZ, setLocalRotZ, (v) => { setLocalRotZ(v); commitTransform({ rotationZ: v }); }))}
      {row('Scale X', numInput(localScaleX, setLocalScaleX, (v) => { setLocalScaleX(v); commitTransform({ scaleX: v }); }, 0.01))}
      {row('Scale Y', numInput(localScaleY, setLocalScaleY, (v) => { setLocalScaleY(v); commitTransform({ scaleY: v }); }, 0.01))}
      {row('Opacity', (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input type="range" min={0} max={100} value={localOpacity} onChange={(e) => setLocalOpacity(parseFloat(e.target.value))} onMouseUp={() => commitTransform({ opacity: localOpacity / 100 })} className="range-slider" style={{ flex: 1 }} aria-label="Opacity" />
          <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--color-fg)', minWidth: '28px' }}>{Math.round(localOpacity)}%</span>
        </div>
      ))}
      <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-muted)', margin: '10px 0 6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Depth / 2.5D</div>
      {row('Layer Z', numInput(localDepth, setLocalDepth, (v) => { setLocalDepth(v); commitDepth(v); }))}
      {obj.kind === 'text' && (
        <>
          <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-muted)', margin: '10px 0 6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Text</div>
          {row('Content', (
            <textarea value={localText} onChange={(e) => setLocalText(e.target.value)} onBlur={(e) => commitText(e.target.value)} rows={2}
              style={{ width: '100%', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px', color: 'var(--color-fg)', fontSize: '11px', fontFamily: 'var(--font-sans)', padding: '4px 6px', resize: 'vertical' }}
            />
          ))}
          {row('Font Size', numInput(localFontSize, setLocalFontSize, (v) => { setLocalFontSize(v); commitFontSize(v); }))}
        </>
      )}
      <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-muted)', margin: '10px 0 6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Material</div>
      {row('Color', (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <input type="color" value={localColor} onChange={(e) => setLocalColor(e.target.value)} onBlur={(e) => commitColor(e.target.value)} style={{ width: '28px', height: '22px', border: '1px solid var(--color-border)', borderRadius: '3px', cursor: 'pointer', padding: '1px' }} aria-label="Object color" />
          <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--color-muted)' }}>{localColor}</span>
        </div>
      ))}
    </div>
  );
}

// ── Behaviors Panel ───────────────────────────────────────────

interface BehaviorsPanelProps {
  doc: MotionDocument;
  obj: MotionObject;
  onApplyOps: (ops: ReturnType<typeof makeMotionOp>[], desc: string) => void;
}

function BehaviorsPanel({ doc, obj, onApplyOps }: BehaviorsPanelProps) {
  const behaviorTypes: MotionBehavior['type'][] = [
    'fade-in', 'fade-out', 'slide-in', 'slide-out', 'scale-in', 'scale-out',
    'pulse', 'shake', 'spin', 'signal-reactive', 'typewriter', 'word-by-word', 'wave',
  ];

  const addBehavior = (type: MotionBehavior['type']) => {
    const behavior: MotionBehavior = {
      id: generateMotionId('beh'), type,
      startTime: secondsToMotionTime(0),
      duration: secondsToMotionTime(0.5),
      params: {}, easing: 'ease-out',
    };
    onApplyOps([makeMotionOp('motion.addBehavior', doc.id, { objectId: obj.id, behavior })], `Add ${type}`);
  };

  const removeBehavior = (behaviorId: string) => {
    onApplyOps([makeMotionOp('motion.removeBehavior', doc.id, { objectId: obj.id, behaviorId })], 'Remove behavior');
  };

  return (
    <div style={{ padding: '8px' }}>
      <div style={{ marginBottom: '8px' }}>
        <div style={{ fontSize: '10px', color: 'var(--color-subtle)', marginBottom: '4px' }}>Add Behavior</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
          {behaviorTypes.map((type) => (
            <button key={type} onClick={() => addBehavior(type)} style={{ fontSize: '9px', padding: '2px 6px', background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: '10px', color: 'var(--color-accent-2)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>{type}</button>
          ))}
        </div>
      </div>
      {(obj.behaviors ?? []).length === 0 ? (
        <div style={{ padding: '12px', textAlign: 'center', fontSize: '11px', color: 'var(--color-subtle)' }}>No behaviors</div>
      ) : (
        obj.behaviors.map((beh) => (
          <div key={beh.id} style={{ background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '6px 8px', marginBottom: '5px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-fg)', flex: 1 }}>{beh.type}</span>
              {beh.signalBinding && <span style={{ fontSize: '9px', color: '#22D3EE', background: 'rgba(34,211,238,0.1)', padding: '1px 4px', borderRadius: '2px' }}>⚡ signal</span>}
              <button onClick={() => removeBehavior(beh.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger)', fontSize: '10px' }} aria-label="Remove behavior">✕</button>
            </div>
            <div style={{ fontSize: '9px', color: 'var(--color-subtle)', fontFamily: 'var(--font-mono)' }}>
              {motionTimeToSeconds(beh.startTime).toFixed(2)}s → {(motionTimeToSeconds(beh.startTime) + motionTimeToSeconds(beh.duration)).toFixed(2)}s · {beh.easing}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Curves Panel ──────────────────────────────────────────────

interface CurvesPanelProps {
  doc: MotionDocument;
  obj: MotionObject;
  localTimeSecs: number;
  onApplyOps: (ops: ReturnType<typeof makeMotionOp>[], desc: string) => void;
}

function CurvesPanel({ doc, obj, localTimeSecs, onApplyOps }: CurvesPanelProps) {
  const docDurSecs = motionTimeToSeconds(doc.duration);
  // Canonical property names — match evaluateMotionTransform in engine/motion-document.ts
  const properties = ['x', 'y', 'z', 'rotationZ', 'scaleX', 'scaleY', 'opacity'];
  const [selectedProp, setSelectedProp] = useState('x');
  const kfsForProp = obj.keyframes.filter((k) => k.property === selectedProp);

  const addKeyframe = (prop: string) => {
    const value = getPropertyValue(obj, prop);
    const kf: MotionKeyframe = { id: generateMotionId('kf'), time: secondsToMotionTime(localTimeSecs), property: prop, value, easing: 'ease-in-out' };
    onApplyOps([makeMotionOp('motion.upsertKeyframe', doc.id, { objectId: obj.id, keyframe: kf })], `Add keyframe: ${prop}`);
  };

  const removeKeyframe = (kfId: string) => {
    onApplyOps([makeMotionOp('motion.removeKeyframe', doc.id, { objectId: obj.id, keyframeId: kfId })], 'Remove keyframe');
  };

  return (
    <div style={{ padding: '8px' }}>
      <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', marginBottom: '8px' }}>
        {properties.map((prop) => {
          const hasKfs = obj.keyframes.some((k) => k.property === prop);
          return (
            <button key={prop} onClick={() => setSelectedProp(prop)} style={{ fontSize: '9px', padding: '2px 6px', background: selectedProp === prop ? 'rgba(59,130,255,0.15)' : 'transparent', border: `1px solid ${selectedProp === prop ? 'rgba(59,130,255,0.4)' : 'var(--color-border)'}`, borderRadius: '10px', color: selectedProp === prop ? 'var(--color-accent)' : hasKfs ? 'var(--color-accent-3)' : 'var(--color-subtle)', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>{prop}{hasKfs ? ' ◆' : ''}</button>
          );
        })}
      </div>
      <button onClick={() => addKeyframe(selectedProp)} style={{ width: '100%', fontSize: '10px', padding: '5px', background: 'rgba(59,130,255,0.1)', border: '1px solid rgba(59,130,255,0.3)', borderRadius: '3px', color: 'var(--color-accent)', cursor: 'pointer', fontFamily: 'var(--font-sans)', marginBottom: '8px' }}>◆ Add keyframe at {localTimeSecs.toFixed(2)}s</button>
      <div style={{ background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '4px', height: '80px', position: 'relative', overflow: 'hidden', marginBottom: '8px' }}>
        <svg width="100%" height="100%" viewBox={`0 0 ${docDurSecs * 100} 100`} preserveAspectRatio="none">
          <line x1="0" y1="50" x2={docDurSecs * 100} y2="50" stroke="rgba(244,247,255,0.05)" strokeWidth="1" />
          <line x1={localTimeSecs * 100} y1="0" x2={localTimeSecs * 100} y2="100" stroke="rgba(59,130,255,0.5)" strokeWidth="1" />
          {kfsForProp.map((kf) => (
            <circle key={kf.id} cx={motionTimeToSeconds(kf.time) * 100} cy={50} r={4} fill="var(--color-accent-3)" style={{ cursor: 'pointer' }} onClick={() => removeKeyframe(kf.id)} />
          ))}
        </svg>
        {kfsForProp.length === 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: 'var(--color-subtle)' }}>No keyframes for {selectedProp}</div>
        )}
      </div>
      {kfsForProp.map((kf) => (
        <div key={kf.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 6px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px', marginBottom: '3px' }}>
          <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--color-accent-3)' }}>◆</span>
          <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--color-muted)', minWidth: '40px' }}>{motionTimeToSeconds(kf.time).toFixed(2)}s</span>
          <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--color-fg)', flex: 1 }}>{typeof kf.value === 'number' ? kf.value.toFixed(2) : String(kf.value)}</span>
          <span style={{ fontSize: '9px', color: 'var(--color-subtle)' }}>{kf.easing}</span>
          <button onClick={() => removeKeyframe(kf.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger)', fontSize: '10px' }} aria-label="Remove keyframe">✕</button>
        </div>
      ))}
    </div>
  );
}

function getPropertyValue(obj: MotionObject, prop: string): number {
  switch (prop) {
    case 'x': return obj.transform.x;
    case 'y': return obj.transform.y;
    case 'z': return obj.transform.z;
    case 'rotationZ': return obj.transform.rotationZ;
    case 'scaleX': return obj.transform.scaleX;
    case 'scaleY': return obj.transform.scaleY;
    case 'opacity': return obj.transform.opacity;
    default: return 0;
  }
}

// ── Dope Sheet Panel ──────────────────────────────────────────

interface DopeSheetPanelProps {
  doc: MotionDocument;
  selectedObjectId: string | null;
  onSelect: (id: string) => void;
  localTimeSecs: number;
}

function DopeSheetPanel({ doc, selectedObjectId, onSelect, localTimeSecs }: DopeSheetPanelProps) {
  const docDurSecs = motionTimeToSeconds(doc.duration);
  return (
    <div style={{ padding: '6px' }}>
      <div style={{ fontSize: '10px', color: 'var(--color-subtle)', marginBottom: '6px' }}>Dope Sheet — {docDurSecs.toFixed(1)}s</div>
      {doc.rootObjectIds.map((objId) => {
        const obj = doc.objects[objId];
        if (!obj) return null;
        const isSelected = selectedObjectId === objId;
        return (
          <div key={objId} style={{ marginBottom: '4px' }}>
            <div onClick={() => onSelect(objId)} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 4px', background: isSelected ? 'rgba(139,92,246,0.1)' : 'transparent', borderRadius: '3px', cursor: 'pointer', marginBottom: '2px' }}>
              <span style={{ fontSize: '10px', color: 'var(--color-fg)', flex: 1 }}>{obj.name}</span>
              <span style={{ fontSize: '9px', color: 'var(--color-subtle)' }}>{obj.keyframes.length}kf · {(obj.behaviors ?? []).length}beh</span>
            </div>
            <div style={{ height: '18px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px', position: 'relative', overflow: 'hidden' }}>
              {(obj.behaviors ?? []).map((beh) => {
                const start = motionTimeToSeconds(beh.startTime) / docDurSecs * 100;
                const width = motionTimeToSeconds(beh.duration) / docDurSecs * 100;
                return <div key={beh.id} style={{ position: 'absolute', top: '2px', bottom: '2px', left: `${start}%`, width: `${width}%`, background: beh.signalBinding ? 'rgba(34,211,238,0.3)' : 'rgba(139,92,246,0.3)', borderRadius: '2px', minWidth: '2px' }} title={beh.type} />;
              })}
              {obj.keyframes.map((kf) => {
                const pos = motionTimeToSeconds(kf.time) / docDurSecs * 100;
                return <div key={kf.id} style={{ position: 'absolute', top: '50%', left: `${pos}%`, transform: 'translate(-50%, -50%)', width: '6px', height: '6px', background: 'var(--color-accent-3)', borderRadius: '1px', rotate: '45deg' }} title={kf.property} />;
              })}
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(localTimeSecs / docDurSecs) * 100}%`, width: '1px', background: 'rgba(59,130,255,0.7)' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Camera Panel ──────────────────────────────────────────────

interface CameraPanelProps {
  doc: MotionDocument;
  onApplyOps: (ops: ReturnType<typeof makeMotionOp>[], desc: string) => void;
}

function CameraPanel({ doc, onApplyOps }: CameraPanelProps) {
  const cam = (doc.activeCameraId ? doc.cameras[doc.activeCameraId] : undefined) ?? Object.values(doc.cameras)[0];
  const addCamera = () => {
    const camera = {
      id: generateMotionId('cam'), name: 'Camera',
      transform: { ...DEFAULT_MOTION_TRANSFORM, z: -1000 },
      keyframes: [], fov: 60, near: 1, far: 10000, active: true,
    };
    onApplyOps([
      makeMotionOp('motion.setCamera', doc.id, { camera }),
      makeMotionOp('motion.camera.setActive', doc.id, { cameraId: camera.id }),
    ], 'Add camera');
  };
  if (!cam) {
    return (
      <div style={{ padding: '16px', textAlign: 'center' }}>
        <div style={{ fontSize: '11px', color: 'var(--color-muted)', marginBottom: '8px' }}>No camera</div>
        <button onClick={addCamera} style={{ fontSize: '10px', padding: '5px 12px', background: 'rgba(59,130,255,0.1)', border: '1px solid rgba(59,130,255,0.3)', borderRadius: '3px', color: 'var(--color-accent)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>Add Camera</button>
      </div>
    );
  }
  return (
    <div style={{ padding: '8px' }}>
      <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-muted)', marginBottom: '6px', textTransform: 'uppercase' }}>Camera</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '5px' }}>
        <span style={{ fontSize: '10px', color: 'var(--color-subtle)', width: '52px' }}>FOV</span>
        <input type="number" value={cam.fov} min={10} max={120} onChange={(e) => { const newCam = { ...cam, fov: parseFloat(e.target.value) || 60 }; onApplyOps([makeMotionOp('motion.setCamera', doc.id, { camera: newCam })], 'Set FOV'); }} style={{ width: '60px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px', color: 'var(--color-fg)', fontSize: '11px', fontFamily: 'var(--font-mono)', padding: '3px 6px' }} />
        <span style={{ fontSize: '10px', color: 'var(--color-subtle)' }}>°</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '5px' }}>
        <span style={{ fontSize: '10px', color: 'var(--color-subtle)', width: '52px' }}>Z Pos</span>
        <input type="number" value={cam.transform.z} step={10} onChange={(e) => { const newCam = { ...cam, transform: { ...cam.transform, z: parseFloat(e.target.value) || -1000 } }; onApplyOps([makeMotionOp('motion.setCamera', doc.id, { camera: newCam })], 'Set camera Z'); }} style={{ width: '80px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px', color: 'var(--color-fg)', fontSize: '11px', fontFamily: 'var(--font-mono)', padding: '3px 6px' }} />
      </div>
      <div style={{ fontSize: '10px', color: 'var(--color-subtle)', marginTop: '8px' }}>{cam.keyframes.length} keyframes</div>
    </div>
  );
}

// ── Diagnostics Panel ─────────────────────────────────────────

interface DiagnosticsPanelProps {
  doc: MotionDocument;
  frameState: FrameState | null;
}

function DiagnosticsPanel({ doc, frameState }: DiagnosticsPanelProps) {
  return (
    <div style={{ padding: '8px' }}>
      <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-muted)', marginBottom: '6px', textTransform: 'uppercase' }}>Document</div>
      <div style={{ fontSize: '10px', color: 'var(--color-subtle)', lineHeight: 1.6 }}>
        <div>Objects: {Object.keys(doc.objects).length}</div>
        <div>Root objects: {doc.rootObjectIds.length}</div>
        <div>Signals: {Object.keys(doc.signals).length}</div>
        <div>Rigs: {doc.rigs?.length ?? 0}</div>
        <div>Template: {doc.templateId ?? 'none'}</div>
        <div>Updated: {new Date(doc.updatedAt).toLocaleTimeString()}</div>
      </div>
      {frameState && (
        <>
          <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-muted)', margin: '10px 0 6px', textTransform: 'uppercase' }}>Evaluation</div>
          <div style={{ fontSize: '10px', color: 'var(--color-subtle)', lineHeight: 1.6 }}>
            <div>Time: {frameState.localTimeSecs.toFixed(3)}s (τ={frameState.tau.toFixed(3)})</div>
            <div>Objects: {frameState.objects.length}</div>
            <div>Keyframes: {frameState.diagnostics?.keyframeCount ?? 0}</div>
            <div>Behaviors: {frameState.diagnostics?.behaviorCount ?? 0}</div>
            <div>Signals: {frameState.diagnostics?.signalCount ?? 0}</div>
            <div>Eval time: {frameState.diagnostics?.evaluationTimeMs.toFixed(2) ?? 0}ms</div>
          </div>
          {(frameState.diagnostics?.warnings?.length ?? 0) > 0 && (
            <>
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-accent-3)', margin: '8px 0 4px' }}>Warnings</div>
              {frameState.diagnostics!.warnings.map((w, i) => <div key={i} style={{ fontSize: '9px', color: 'var(--color-accent-3)', marginBottom: '2px' }}>⚠ {w}</div>)}
            </>
          )}
          {(frameState.diagnostics?.errors?.length ?? 0) > 0 && (
            <>
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-danger)', margin: '8px 0 4px' }}>Errors</div>
              {frameState.diagnostics!.errors.map((e, i) => <div key={i} style={{ fontSize: '9px', color: 'var(--color-danger)', marginBottom: '2px' }}>✕ {e}</div>)}
            </>
          )}
        </>
      )}
      {frameState && Object.keys(frameState.signalValues).length > 0 && (
        <>
          <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-muted)', margin: '10px 0 6px', textTransform: 'uppercase' }}>Signal Values</div>
          {Object.entries(frameState.signalValues).map(([id, value]) => (
            <div key={id} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
              <span style={{ fontSize: '9px', color: 'var(--color-subtle)', flex: 1 }}>{doc.signals[id]?.name ?? id}</span>
              <div style={{ width: '60px', height: '4px', background: 'var(--color-well)', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ width: `${value * 100}%`, height: '100%', background: '#22D3EE', borderRadius: '2px' }} />
              </div>
              <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--color-fg)', minWidth: '28px', textAlign: 'right' }}>{value.toFixed(2)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
