'use client';

/**
 * CutLab Motion Animator Workspace
 *
 * The advanced animation authoring workspace.
 * Shares the SAME canonical project, MotionDocuments, history, and time truth as Studio.
 *
 * ALL data displayed here is derived from the canonical MotionDocument via
 * src/engine/motion-ui-adapter.ts — no mock/demo data in production paths.
 *
 * ALL persistent edits go through:
 *   MotionOp[] → MotionTransaction → motionTransactionToStudioOps → Studio dispatchBatch
 *
 * Ephemeral workspace state (mute/solo/collapse) is clearly separated and never persisted.
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useEngine } from '@/engine/store';
import {
  motionTransactionToStudioOps,
  studioTimeToMotionTime,
  motionLocalTimeToStudioSequenceTime,
  type MotionOpLike,
  type MotionTransactionLike,
} from '@/engine/motion-bridge';
import type { WorkspaceHandoff } from '@/engine/workspace-context';
import { buildReturnHandoff } from '@/engine/workspace-context';
import { buildAnalysisContract, contractToSignalValues } from '@/engine/analysis-contract';
import type {
  MotionDocument,
  MotionObject,
} from '@/engine/motion-document';


import { buildTrackViewModels, buildGraphCurveTracks, buildDopeSheetTracks, buildPropertyGroups, buildContributionTraceViewModel, buildCanvasRenderModel, buildTransportViewModel, buildEvalDiagnosticsViewModel, createEphemeralTrackState, toggleEphemeralMute, toggleEphemeralCollapse, createMotionSelectionState, selectObject, toggleKeyframeSelection, type EphemeralTrackState, type MotionSelectionState, type GraphCurveTrackViewModel, type DopeTrackViewModel, type CanvasRenderModel } from '@/engine/motion-ui-adapter';
import {
  motionTimeToSeconds,
  secondsToMotionTime,
  generateMotionId,
  resolveMotionDocument,
  evaluateMotionClip,
  makeOp,
  type FrameState,
} from '@/engine/motion-document-utils';
import type { MotionBehavior, MotionMaterial } from '@/engine/motion-document';

// ── Sub-panel imports ─────────────────────────────────────────
import TextMotionPanel from './TextMotionPanel';
import CreativeMacrosPanel from './CreativeMacrosPanel';
import SignalBindingPanel from './SignalBindingPanel';
import SpatialDepthPanel from './SpatialDepthPanel';
import SceneScriptPanel from './SceneScriptPanel';
import SignalResourcePanel from './SignalResourcePanel';

import MotionLibrary from './MotionLibrary';
import AICreativeOperatorPanel from './AICreativeOperatorPanel';
import LibraryPackagePanel from './LibraryPackagePanel';
import SVGPossibilityPanel from './SVGPossibilityPanel';


// ── Types ─────────────────────────────────────────────────────

type MATab =
  | 'objects' | 'properties' | 'text' | 'behaviors' | 'curves' | 'dope' | 'camera'
  | 'materials'| 'rigs' | 'signals' | 'resources' | 'trace' | 'scene' | 'library' |'macros' | 'spatial' | 'diagnostics' | 'ai' | 'packages' | 'svg';

interface MotionAnimatorWorkspaceProps {
  handoff: WorkspaceHandoff;
  onReturnToStudio: (returnHandoff: ReturnType<typeof buildReturnHandoff>) => void;
}

// ── Canvas Viewer ─────────────────────────────────────────────
// Driven by real CanvasRenderModel from buildCanvasRenderModel(doc, frameState)
// No hardcoded track-01/track-02/track-03 demo logic.

function MAViewer({
  renderModel,
  transport,
  playing,
  onSeek,
  onPlayToggle,
}: {
  renderModel: CanvasRenderModel;
  transport: ReturnType<typeof buildTransportViewModel>;
  playing: boolean;
  onSeek: (secs: number) => void;
  onPlayToggle: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0a0f' }}>
      {/* Canvas area */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
        <div
          style={{
            position: 'relative',
            width: '100%',
            maxWidth: '640px',
            aspectRatio: `${renderModel.width} / ${renderModel.height}`,
            background: 'linear-gradient(135deg, #111118 0%, #0d0d14 100%)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '4px',
            overflow: 'hidden',
          }}
        >
          {/* Render objects from real CanvasRenderModel */}
          {renderModel.objects.map((obj) => {
            const style: React.CSSProperties = {
              position: 'absolute',
              left: `${obj.leftPct}%`,
              top: `${obj.topPct}%`,
              transform: obj.cssTransform,
              opacity: obj.opacity,
              zIndex: obj.zIndex,
              pointerEvents: 'none',
              mixBlendMode: (obj.blendMode as React.CSSProperties['mixBlendMode']) ?? 'normal',
            };

            if (obj.kind === 'text') {
              return (
                <div
                  key={obj.id}
                  style={{
                    ...style,
                    color: obj.materialColor ?? '#fff',
                    fontSize: '24px',
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    textShadow: '0 2px 8px rgba(0,0,0,0.8)',
                  }}
                >
                  {obj.textContent ?? ''}
                </div>
              );
            }
            if (obj.kind === 'shape') {
              return (
                <div
                  key={obj.id}
                  style={{
                    ...style,
                    width: '80px',
                    height: '80px',
                    background: obj.materialColor
                      ? `${obj.materialColor}99`
                      : 'rgba(59,130,255,0.6)',
                    borderRadius: obj.materialType === 'glass' ? '8px' : '4px',
                  }}
                />
              );
            }
            if (obj.kind === 'camera') {
              return (
                <div
                  key={obj.id}
                  style={{
                    ...style,
                    width: '32px',
                    height: '32px',
                    background: 'rgba(100,116,139,0.4)',
                    borderRadius: '50%',
                    border: '1px solid rgba(100,116,139,0.6)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '14px',
                  }}
                >
                  📷
                </div>
              );
            }
            return (
              <div
                key={obj.id}
                style={{
                  ...style,
                  width: '60px',
                  height: '60px',
                  background: obj.materialColor
                    ? `${obj.materialColor}66`
                    : 'rgba(139,92,246,0.4)',
                  borderRadius: '50%',
                }}
              />
            );
          })}

          {/* Empty state */}
          {!renderModel.hasContent && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <div style={{ fontSize: '28px', opacity: 0.3 }}>⬡</div>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>No objects at this time</div>
            </div>
          )}

          {/* Time overlay */}
          <div style={{ position: 'absolute', top: '8px', right: '8px', fontSize: '10px', color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace', background: 'rgba(0,0,0,0.4)', padding: '2px 6px', borderRadius: '3px' }}>
            {transport.timecode} / {transport.durationTimecode}
          </div>

          {/* Renderer tier badge */}
          <div style={{ position: 'absolute', top: '8px', left: '8px', fontSize: '9px', color: 'rgba(139,92,246,0.8)', background: 'rgba(139,92,246,0.1)', padding: '2px 6px', borderRadius: '3px', border: '1px solid rgba(139,92,246,0.2)' }}>
            HYBRID 2.5D
          </div>
        </div>
      </div>

      {/* Transport controls */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(0,0,0,0.3)', flexShrink: 0 }}>
        <button
          onClick={onPlayToggle}
          style={{ background: 'rgba(59,130,255,0.15)', border: '1px solid rgba(59,130,255,0.3)', borderRadius: '4px', padding: '5px 10px', color: '#3b82ff', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
        >
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="1" width="3" height="10" rx="1"/><rect x="7" y="1" width="3" height="10" rx="1"/></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M2 1l9 5-9 5V1z"/></svg>
          )}
        </button>

        <div style={{ flex: 1, position: 'relative', height: '20px', display: 'flex', alignItems: 'center' }}>
          <div style={{ position: 'absolute', inset: '0 0 0 0', height: '4px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ width: `${transport.progress * 100}%`, height: '100%', background: 'rgba(59,130,255,0.7)', borderRadius: '2px', transition: 'width 50ms linear' }} />
          </div>
          <input
            type="range"
            min={0}
            max={transport.durationSecs}
            step={1 / transport.fps}
            value={transport.localTimeSecs}
            onChange={(e) => onSeek(parseFloat(e.target.value))}
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%' }}
            aria-label="Motion Animator scrubber"
          />
        </div>

        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace', minWidth: '80px', textAlign: 'right' }}>
          {transport.timecode}
        </div>

        {/* Note: authoring-local transport — Studio remains sequence time authority */}
        <div
          style={{ fontSize: '9px', color: 'rgba(255,255,255,0.2)', marginLeft: '4px' }}
          title="Motion Animator transport is for authoring convenience. Studio timeline remains the sequence time authority."
        >
          clip-local
        </div>
      </div>
    </div>
  );
}

// ── Object Hierarchy Panel ────────────────────────────────────
// Driven by real TrackViewModel from buildTrackViewModels()
// visible/locked map to canonical MotionObject.visible / MotionObject.locked

function ObjectHierarchyPanel({
  doc,
  selection,
  ephemeralState,
  onSelectObject,
  onToggleVisible,
  onToggleLocked,
  onToggleMute,
  onToggleCollapse,
}: {
  doc: MotionDocument;
  selection: MotionSelectionState;
  ephemeralState: EphemeralTrackState;
  onSelectObject: (id: string) => void;
  onToggleVisible: (id: string, currentValue: boolean) => void;
  onToggleLocked: (id: string, currentValue: boolean) => void;
  onToggleMute: (id: string) => void;
  onToggleCollapse: (id: string) => void;
}) {
  const { tracks, flatOrder } = useMemo(
    () => buildTrackViewModels(doc, selection.selectedObjectId, ephemeralState),
    [doc, selection.selectedObjectId, ephemeralState]
  );

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ padding: '6px 8px', fontSize: '10px', color: 'var(--color-muted)', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>OBJECTS ({Object.keys(doc.objects).length})</span>
        <span style={{ color: 'var(--color-subtle)', fontSize: '9px' }}>{doc.name}</span>
      </div>

      {flatOrder.length === 0 ? (
        <div style={{ padding: '16px', textAlign: 'center', fontSize: '11px', color: 'var(--color-muted)' }}>No objects</div>
      ) : (
        flatOrder.map((id) => {
          const track = tracks[id];
          if (!track) return null;
          const isSelected = track.selected;
          const isMuted = track.ephemeralMuted;

          return (
            <div
              key={id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: `3px 6px 3px ${6 + track.hierarchyDepth * 12}px`,
                background: isSelected ? 'rgba(59,130,255,0.14)' : 'transparent',
                borderLeft: isSelected ? '2px solid var(--color-accent)' : '2px solid transparent',
                opacity: isMuted ? 0.4 : 1,
              }}
            >
              {/* Collapse toggle for groups */}
              {track.childIds.length > 0 && (
                <button
                  onClick={() => onToggleCollapse(id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', padding: '0 2px', fontSize: '9px' }}
                  title={track.collapsed ? 'Expand' : 'Collapse'}
                >
                  {track.collapsed ? '▶' : '▼'}
                </button>
              )}
              {track.childIds.length === 0 && <div style={{ width: '14px' }} />}

              {/* Kind icon */}
              <span style={{ opacity: 0.5, fontSize: '10px', flexShrink: 0 }}>
                {track.objectKind === 'text' ? 'T' : track.objectKind === 'group' ? '⊞' : track.kind === 'camera' ? '📷' : track.objectKind === 'shape' ? '◻' : track.objectKind === 'svg' ? '⬡' : track.kind === 'signal' ? '~' : '○'}
              </span>

              {/* Name — click to select */}
              <button
                onClick={() => onSelectObject(id)}
                style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', color: isSelected ? 'var(--color-accent)' : 'var(--color-fg)', fontSize: '11px', textAlign: 'left', fontFamily: 'var(--font-sans)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: 0 }}
              >
                {track.label}
              </button>

              {/* Keyframe count badge */}
              {track.keyframeCount > 0 && (
                <span style={{ fontSize: '9px', color: 'var(--color-accent)', background: 'rgba(59,130,255,0.1)', padding: '1px 4px', borderRadius: '3px', flexShrink: 0 }}>
                  {track.keyframeCount}
                </span>
              )}

              {/* Visibility — maps to canonical MotionObject.visible */}
              {track.kind === 'object' && (
                <button
                  onClick={() => onToggleVisible(id, track.visible)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: track.visible ? 'var(--color-muted)' : 'rgba(255,255,255,0.2)', padding: '0 2px', fontSize: '10px', flexShrink: 0 }}
                  title={track.visible ? 'Hide object (canonical)' : 'Show object (canonical)'}
                >
                  {track.visible ? '👁' : '🚫'}
                </button>
              )}

              {/* Lock — maps to canonical MotionObject.locked */}
              {track.kind === 'object' && (
                <button
                  onClick={() => onToggleLocked(id, track.locked)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: track.locked ? '#f59e0b' : 'rgba(255,255,255,0.2)', padding: '0 2px', fontSize: '10px', flexShrink: 0 }}
                  title={track.locked ? 'Unlock object (canonical)' : 'Lock object (canonical)'}
                >
                  {track.locked ? '🔒' : '🔓'}
                </button>
              )}

              {/* Mute — ephemeral workspace state only, never persisted */}
              {track.kind === 'object' && (
                <button
                  onClick={() => onToggleMute(id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: isMuted ? '#ef4444' : 'rgba(255,255,255,0.2)', padding: '0 2px', fontSize: '9px', flexShrink: 0 }}
                  title="Mute (ephemeral workspace state — not persisted)"
                >
                  M
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// ── Properties Panel ──────────────────────────────────────────
// Driven by real PropertyGroupViewModel from buildPropertyGroups()
// Edits produce canonical MotionOps

function PropertiesPanel({
  doc,
  selectedObject,
  playheadSecs,
  fps,
  onApplyOps,
}: {
  doc: MotionDocument;
  selectedObject: MotionObject | null;
  playheadSecs: number;
  fps: number;
  onApplyOps: (ops: ReturnType<typeof makeOp>[], description: string) => void;
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set(['behaviors', 'masks']));

  if (!selectedObject) {
    return (
      <div style={{ padding: '16px', textAlign: 'center', fontSize: '11px', color: 'var(--color-muted)' }}>
        Select an object to edit properties
      </div>
    );
  }

  // Build property groups from canonical object — no local copy
  const groups = buildPropertyGroups(selectedObject, doc.id);
  const t = selectedObject.transform;
  const isLocked = selectedObject.locked === true;

  const updateTransform = (prop: string, value: number) => {
    if (isLocked) return; // fail closed — mirror of the canonical locked guard
    // Engine uses flat transform: x, y, z, scaleX, scaleY, rotationZ, opacity, etc.
    const newTransform = { ...t, [prop]: value };
    onApplyOps(
      [makeOp('motion.setObjectTransform', doc.id, { objectId: selectedObject.id, transform: newTransform })],
      `Set ${selectedObject.name} ${prop}`
    );
  };

  const updateProp = (key: string, value: unknown) => {
    if (isLocked && key !== 'locked') return; // fail closed
    onApplyOps(
      [makeOp('motion.setObjectProp', doc.id, { objectId: selectedObject.id, props: { [key]: value } })],
      `Set ${selectedObject.name} ${key}`
    );
  };

  // ── Keyframe toggle (◆) ───────────────────────────────────
  // If a keyframe for this property exists at the current playhead time,
  // remove it; otherwise upsert one with the property's current value.
  // One click = one MotionOp = one Studio history entry.
  const keyframeAtPlayhead = (property: string) =>
    selectedObject.keyframes.find(
      (k) => k.property === property && Math.abs(motionTimeToSeconds(k.time) - playheadSecs) < 0.5 / fps
    );

  const toggleKeyframe = (property: string, value: number) => {
    if (isLocked) return; // fail closed
    const existing = keyframeAtPlayhead(property);
    if (existing) {
      onApplyOps(
        [makeOp('motion.keyframe.remove', doc.id, { objectId: selectedObject.id, keyframeId: existing.id })],
        `Remove ${property} keyframe`
      );
    } else {
      const kf = {
        id: generateMotionId('mkf'),
        time: secondsToMotionTime(playheadSecs),
        property,
        value,
        easing: 'ease-in-out' as const,
      };
      onApplyOps(
        [makeOp('motion.keyframe.upsert', doc.id, { objectId: selectedObject.id, keyframe: kf })],
        `Keyframe ${selectedObject.name} ${property}`
      );
    }
  };

  const toggleGroupCollapse = (groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ padding: '6px 8px', fontSize: '10px', color: 'var(--color-muted)', borderBottom: '1px solid var(--color-border)' }}>
        INSPECTOR — {selectedObject.name}
        <span style={{ marginLeft: '6px', fontSize: '9px', color: 'var(--color-subtle)' }}>{selectedObject.kind}</span>
      </div>

      {isLocked && (
        <div style={{ margin: '6px 8px', padding: '5px 8px', fontSize: '10px', color: '#f59e0b', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: '4px' }}>
          🔒 Locked — content edits are blocked. Toggle Locked OFF to edit.
        </div>
      )}

      {groups.map((group) => {
        const isCollapsed = collapsedGroups.has(group.id);
        return (
          <div key={group.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
            <button
              onClick={() => toggleGroupCollapse(group.id)}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', padding: '4px 8px', background: 'rgba(255,255,255,0.02)', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'left', fontFamily: 'var(--font-sans)' }}
            >
              <span style={{ fontSize: '8px' }}>{isCollapsed ? '▶' : '▼'}</span>
              {group.label}
            </button>

            {!isCollapsed && (
              <div style={{ padding: '2px 0' }}>
                {group.properties.map((prop) => {
                  if (prop.type === 'boolean') {
                    const boolVal = prop.key === 'visible' ? selectedObject.visible : selectedObject.locked;
                    // The locked toggle must stay editable even when locked
                    // (otherwise the object could never be unlocked).
                    const boolDisabled = isLocked && prop.key !== 'locked';
                    return (
                      <div key={prop.key} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 8px' }}>
                        <span style={{ fontSize: '10px', color: 'var(--color-muted)', flex: 1 }}>{prop.label}</span>
                        <button
                          onClick={() => updateProp(prop.key, !boolVal)}
                          disabled={boolDisabled}
                          style={{ background: boolVal ? 'rgba(59,130,255,0.2)' : 'var(--color-well)', border: `1px solid ${boolVal ? 'rgba(59,130,255,0.4)' : 'var(--color-border)'}`, borderRadius: '3px', padding: '2px 8px', fontSize: '10px', color: boolVal ? '#3b82ff' : 'var(--color-muted)', cursor: boolDisabled ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-sans)', opacity: boolDisabled ? 0.5 : 1 }}
                        >
                          {boolVal ? 'ON' : 'OFF'}
                        </button>
                      </div>
                    );
                  }

                  if (prop.type === 'string') {
                    return (
                      <div key={prop.key} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 8px' }}>
                        <span style={{ fontSize: '10px', color: 'var(--color-muted)', width: '60px', flexShrink: 0 }}>{prop.label}</span>
                        <span style={{ flex: 1, fontSize: '10px', color: 'var(--color-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(prop.value)}</span>
                      </div>
                    );
                  }

                  // Number
                  const numVal = typeof prop.value === 'number' ? prop.value : 0;
                  const hasKfHere = !!keyframeAtPlayhead(prop.key);
                  return (
                    <div key={prop.key} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 8px' }}>
                      <span style={{ fontSize: '10px', color: prop.hasKeyframes ? 'var(--color-accent)' : 'var(--color-muted)', width: '60px', flexShrink: 0 }}>
                        {prop.label}
                        {prop.hasKeyframes && <span style={{ marginLeft: '3px', fontSize: '8px' }}>◆</span>}
                      </span>
                      <input
                        type="number"
                        value={numVal.toFixed(prop.step && prop.step < 0.1 ? 3 : 2)}
                        min={prop.min}
                        max={prop.max}
                        step={prop.step ?? 0.1}
                        disabled={isLocked}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value) || 0;
                          if (prop.opType === 'motion.setObjectTransform') {
                            updateTransform(prop.key, v);
                          } else {
                            updateProp(prop.key, v);
                          }
                        }}
                        style={{ flex: 1, background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px', padding: '2px 5px', fontSize: '11px', color: 'var(--color-fg)', fontFamily: 'monospace', opacity: isLocked ? 0.5 : 1 }}
                        aria-label={prop.label}
                      />
                      <button
                        onClick={() => toggleKeyframe(prop.key, numVal)}
                        disabled={isLocked}
                        title={hasKfHere ? 'Remove keyframe at playhead' : 'Add keyframe at playhead'}
                        aria-label={`Toggle keyframe for ${prop.label}`}
                        style={{ background: hasKfHere ? 'rgba(139,92,246,0.3)' : 'rgba(139,92,246,0.08)', border: `1px solid ${hasKfHere ? 'rgba(139,92,246,0.6)' : 'rgba(139,92,246,0.2)'}`, borderRadius: '3px', color: hasKfHere ? '#c4b5fd' : 'var(--color-subtle)', fontSize: '9px', padding: '2px 5px', cursor: isLocked ? 'not-allowed' : 'pointer', flexShrink: 0, opacity: isLocked ? 0.4 : 1 }}
                      >
                        {hasKfHere ? '◆' : '◇'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Graph Curve Editor ────────────────────────────────────────
// Driven by real GraphCurveTrackViewModel from buildGraphCurveTracks()
// Edits produce canonical MotionOps (motion.keyframe.move / setEasing / remove)
// Drag: draft during drag (local visual only), ONE commit on release.

const EASING_OPTIONS = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold', 'spring', 'bounce', 'elastic'] as const;

interface KfDragState {
  keyframeId: string;
  property: string;
  draftTimeSecs: number;
}

function CurveEditor({
  doc,
  selectedObject,
  selection,
  onApplyOps,
  onToggleKeyframe,
}: {
  doc: MotionDocument;
  selectedObject: MotionObject | null;
  selection: MotionSelectionState;
  onApplyOps: (ops: ReturnType<typeof makeOp>[], description: string) => void;
  onToggleKeyframe: (kfId: string, additive: boolean) => void;
}) {
  // Draft-only drag state — never canonical until committed on release
  const [kfDrag, setKfDrag] = useState<KfDragState | null>(null);
  const graphAreaRef = useRef<HTMLDivElement>(null);

  const durationSecs = motionTimeToSeconds(doc.duration);
  const isLocked = selectedObject?.locked === true;
  // Build real curve tracks from canonical keyframes — no DEMO_TRACKS
  const curveTracks = useMemo(
    () => selectedObject ? buildGraphCurveTracks(selectedObject, durationSecs, selection.selectedCurveTrackIds) : [],
    [selectedObject, durationSecs, selection.selectedCurveTrackIds]
  );

  if (!selectedObject) {
    return (
      <div style={{ padding: '16px', textAlign: 'center', fontSize: '11px', color: 'var(--color-muted)' }}>
        Select an object to view curves
      </div>
    );
  }

  const commitMove = (drag: KfDragState) => {
    if (isLocked) return; // fail closed
    const clamped = Math.max(0, Math.min(durationSecs, drag.draftTimeSecs));
    onApplyOps(
      [makeOp('motion.keyframe.move', doc.id, {
        objectId: selectedObject.id,
        keyframeId: drag.keyframeId,
        newTime: secondsToMotionTime(clamped),
      })],
      `Move keyframe to ${clamped.toFixed(2)}s`
    );
  };

  const handleDragMove = (clientX: number) => {
    if (!kfDrag) return;
    const rect = graphAreaRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || durationSecs <= 0) return;
    const normX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setKfDrag({ ...kfDrag, draftTimeSecs: normX * durationSecs });
  };

  const setEasing = (keyframeId: string, easing: string) => {
    if (isLocked) return; // fail closed
    onApplyOps(
      [makeOp('motion.keyframe.setEasing', doc.id, { objectId: selectedObject.id, keyframeId, easing })],
      'Set keyframe easing'
    );
  };

  const removeKeyframe = (keyframeId: string) => {
    if (isLocked) return; // fail closed
    onApplyOps(
      [makeOp('motion.keyframe.remove', doc.id, { objectId: selectedObject.id, keyframeId })],
      'Remove keyframe'
    );
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ padding: '6px 8px', fontSize: '10px', color: 'var(--color-muted)', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between' }}>
        <span>GRAPH EDITOR — {selectedObject.name}</span>
        <span style={{ fontSize: '9px', color: 'var(--color-subtle)' }}>{curveTracks.length} tracks</span>
      </div>

      {isLocked && (
        <div style={{ margin: '6px 8px', padding: '5px 8px', fontSize: '10px', color: '#f59e0b', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: '4px' }}>
          🔒 Locked — keyframe edits are blocked.
        </div>
      )}

      {curveTracks.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center' }}>
          <div style={{ fontSize: '11px', color: 'var(--color-muted)', marginBottom: '8px' }}>No keyframes on this object</div>
          <div style={{ fontSize: '10px', color: 'var(--color-subtle)' }}>Add keyframes with the ◇ button in the Props panel</div>
        </div>
      ) : (
        curveTracks.map((track) => (
          <div key={track.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div style={{ padding: '4px 8px', fontSize: '10px', color: track.color, background: `${track.color}0d`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{track.label}</span>
              <span style={{ fontSize: '9px', color: 'var(--color-subtle)' }}>
                {track.valueMin.toFixed(2)} → {track.valueMax.toFixed(2)}
              </span>
            </div>

            {/* Curve visualization — pointer handlers draft locally, commit on release */}
            <div
              ref={graphAreaRef}
              style={{ position: 'relative', height: '60px', margin: '4px 8px', background: 'var(--color-well)', borderRadius: '3px', overflow: 'hidden', touchAction: 'none' }}
              onPointerMove={(e) => { if (kfDrag) { e.preventDefault(); handleDragMove(e.clientX); } }}
              onPointerUp={() => { if (kfDrag) { commitMove(kfDrag); setKfDrag(null); } }}
              onPointerLeave={() => { if (kfDrag) { commitMove(kfDrag); setKfDrag(null); } }}
            >
              <svg width="100%" height="100%" viewBox="0 0 300 60" preserveAspectRatio="none">
                {/* Grid */}
                <line x1="0" y1="30" x2="300" y2="30" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                <line x1="0" y1="15" x2="300" y2="15" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                <line x1="0" y1="45" x2="300" y2="45" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />

                {/* Curve line (draft position while dragging) */}
                {track.keyframes.length > 1 && (
                  <polyline
                    points={track.keyframes.map((kf) => {
                      const t = kfDrag && kfDrag.keyframeId === kf.id ? kfDrag.draftTimeSecs : kf.timeSecs;
                      const normX = durationSecs > 0 ? Math.max(0, Math.min(1, t / durationSecs)) : 0;
                      return `${normX * 300},${(1 - kf.normalizedY) * 60}`;
                    }).join(' ')}
                    fill="none"
                    stroke={`${track.color}80`}
                    strokeWidth="1.5"
                  />
                )}

                {/* Keyframe dots */}
                {track.keyframes.map((kf) => {
                  const t = kfDrag && kfDrag.keyframeId === kf.id ? kfDrag.draftTimeSecs : kf.timeSecs;
                  const normX = durationSecs > 0 ? Math.max(0, Math.min(1, t / durationSecs)) : 0;
                  const cx = normX * 300;
                  const cy = (1 - kf.normalizedY) * 60;
                  const isKfSelected = selection.selectedKeyframeIds.has(kf.id) || kfDrag?.keyframeId === kf.id;
                  return (
                    <circle
                      key={kf.id}
                      cx={cx}
                      cy={cy}
                      r={isKfSelected ? 5 : 3}
                      fill={isKfSelected ? '#fff' : track.color}
                      stroke={isKfSelected ? track.color : 'none'}
                      strokeWidth="1.5"
                      style={{ cursor: isLocked ? 'not-allowed' : 'grab' }}
                      onClick={(e) => onToggleKeyframe(kf.id, e.shiftKey)}
                      onPointerDown={(e) => {
                        if (isLocked) return;
                        e.preventDefault();
                        onToggleKeyframe(kf.id, e.shiftKey);
                        setKfDrag({ keyframeId: kf.id, property: track.property, draftTimeSecs: kf.timeSecs });
                      }}
                    />
                  );
                })}
              </svg>
            </div>

            {/* Keyframe list — easing + delete are canonical edits */}
            {track.keyframes.map((kf) => (
              <div
                key={kf.id}
                style={{
                  display: 'flex',
                  gap: '6px',
                  padding: '2px 8px',
                  fontSize: '10px',
                  alignItems: 'center',
                  color: selection.selectedKeyframeIds.has(kf.id) ? 'var(--color-fg)' : 'var(--color-muted)',
                  background: selection.selectedKeyframeIds.has(kf.id) ? 'rgba(59,130,255,0.08)' : 'transparent',
                  cursor: 'pointer',
                }}
                onClick={(e) => onToggleKeyframe(kf.id, e.shiftKey)}
              >
                <span style={{ fontFamily: 'monospace', color: track.color, minWidth: '40px' }}>
                  {(kfDrag && kfDrag.keyframeId === kf.id ? kfDrag.draftTimeSecs : kf.timeSecs).toFixed(2)}s
                </span>
                <span style={{ flex: 1 }}>{kf.value.toFixed(3)}</span>
                <select
                  value={kf.easing}
                  disabled={isLocked}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setEasing(kf.id, e.target.value)}
                  style={{ background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px', color: 'var(--color-fg)', fontSize: '9px', padding: '1px 3px', fontFamily: 'var(--font-sans)', opacity: isLocked ? 0.5 : 1 }}
                  aria-label={`Easing for keyframe at ${kf.timeSecs.toFixed(2)}s`}
                >
                  {EASING_OPTIONS.map((ez) => <option key={ez} value={ez}>{ez}</option>)}
                </select>
                <button
                  onClick={(e) => { e.stopPropagation(); removeKeyframe(kf.id); }}
                  disabled={isLocked}
                  title="Delete keyframe"
                  aria-label={`Delete keyframe at ${kf.timeSecs.toFixed(2)}s`}
                  style={{ background: 'none', border: 'none', cursor: isLocked ? 'not-allowed' : 'pointer', color: 'var(--color-danger)', fontSize: '11px', padding: '0 2px', opacity: isLocked ? 0.4 : 1 }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

// ── Dope Sheet ────────────────────────────────────────────────
// Driven by real DopeTrackViewModel from buildDopeSheetTracks()
// Keyframe clicks seek the transport (clip-local time)

function DopeSheet({
  doc,
  selection,
  playheadSecs,
  onSeek,
  onSelectObject,
}: {
  doc: MotionDocument;
  selection: MotionSelectionState;
  playheadSecs: number;
  onSeek: (secs: number) => void;
  onSelectObject: (id: string) => void;
}) {
  const durationSecs = motionTimeToSeconds(doc.duration);
  const ephemeral = useMemo(() => createEphemeralTrackState(), []);

  // Build real dope sheet tracks from canonical data — no synthetic demo keyframes
  const dopeTracks = useMemo(
    () => buildDopeSheetTracks(doc, selection.selectedObjectId, durationSecs, ephemeral),
    [doc, selection.selectedObjectId, durationSecs]
  );

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ padding: '6px 8px', fontSize: '10px', color: 'var(--color-muted)', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between' }}>
        <span>DOPE SHEET</span>
        <span style={{ fontFamily: 'monospace', color: 'var(--color-accent)' }}>{playheadSecs.toFixed(2)}s</span>
      </div>

      {/* Timeline header */}
      <div style={{ position: 'relative', height: '20px', background: 'var(--color-well)', borderBottom: '1px solid var(--color-border)', overflow: 'hidden' }}>
        {durationSecs > 0 && Array.from({ length: Math.min(Math.ceil(durationSecs) + 1, 20) }, (_, i) => (
          <div key={i} style={{ position: 'absolute', left: `${(i / durationSecs) * 100}%`, top: 0, bottom: 0, borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: '2px', fontSize: '8px', color: 'rgba(255,255,255,0.3)', lineHeight: '20px' }}>
            {i}s
          </div>
        ))}
        {/* Playhead */}
        {durationSecs > 0 && (
          <div style={{ position: 'absolute', left: `${(playheadSecs / durationSecs) * 100}%`, top: 0, bottom: 0, width: '1px', background: '#3b82ff', zIndex: 2 }} />
        )}
      </div>

      {/* Track rows — driven by real canonical data */}
      {dopeTracks.map((track) => (
        <div
          key={track.id}
          style={{
            display: 'flex',
            borderBottom: '1px solid rgba(255,255,255,0.04)',
            height: '28px',
            alignItems: 'center',
            background: track.selected ? 'rgba(59,130,255,0.06)' : 'transparent',
          }}
        >
          {/* Label */}
          <button
            onClick={() => onSelectObject(track.id)}
            style={{
              width: '120px',
              flexShrink: 0,
              padding: `0 8px 0 ${8 + track.hierarchyDepth * 10}px`,
              fontSize: '10px',
              color: track.selected ? 'var(--color-accent)' : 'var(--color-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              borderRight: '1px solid var(--color-border)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: 'var(--font-sans)',
            }}
          >
            {track.label}
          </button>

          {/* Keyframe dots + behavior bars */}
          <div style={{ flex: 1, position: 'relative', height: '100%' }}>
            {/* Behavior bars */}
            {track.behaviors.map((beh) => (
              <div
                key={beh.id}
                style={{
                  position: 'absolute',
                  left: `${beh.normalizedStart * 100}%`,
                  width: `${Math.max((beh.normalizedEnd - beh.normalizedStart) * 100, 0.5)}%`,
                  top: '25%',
                  height: '50%',
                  background: `${beh.color}33`,
                  borderRadius: '2px',
                  border: `1px solid ${beh.color}66`,
                }}
                title={`${beh.type}: ${beh.startSecs.toFixed(1)}s → ${beh.endSecs.toFixed(1)}s`}
              />
            ))}

            {/* Keyframe diamonds */}
            {track.keyframes.map((kf) => (
              <div
                key={kf.id}
                style={{
                  position: 'absolute',
                  left: `${kf.normalizedX * 100}%`,
                  top: '50%',
                  transform: 'translate(-50%, -50%) rotate(45deg)',
                  width: '7px',
                  height: '7px',
                  background: selection.selectedKeyframeIds.has(kf.id) ? '#fff' : '#3b82ff',
                  cursor: 'pointer',
                  zIndex: 1,
                }}
                title={`${kf.property} @ ${kf.timeSecs.toFixed(2)}s`}
                onClick={() => onSeek(kf.timeSecs)}
              />
            ))}

            {/* Playhead line */}
            {durationSecs > 0 && (
              <div style={{ position: 'absolute', left: `${(playheadSecs / durationSecs) * 100}%`, top: 0, bottom: 0, width: '1px', background: 'rgba(59,130,255,0.4)', pointerEvents: 'none' }} />
            )}
          </div>
        </div>
      ))}

      {dopeTracks.length === 0 && (
        <div style={{ padding: '16px', textAlign: 'center', fontSize: '11px', color: 'var(--color-muted)' }}>No tracks</div>
      )}
    </div>
  );
}

// ── Behaviors Panel ───────────────────────────────────────────

function BehaviorsPanel({
  doc,
  selectedObject,
  onApplyOps,
}: {
  doc: MotionDocument;
  selectedObject: MotionObject | null;
  onApplyOps: (ops: ReturnType<typeof makeOp>[], description: string) => void;
}) {
  if (!selectedObject) {
    return (
      <div style={{ padding: '16px', textAlign: 'center', fontSize: '11px', color: 'var(--color-muted)' }}>
        Select an object to manage behaviors
      </div>
    );
  }

  const behaviors = selectedObject.behaviors ?? [];
  const isLocked = selectedObject.locked === true;

  const BEHAVIOR_PRESETS = [
    { type: 'fade-in', label: 'Fade In', color: '#3b82ff' },
    { type: 'fade-out', label: 'Fade Out', color: '#3b82ff' },
    { type: 'slide-in', label: 'Slide In', color: '#10b981' },
    { type: 'scale-in', label: 'Scale In', color: '#10b981' },
    { type: 'bounce-in', label: 'Bounce In', color: '#f59e0b' },
    { type: 'word-by-word', label: 'Word by Word', color: '#8b5cf6' },
    { type: 'wave', label: 'Wave', color: '#8b5cf6' },
    { type: 'pulse', label: 'Pulse', color: '#ef4444' },
    { type: 'signal-reactive', label: 'Signal Reactive', color: '#06b6d4' },
  ] as const;

  const addBehavior = (type: string) => {
    if (isLocked) return; // fail closed
    const beh: MotionBehavior = {
      id: generateMotionId('beh'),
      type: type as MotionBehavior['type'],
      startTime: secondsToMotionTime(0),
      duration: secondsToMotionTime(1),
      params: {},
      easing: 'ease-out',
    };
    onApplyOps(
      [makeOp('motion.addBehavior', doc.id, { objectId: selectedObject.id, behavior: beh })],
      `Add ${type} behavior`
    );
  };

  const removeBehavior = (behaviorId: string) => {
    if (isLocked) return; // fail closed
    onApplyOps(
      [makeOp('motion.removeBehavior', doc.id, { objectId: selectedObject.id, behaviorId })],
      `Remove behavior`
    );
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ padding: '6px 8px', fontSize: '10px', color: 'var(--color-muted)', borderBottom: '1px solid var(--color-border)' }}>
        BEHAVIORS — {selectedObject.name}
      </div>

      {behaviors.length > 0 && (
        <div style={{ padding: '6px 8px' }}>
          <div style={{ fontSize: '9px', color: 'var(--color-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Active ({behaviors.length})</div>
          {behaviors.map((beh) => (
            <div key={beh.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 6px', background: 'var(--color-well)', borderRadius: '4px', marginBottom: '3px', border: '1px solid var(--color-border)' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#8b5cf6', flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: '11px', color: 'var(--color-fg)' }}>{beh.type}</span>
              <span style={{ fontSize: '10px', color: 'var(--color-muted)', fontFamily: 'monospace' }}>
                {motionTimeToSeconds(beh.startTime).toFixed(1)}s → {(motionTimeToSeconds(beh.startTime) + motionTimeToSeconds(beh.duration)).toFixed(1)}s
              </span>
              <button
                onClick={() => removeBehavior(beh.id)}
                disabled={isLocked}
                style={{ background: 'none', border: 'none', cursor: isLocked ? 'not-allowed' : 'pointer', color: 'rgba(255,255,255,0.3)', fontSize: '12px', padding: '0 2px', opacity: isLocked ? 0.4 : 1 }}
                title={isLocked ? 'Locked — behavior edits are blocked' : 'Remove behavior'}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ padding: '6px 8px', borderTop: behaviors.length > 0 ? '1px solid var(--color-border)' : 'none' }}>
        <div style={{ fontSize: '9px', color: 'var(--color-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Add Behavior</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {BEHAVIOR_PRESETS.map((preset) => (
            <button
              key={preset.type}
              onClick={() => addBehavior(preset.type)}
              disabled={isLocked}
              style={{ background: 'var(--color-well)', border: `1px solid ${preset.color}30`, borderRadius: '4px', padding: '4px 8px', fontSize: '10px', color: preset.color, cursor: isLocked ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-sans)', opacity: isLocked ? 0.4 : 1 }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Materials Panel ───────────────────────────────────────────

function MaterialsPanel({
  doc,
  selectedObject,
  onApplyOps,
}: {
  doc: MotionDocument;
  selectedObject: MotionObject | null;
  onApplyOps: (ops: ReturnType<typeof makeOp>[], description: string) => void;
}) {
  if (!selectedObject) {
    return (
      <div style={{ padding: '16px', textAlign: 'center', fontSize: '11px', color: 'var(--color-muted)' }}>
        Select an object to edit materials
      </div>
    );
  }

  // Engine uses materialId reference — resolve from doc.materials
  const material = selectedObject.materialId ? doc.materials[selectedObject.materialId] : null;
  const MATERIAL_PRESETS = [
    { id: 'flat', label: 'Flat', color: '#fff' },
    { id: 'gradient', label: 'Gradient', color: '#3b82ff' },
    { id: 'glass', label: 'Glass', color: '#06b6d4' },
    { id: 'metal', label: 'Metal', color: '#94a3b8' },
    { id: 'neon', label: 'Neon', color: '#a855f7' },
    { id: 'chrome', label: 'Chrome', color: '#e2e8f0' },
    { id: 'paper', label: 'Paper', color: '#d97706' },
    { id: 'projector', label: 'Projector', color: '#10b981' },
  ];

  const isLocked = selectedObject.locked === true;

  const setMaterial = (type: string) => {
    if (isLocked) return; // fail closed
    const mat: MotionMaterial = {
      id: generateMotionId('mat'),
      name: type,
      type: type as MotionMaterial['type'],
      color: '#ffffff',
    };
    onApplyOps(
      [makeOp('motion.setMaterial', doc.id, { objectId: selectedObject.id, material: mat })],
      `Set ${selectedObject.name} material: ${type}`
    );
  };

  // material.color is a string (hex) in MotionMaterial
  const materialColorHex = material?.color ?? '#ffffff';

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ padding: '6px 8px', fontSize: '10px', color: 'var(--color-muted)', borderBottom: '1px solid var(--color-border)' }}>
        MATERIALS — {selectedObject.name}
      </div>

      {material && (
        <div style={{ padding: '8px', borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ fontSize: '9px', color: 'var(--color-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Current</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', background: 'var(--color-well)', borderRadius: '4px', border: '1px solid var(--color-border)' }}>
            <div style={{ width: '24px', height: '24px', borderRadius: '4px', background: materialColorHex, border: '1px solid rgba(255,255,255,0.1)' }} />
            <div>
              <div style={{ fontSize: '11px', color: 'var(--color-fg)' }}>{material.type}</div>
              <div style={{ fontSize: '10px', color: 'var(--color-muted)' }}>{material.name}</div>
            </div>
          </div>
        </div>
      )}

      <div style={{ padding: '8px' }}>
        <div style={{ fontSize: '9px', color: 'var(--color-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Presets</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
          {MATERIAL_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => setMaterial(preset.id)}
              disabled={isLocked}
              style={{ background: 'var(--color-well)', border: `1px solid ${material?.type === preset.id ? preset.color : 'var(--color-border)'}`, borderRadius: '4px', padding: '6px 4px', fontSize: '9px', color: material?.type === preset.id ? preset.color : 'var(--color-muted)', cursor: isLocked ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-sans)', textAlign: 'center', opacity: isLocked ? 0.4 : 1 }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {material && (
        <div style={{ padding: '8px', borderTop: '1px solid var(--color-border)' }}>
          <div style={{ fontSize: '9px', color: 'var(--color-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Color</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="color"
              value={materialColorHex}
              disabled={isLocked}
              onChange={(e) => {
                if (isLocked) return; // fail closed
                const updatedMat = { ...material, color: e.target.value };
                onApplyOps([makeOp('motion.setMaterial', doc.id, { objectId: selectedObject.id, material: updatedMat })], `Set ${selectedObject.name} color`);
              }}
              style={{ width: '32px', height: '32px', border: 'none', borderRadius: '4px', cursor: isLocked ? 'not-allowed' : 'pointer', background: 'none', opacity: isLocked ? 0.4 : 1 }}
              aria-label="Material color"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Contribution Trace Panel ──────────────────────────────────
// Driven by real ContributionTracePanelViewModel from buildContributionTraceViewModel()
// No MOCK_TRACE in production.

function ContributionTracePanel({ doc }: { doc: MotionDocument }) {
  // Build real trace view model from canonical doc.contributionTrace
  const traceVM = useMemo(() => buildContributionTraceViewModel(doc), [doc]);

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '8px' }}>
      <div style={{ fontSize: '10px', color: 'var(--color-muted)', marginBottom: '8px', borderBottom: '1px solid var(--color-border)', paddingBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
        <span>CONTRIBUTION TRACE</span>
        {traceVM.hasTrace && (
          <span style={{ fontSize: '9px', color: 'var(--color-subtle)' }}>{traceVM.totalOps} ops total</span>
        )}
      </div>

      {!traceVM.hasTrace ? (
        <div style={{ padding: '16px', textAlign: 'center', fontSize: '11px', color: 'var(--color-muted)' }}>
          <div style={{ marginBottom: '4px' }}>No trace data yet</div>
          <div style={{ fontSize: '10px', color: 'var(--color-subtle)' }}>Trace is populated as edits are made</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {traceVM.nodes.map((node) => (
            <div
              key={node.id}
              style={{
                padding: '6px 8px',
                background: node.isLatest ? 'rgba(59,130,255,0.06)' : 'var(--color-well)',
                borderRadius: '4px',
                border: `1px solid ${node.isLatest ? 'rgba(59,130,255,0.2)' : 'var(--color-border)'}`,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                <span style={{ fontSize: '10px', color: node.actorColor, fontWeight: 600 }}>{node.actor}</span>
                <span style={{ fontSize: '9px', color: 'var(--color-subtle)', fontFamily: 'monospace' }}>{node.timeLabel}</span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--color-fg)' }}>{node.description}</div>
              <div style={{ fontSize: '9px', color: 'var(--color-subtle)', marginTop: '2px' }}>{node.opsApplied} op{node.opsApplied !== 1 ? 's' : ''}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Diagnostics Panel ─────────────────────────────────────────

function DiagnosticsPanel({ doc, frameState }: { doc: MotionDocument; frameState: FrameState | null }) {
  const diagVM = useMemo(() => buildEvalDiagnosticsViewModel(frameState?.diagnostics), [frameState]);

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '8px' }}>
      <div style={{ fontSize: '10px', color: 'var(--color-muted)', marginBottom: '8px', borderBottom: '1px solid var(--color-border)', paddingBottom: '4px' }}>DIAGNOSTICS</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {[
          { label: 'Document ID', value: doc.id },
          { label: 'Name', value: doc.name },
          { label: 'Duration', value: `${motionTimeToSeconds(doc.duration).toFixed(2)}s` },
          { label: 'FPS', value: String(doc.fps) },
          { label: 'Dimensions', value: `${doc.width}×${doc.height}` },
          { label: 'Objects', value: String(Object.keys(doc.objects).length) },
          { label: 'Signals', value: String(doc.signals ? Object.keys(doc.signals).length : 0) },
          { label: 'Frame Objects', value: String(frameState?.objects.length ?? 0) },
          { label: 'Updated', value: new Date(doc.updatedAt).toLocaleTimeString() },
        ].map(({ label, value }) => (
          <div key={label} style={{ display: 'flex', gap: '8px', fontSize: '10px' }}>
            <span style={{ color: 'var(--color-muted)', minWidth: '90px', flexShrink: 0 }}>{label}</span>
            <span style={{ color: 'var(--color-fg)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
          </div>
        ))}
      </div>

      {frameState && (
        <div style={{ marginTop: '12px', borderTop: '1px solid var(--color-border)', paddingTop: '8px' }}>
          <div style={{ fontSize: '9px', color: 'var(--color-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
            Eval Performance
            <span style={{ marginLeft: '6px', color: diagVM.performanceLabel === 'fast' ? '#10b981' : diagVM.performanceLabel === 'ok' ? '#f59e0b' : '#ef4444' }}>
              {diagVM.performanceLabel} ({diagVM.evaluationTimeMs.toFixed(1)}ms)
            </span>
          </div>
          <div style={{ display: 'flex', gap: '12px', fontSize: '10px', color: 'var(--color-muted)' }}>
            <span>{diagVM.objectCount} objects</span>
            <span>{diagVM.keyframeCount} keyframes</span>
            <span>{diagVM.behaviorCount} behaviors</span>
            <span>{diagVM.signalCount} signals</span>
          </div>
          {diagVM.hasWarnings && (
            <div style={{ marginTop: '6px' }}>
              {diagVM.warnings.map((w, i) => (
                <div key={i} style={{ fontSize: '10px', color: '#f59e0b', padding: '1px 0' }}>⚠ {w}</div>
              ))}
            </div>
          )}
          {diagVM.hasErrors && (
            <div style={{ marginTop: '4px' }}>
              {diagVM.errors.map((e, i) => (
                <div key={i} style={{ fontSize: '10px', color: '#ef4444', padding: '1px 0' }}>✕ {e}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Motion Animator Workspace ────────────────────────────

export default function MotionAnimatorWorkspace({
  handoff,
  onReturnToStudio,
}: MotionAnimatorWorkspaceProps) {
  const engine = useEngine();
  const { project, dispatchBatch, session, updateSession } = engine;

  // Resolve MotionDocument from canonical Studio project — no copy, no mock
  const doc = resolveMotionDocument(project, handoff.motionDocumentId);

  const [activeTab, setActiveTab] = useState<MATab>('objects');

  // ONE selection model — shared by timeline/canvas/inspector/curves/dope/trace
  const [selection, setSelection] = useState<MotionSelectionState>(() =>
    createMotionSelectionState(handoff.selectedMotionObjectId ?? null)
  );

  // Ephemeral workspace state — mute/solo/collapse — never persisted, never canonical
  const [ephemeralState, setEphemeralState] = useState<EphemeralTrackState>(() =>
    createEphemeralTrackState()
  );

  // ── Transport: Studio session is the ONE time authority ──────
  // No local playhead state. No local playback interval. The Motion Suite
  // derives clip-local time from Studio session.playheadFrame, and playback
  // toggles Studio session.playing — the same canonical clock ViewerPanel
  // drives via usePlaybackClock. Scrubbing seeks the Studio playhead.
  const clip = engine.activeSequence?.clips.find((c) => c.id === handoff.clipId) ?? null;
  const seqFps = engine.activeSequence?.format.fps ?? handoff.sequenceFormat?.fps ?? 29.97;
  const clipStartSecs = clip ? motionTimeToSeconds(clip.startTime) : handoff.clipStartSecs;
  const clipDurSecs = clip ? motionTimeToSeconds(clip.duration) : handoff.clipDurationSecs;
  const seqTimeSecs = session.playheadFrame / seqFps;
  // Clip-local authoring time — derived, never owned here.
  const playheadSecs = clip
    ? studioTimeToMotionTime(seqTimeSecs, clip)
    : Math.max(0, Math.min(clipDurSecs, seqTimeSecs - clipStartSecs));
  const playing = session.playing;

  const [frameState, setFrameState] = useState<FrameState | null>(null);
  const [hadEdits, setHadEdits] = useState(false);

  // Seek: clip-local seconds → Studio sequence frame (canonical session update)
  const seekLocal = useCallback((localSecs: number) => {
    const clamped = Math.max(0, Math.min(clipDurSecs, localSecs));
    const seqSecs = clip
      ? motionLocalTimeToStudioSequenceTime(clamped, clip)
      : clipStartSecs + clamped;
    updateSession({ playing: false, playheadFrame: Math.round(seqSecs * seqFps) });
  }, [clip, clipStartSecs, clipDurSecs, seqFps, updateSession]);

  const togglePlayback = useCallback(() => {
    updateSession({ playing: !session.playing });
  }, [session.playing, updateSession]);

  // Initialize selection from doc root if nothing selected
  useEffect(() => {
    if (doc && !selection.selectedObjectId && doc.rootObjectIds?.length > 0) {
      setSelection(createMotionSelectionState(doc.rootObjectIds[0]));
    }
  }, [doc?.id]);

  // Evaluate MotionDocument at current playhead using canonical evaluator
  // Uses the same StudioAnalysisContract as Studio — ONE analysis truth
  useEffect(() => {
    if (!doc) return;
    if (!clip) return;

    const contract = buildAnalysisContract(
      project,
      engine.activeSequence,
      Math.round(seqTimeSecs * seqFps),
      handoff.clipId
    );
    const signalValues = contractToSignalValues(contract);
    const fs = evaluateMotionClip(project, clip, seqTimeSecs, signalValues);
    setFrameState(fs);
  }, [session.playheadFrame, doc?.updatedAt, project.revision]);

  // THE ONE commit path: MotionOp[] → MotionTransaction → Studio dispatchBatch
  // Accepts MotionOpLike (canonical MotionOp OR legacy motion/types.ts MotionOp)
  // — both flow through motionTransactionToStudioOps, which packs them into one
  // motion.document.patch op → one Studio history entry.
  const applyOps = useCallback(
    (ops: MotionOpLike[], description: string) => {
      if (!project || !doc) return;
      const transaction: MotionTransactionLike = { ops, description };
      // motionTransactionToStudioOps(tx, project) → Studio OpEnvelopes
      const studioOps = motionTransactionToStudioOps(transaction, project);
      if (studioOps.length > 0) {
        dispatchBatch(studioOps, description);
        setHadEdits(true);
      }
    },
    [project, doc, dispatchBatch]
  );

  // Selection handlers — ONE selection model
  const handleSelectObject = useCallback((id: string) => {
    setSelection((prev) => selectObject(prev, id));
  }, []);

  const handleToggleKeyframe = useCallback((kfId: string, additive: boolean) => {
    setSelection((prev) => toggleKeyframeSelection(prev, kfId, additive));
  }, []);

  // Visibility → canonical MotionObject.visible
  const handleToggleVisible = useCallback((id: string, currentValue: boolean) => {
    if (!doc) return;
    applyOps(
      [makeOp('motion.setObjectProp', doc.id, { objectId: id, props: { visible: !currentValue } })],
      `${currentValue ? 'Hide' : 'Show'} object`
    );
  }, [doc, applyOps]);

  // Lock → canonical MotionObject.locked
  const handleToggleLocked = useCallback((id: string, currentValue: boolean) => {
    if (!doc) return;
    applyOps(
      [makeOp('motion.setObjectProp', doc.id, { objectId: id, props: { locked: !currentValue } })],
      `${currentValue ? 'Unlock' : 'Lock'} object`
    );
  }, [doc, applyOps]);

  // Mute — ephemeral workspace state only, never persisted
  const handleToggleMute = useCallback((id: string) => {
    setEphemeralState((prev) => toggleEphemeralMute(prev, id));
  }, []);

  // Collapse — ephemeral workspace state only
  const handleToggleCollapse = useCallback((id: string) => {
    setEphemeralState((prev) => toggleEphemeralCollapse(prev, id));
  }, []);

  const handleReturnToStudio = useCallback(() => {
    const returnHandoff = buildReturnHandoff({
      motionDocumentId: handoff.motionDocumentId,
      clipId: handoff.clipId,
      selectedMotionObjectId: selection.selectedObjectId ?? undefined,
      hadEdits,
    });
    onReturnToStudio(returnHandoff);
  }, [handoff, selection.selectedObjectId, hadEdits, onReturnToStudio]);

  if (!doc) {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)', flexDirection: 'column', gap: '12px' }}>
        <div style={{ fontSize: '28px', opacity: 0.3 }}>⬡</div>
        <div style={{ fontSize: '14px', color: 'var(--color-muted)' }}>MotionDocument not found</div>
        <div style={{ fontSize: '11px', color: 'var(--color-subtle)' }}>ID: {handoff.motionDocumentId}</div>
        <button
          onClick={handleReturnToStudio}
          style={{ marginTop: '8px', padding: '8px 16px', background: 'rgba(59,130,255,0.15)', border: '1px solid rgba(59,130,255,0.3)', borderRadius: '6px', color: '#3b82ff', cursor: 'pointer', fontSize: '12px' }}
        >
          ← Return to Studio
        </button>
      </div>
    );
  }

  const selectedObject = selection.selectedObjectId ? doc.objects[selection.selectedObjectId] : null;
  const durationSecs = motionTimeToSeconds(doc.duration);

  // Build view models from canonical data
  const transport = buildTransportViewModel(playheadSecs, doc);
  const renderModel = buildCanvasRenderModel(doc, frameState);

  const TABS: { id: MATab; label: string; title: string }[] = [
    { id: 'objects', label: 'Objects', title: 'Object hierarchy' },
    { id: 'properties', label: 'Props', title: 'Transform & properties' },
    { id: 'behaviors', label: 'Behaviors', title: 'Motion behaviors' },
    { id: 'materials', label: 'Materials', title: 'Materials & surface' },
    { id: 'text', label: 'Text', title: 'Text authoring' },
    { id: 'curves', label: 'Curves', title: 'Graph / curve editor' },
    { id: 'dope', label: 'Dope', title: 'Dope sheet' },
    { id: 'camera', label: 'Camera', title: 'Camera & spatial' },
    { id: 'spatial', label: '2.5D', title: '2.5D spatial composition' },
    { id: 'signals', label: 'Signals', title: 'Signal binding' },
    { id: 'resources', label: 'Resources', title: 'Signal resources' },
    { id: 'macros', label: 'Macros', title: 'Creative macros' },
    { id: 'library', label: 'Library', title: 'Motion library' },
    { id: 'scene', label: 'Scene', title: 'Scene Script' },
    { id: 'trace', label: 'Trace', title: 'Contribution trace' },
    { id: 'diagnostics', label: 'Diag', title: 'Diagnostics' },
    { id: 'ai', label: 'AI', title: 'AI Creative Operator' },
    { id: 'packages', label: 'Packages', title: 'Library Packages' },
    { id: 'svg', label: 'SVG', title: 'SVG Possibilities' },
  ];

  const tabStyle = (active: boolean): React.CSSProperties => ({
    background: active ? 'rgba(139,92,246,0.18)' : 'transparent',
    border: 'none',
    borderRadius: '3px',
    padding: '3px 7px',
    fontSize: '10px',
    fontWeight: active ? 600 : 400,
    color: active ? '#a855f7' : 'var(--color-subtle)',
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    transition: 'all 100ms ease',
  });

  return (
    <div style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--color-bg)', overflow: 'hidden', zIndex: 100 }}>
      {/* Motion Animator Top Bar */}
      <header style={{ height: '44px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '6px', padding: '0 10px', background: '#0d0d14', borderBottom: '1px solid rgba(139,92,246,0.2)', zIndex: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: '6px', flexShrink: 0 }}>
          <span style={{ fontSize: '14px' }}>⬡</span>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#a855f7', letterSpacing: '0.02em' }}>MOTION ANIMATOR</span>
        </div>

        <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.08)', margin: '0 4px' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {doc.name}
          </span>
          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>
            {durationSecs.toFixed(1)}s · {doc.fps}fps · {doc.width}×{doc.height}
          </span>
          {hadEdits && (
            <span style={{ fontSize: '10px', color: '#a855f7', flexShrink: 0 }}>● edited</span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
          {handoff.activeSpeaker && (
            <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '3px' }}>
              🎤 {handoff.activeSpeaker}
            </span>
          )}
          {handoff.sceneRegionLabel && (
            <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '3px' }}>
              📍 {handoff.sceneRegionLabel}
            </span>
          )}
          <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.04)', padding: '2px 6px', borderRadius: '3px' }}>
            Studio @{(handoff.studioPlayheadFrame / (handoff.sequenceFormat?.fps ?? 29.97)).toFixed(2)}s
          </span>
        </div>

        <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.08)', margin: '0 4px' }} />

        <button
          onClick={() => engine.undo()}
          disabled={engine.undoDepth === 0}
          style={{ background: 'transparent', border: 'none', cursor: engine.undoDepth === 0 ? 'not-allowed' : 'pointer', color: engine.undoDepth === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.6)', padding: '4px 6px', borderRadius: '4px', fontSize: '11px' }}
          title={`Undo (Cmd+Z) — ${engine.undoDepth} steps in Studio history`}
        >
          ↩ Undo
        </button>
        <button
          onClick={() => engine.redo()}
          disabled={engine.redoDepth === 0}
          style={{ background: 'transparent', border: 'none', cursor: engine.redoDepth === 0 ? 'not-allowed' : 'pointer', color: engine.redoDepth === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.6)', padding: '4px 6px', borderRadius: '4px', fontSize: '11px' }}
          title={`Redo (Cmd+Shift+Z) — ${engine.redoDepth} steps`}
        >
          ↪ Redo
        </button>

        <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.08)', margin: '0 4px' }} />

        <button
          onClick={handleReturnToStudio}
          style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 14px', background: 'rgba(59,130,255,0.12)', border: '1px solid rgba(59,130,255,0.3)', borderRadius: '6px', color: '#3b82ff', cursor: 'pointer', fontSize: '12px', fontWeight: 600, fontFamily: 'var(--font-sans)', flexShrink: 0 }}
          title="Return to Studio — changes already committed to Studio history"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M5 2L1 6l4 4M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Return to Studio
        </button>
      </header>

      {/* Main layout */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Left: Object hierarchy */}
        <div style={{ width: '200px', flexShrink: 0, borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <ObjectHierarchyPanel
            doc={doc}
            selection={selection}
            ephemeralState={ephemeralState}
            onSelectObject={handleSelectObject}
            onToggleVisible={handleToggleVisible}
            onToggleLocked={handleToggleLocked}
            onToggleMute={handleToggleMute}
            onToggleCollapse={handleToggleCollapse}
          />
        </div>

        {/* Center: Viewer + Dope Sheet */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          {/* Viewer — driven by real CanvasRenderModel */}
          <div style={{ flex: 1, minHeight: 0 }}>
            <MAViewer
              renderModel={renderModel}
              transport={transport}
              playing={playing}
              onSeek={seekLocal}
              onPlayToggle={togglePlayback}
            />
          </div>

          {/* Dope Sheet strip — driven by real canonical keyframes */}
          <div style={{ height: '120px', flexShrink: 0, borderTop: '1px solid var(--color-border)', overflow: 'hidden' }}>
            <DopeSheet
              doc={doc}
              selection={selection}
              playheadSecs={playheadSecs}
              onSeek={seekLocal}
              onSelectObject={handleSelectObject}
            />
          </div>
        </div>

        {/* Right: Inspector panels */}
        <div style={{ width: '300px', flexShrink: 0, borderLeft: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Tab bar */}
          <div style={{ padding: '4px 6px', borderBottom: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', gap: '2px', overflowX: 'auto', background: 'rgba(139,92,246,0.04)' }}>
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                style={tabStyle(activeTab === t.id)}
                title={t.title}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Panel content */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {activeTab === 'objects' && (
              <ObjectHierarchyPanel
                doc={doc}
                selection={selection}
                ephemeralState={ephemeralState}
                onSelectObject={handleSelectObject}
                onToggleVisible={handleToggleVisible}
                onToggleLocked={handleToggleLocked}
                onToggleMute={handleToggleMute}
                onToggleCollapse={handleToggleCollapse}
              />
            )}
            {activeTab === 'properties' && (
              <PropertiesPanel
                doc={doc}
                selectedObject={selectedObject}
                playheadSecs={playheadSecs}
                fps={seqFps}
                onApplyOps={applyOps}
              />
            )}
            {activeTab === 'behaviors' && (
              <BehaviorsPanel
                doc={doc}
                selectedObject={selectedObject}
                onApplyOps={applyOps}
              />
            )}
            {activeTab === 'materials' && (
              <MaterialsPanel
                doc={doc}
                selectedObject={selectedObject}
                onApplyOps={applyOps}
              />
            )}
            {activeTab === 'text' && (
              <TextMotionPanel clipId={handoff.clipId} objectId={selection.selectedObjectId ?? ''} />
            )}
            {activeTab === 'curves' && (
              <CurveEditor
                doc={doc}
                selectedObject={selectedObject}
                selection={selection}
                onApplyOps={applyOps}
                onToggleKeyframe={handleToggleKeyframe}
              />
            )}
            {activeTab === 'dope' && (
              <DopeSheet
                doc={doc}
                selection={selection}
                playheadSecs={playheadSecs}
                onSeek={seekLocal}
                onSelectObject={handleSelectObject}
              />
            )}
            {activeTab === 'camera' && (
              <div style={{ padding: '8px' }}>
                <div style={{ fontSize: '10px', color: 'var(--color-muted)', marginBottom: '8px', borderBottom: '1px solid var(--color-border)', paddingBottom: '4px' }}>CAMERA</div>
                <SpatialDepthPanel clipId={handoff.clipId} />
              </div>
            )}
            {activeTab === 'spatial' && (
              <SpatialDepthPanel clipId={handoff.clipId} />
            )}
            {activeTab === 'signals' && (
              <SignalBindingPanel clipId={handoff.clipId} />
            )}
            {activeTab === 'resources' && (
              <SignalResourcePanel clipId={handoff.clipId} />
            )}
            {activeTab === 'macros' && (
              <CreativeMacrosPanel clipId={handoff.clipId} />
            )}
            {activeTab === 'library' && (
              <MotionLibrary />
            )}
            {activeTab === 'scene' && (
              <SceneScriptPanel />
            )}
            {activeTab === 'trace' && (
              <ContributionTracePanel doc={doc} />
            )}
            {activeTab === 'diagnostics' && (
              <DiagnosticsPanel doc={doc} frameState={frameState} />
            )}
            {activeTab === 'ai' && (
              <AICreativeOperatorPanel
                workspaceKind="motion-animator"
                motionHandoff={handoff}
                onApplyProposal={(proposal) => {
                  if (proposal.canonicalOps.length > 0) {
                    applyOps(proposal.canonicalOps, proposal.interpretedIntent);
                  }
                }}
              />
            )}
            {activeTab === 'packages' && (
              <LibraryPackagePanel
                workspaceKind="motion-animator"
                motionHandoff={handoff}
                onApplyPackage={(pkg, params) => {
                  const ops = pkg.applyOps(handoff.motionDocumentId, params);
                  if (ops.length > 0) {
                    applyOps(ops, `Apply ${pkg.name}`);
                  }
                }}
              />
            )}
            {activeTab === 'svg' && (
              <SVGPossibilityPanel />
            )}
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div style={{ height: '22px', flexShrink: 0, borderTop: '1px solid rgba(139,92,246,0.15)', background: '#0a0a0f', display: 'flex', alignItems: 'center', padding: '0 10px', gap: '12px' }}>
        <span style={{ fontSize: '9px', color: 'rgba(139,92,246,0.6)' }}>MOTION ANIMATOR</span>
        <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.2)' }}>|</span>
        <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)' }}>
          {selectedObject ? `${selectedObject.name} (${selectedObject.kind})` : 'No selection'}
        </span>
        <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.2)' }}>|</span>
        <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)' }}>
          {Object.keys(doc.objects).length} objects · {doc.signals ? Object.keys(doc.signals).length : 0} signals
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.2)' }}>
          Edits → Studio history · Undo/Redo shared · {engine.undoDepth} steps
        </span>
        {hadEdits && (
          <span style={{ fontSize: '9px', color: '#a855f7' }}>● {engine.undoDepth} committed</span>
        )}
      </div>
    </div>
  );
}
