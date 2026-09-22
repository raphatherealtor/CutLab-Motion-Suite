'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useEngine } from '@/engine/store';
import { makeOp } from '@/engine/operations';
import { toTimecode, fromSeconds, toSeconds } from '@/engine/time';
import type { Clip, Effect, Mask, Keyframe, EffectType } from '@/engine/schema';
import { generateId } from '@/engine/schema';
import { EFFECT_DEFINITIONS, createEffect, type EffectType } from '@/engine/effects';

interface ClipInspectorProps {
  selectedClipId: string | null;
  activeTab?: 'transform' | 'effects' | 'keyframes' | 'masks' | 'audio' | 'motion';
}

type InspectorTab = 'transform' | 'effects' | 'keyframes' | 'masks' | 'audio' | 'motion';

export default function ClipInspector({ selectedClipId, activeTab: externalTab }: ClipInspectorProps) {
  const engine = useEngine();
  const { activeSequence, dispatch, session } = engine;
  const fps = activeSequence?.format.fps ?? 29.97;

  const clip = selectedClipId && activeSequence
    ? activeSequence.clips.find((c) => c.id === selectedClipId) ?? null
    : null;

  const [tab, setTab] = useState<InspectorTab>(externalTab ?? 'transform');

  // Sync internal tab when external tab prop changes (e.g. Inspector sub-tab switch)
  useEffect(() => {
    if (externalTab) setTab(externalTab);
  }, [externalTab]);

  const [localOpacity, setLocalOpacity] = useState(100);
  const [localVolume, setLocalVolume] = useState(0);
  const [localSpeed, setLocalSpeed] = useState(1);
  const [localX, setLocalX] = useState(0);
  const [localY, setLocalY] = useState(0);
  const [localScaleX, setLocalScaleX] = useState(100);
  const [localScaleY, setLocalScaleY] = useState(100);
  const [localRotation, setLocalRotation] = useState(0);
  const [localFadeIn, setLocalFadeIn] = useState(0);
  const [localFadeOut, setLocalFadeOut] = useState(0);
  const [localPan, setLocalPan] = useState(0);
  // Controlled state for graphic params (text, color, etc.)
  const [localGraphicParams, setLocalGraphicParams] = useState<Record<string, string | number | boolean>>({});

  useEffect(() => {
    if (clip) {
      setLocalOpacity(Math.round(clip.transform.opacity * 100));
      setLocalVolume(clip.gain);
      setLocalSpeed(clip.speed);
      setLocalX(Math.round(clip.transform.x));
      setLocalY(Math.round(clip.transform.y));
      setLocalScaleX(Math.round(clip.transform.scaleX * 100));
      setLocalScaleY(Math.round(clip.transform.scaleY * 100));
      setLocalRotation(Math.round(clip.transform.rotation));
      setLocalFadeIn(toSeconds(clip.fadeIn));
      setLocalFadeOut(toSeconds(clip.fadeOut));
      setLocalPan(clip.pan ?? 0);
      setLocalGraphicParams(clip.graphicParams ? { ...clip.graphicParams } as Record<string, string | number | boolean> : {});
    }
  }, [clip?.id]);

  const commitTransform = useCallback((patch: Partial<import('@/engine/schema').Transform>) => {
    if (!clip || !activeSequence) return;
    dispatch(makeOp('clip.setTransform', { sequenceId: activeSequence.id, clipId: clip.id, transform: patch }), 'Set transform');
  }, [clip, activeSequence, dispatch]);

  const commitGain = useCallback((gain: number) => {
    if (!clip || !activeSequence) return;
    dispatch(makeOp('clip.setGain', { sequenceId: activeSequence.id, clipId: clip.id, gain }), 'Set gain');
  }, [clip, activeSequence, dispatch]);

  const commitSpeed = useCallback((speed: number) => {
    if (!clip || !activeSequence) return;
    dispatch(makeOp('clip.setSpeed', { sequenceId: activeSequence.id, clipId: clip.id, speed }), 'Set speed');
  }, [clip, activeSequence, dispatch]);

  const commitFades = useCallback((fadeIn?: number, fadeOut?: number) => {
    if (!clip || !activeSequence) return;
    const props: Partial<Clip> = {};
    if (fadeIn !== undefined) props.fadeIn = fromSeconds(fadeIn, 30000);
    if (fadeOut !== undefined) props.fadeOut = fromSeconds(fadeOut, 30000);
    dispatch(makeOp('clip.setProps', { sequenceId: activeSequence.id, clipId: clip.id, props }), 'Set fades');
  }, [clip, activeSequence, dispatch]);

  const commitPan = useCallback((pan: number) => {
    if (!clip || !activeSequence) return;
    dispatch(makeOp('clip.setProps', { sequenceId: activeSequence.id, clipId: clip.id, props: { pan } }), 'Set pan');
  }, [clip, activeSequence, dispatch]);

  const toggleEffect = useCallback((effectId: string, enabled: boolean) => {
    if (!clip || !activeSequence) return;
    dispatch(makeOp('clip.setEffect', { sequenceId: activeSequence.id, clipId: clip.id, effectId, props: { enabled } }), 'Toggle effect');
  }, [clip, activeSequence, dispatch]);

  const removeEffect = useCallback((effectId: string) => {
    if (!clip || !activeSequence) return;
    dispatch(makeOp('clip.removeEffect', { sequenceId: activeSequence.id, clipId: clip.id, effectId }), 'Remove effect');
  }, [clip, activeSequence, dispatch]);

  const addEffect = useCallback((type: string) => {
    if (!clip || !activeSequence) return;
    const effect = createEffect(type as EffectType, clip.effects.length);
    dispatch(makeOp('clip.addEffect', { sequenceId: activeSequence.id, clipId: clip.id, effect }), `Add ${type}`);
  }, [clip, activeSequence, dispatch]);

  const setEffectParam = useCallback((effectId: string, key: string, value: number | string | boolean) => {
    if (!clip || !activeSequence) return;
    const effect = clip.effects.find((e) => e.id === effectId);
    if (!effect) return;
    dispatch(makeOp('clip.setEffect', { sequenceId: activeSequence.id, clipId: clip.id, effectId, props: { params: { ...effect.params, [key]: value } } }), `Set ${key}`);
  }, [clip, activeSequence, dispatch]);

  const resetEffectParam = useCallback((effectId: string, key: string) => {
    if (!clip || !activeSequence) return;
    const def = Object.values(EFFECT_DEFINITIONS).find((d) => d.type === clip.effects.find((e) => e.id === effectId)?.type);
    if (!def) return;
    const paramDef = def.paramDefs.find((p) => p.key === key);
    if (!paramDef) return;
    setEffectParam(effectId, key, paramDef.default);
  }, [clip, activeSequence, setEffectParam]);

  const addMask = useCallback((shape: 'rectangle' | 'ellipse') => {
    if (!clip || !activeSequence) return;
    const mask: Mask = { id: generateId('mask'), shape, x: 0.25, y: 0.25, width: 0.5, height: 0.5, feather: 0, invert: false, rotation: 0 };
    dispatch(makeOp('clip.addMask', { sequenceId: activeSequence.id, clipId: clip.id, mask }), `Add ${shape} mask`);
  }, [clip, activeSequence, dispatch]);

  const removeMask = useCallback((maskId: string) => {
    if (!clip || !activeSequence) return;
    dispatch(makeOp('clip.removeMask', { sequenceId: activeSequence.id, clipId: clip.id, maskId }), 'Remove mask');
  }, [clip, activeSequence, dispatch]);

  const setMaskProp = useCallback((maskId: string, props: Partial<Mask>) => {
    if (!clip || !activeSequence) return;
    dispatch(makeOp('clip.setMask', { sequenceId: activeSequence.id, clipId: clip.id, maskId, props }), 'Set mask');
  }, [clip, activeSequence, dispatch]);

  const addKeyframe = useCallback((property: string, value: number) => {
    if (!clip || !activeSequence) return;
    const clipLocalSecs = Math.max(0, session.playheadFrame / fps - toSeconds(clip.startTime));
    const clipLocalTime = fromSeconds(clipLocalSecs, 30000);
    const kf: Keyframe = { id: generateId('kf'), time: clipLocalTime, property, value, easing: 'linear' };
    dispatch(makeOp('keyframe.upsert', { sequenceId: activeSequence.id, clipId: clip.id, keyframe: kf }), `Add keyframe: ${property}`);
  }, [clip, activeSequence, dispatch, session.playheadFrame, fps]);

  const removeKeyframe = useCallback((kfId: string) => {
    if (!clip || !activeSequence) return;
    dispatch(makeOp('keyframe.remove', { sequenceId: activeSequence.id, clipId: clip.id, keyframeId: kfId }), 'Remove keyframe');
  }, [clip, activeSequence, dispatch]);

  const setKeyframeEasing = useCallback((kfId: string, easing: Keyframe['easing']) => {
    if (!clip || !activeSequence) return;
    dispatch(makeOp('keyframe.setEasing', { sequenceId: activeSequence.id, clipId: clip.id, keyframeId: kfId, easing }), 'Set easing');
  }, [clip, activeSequence, dispatch]);

  const toggleClipEnable = useCallback(() => {
    if (!clip || !activeSequence) return;
    dispatch(makeOp('clip.enable', { sequenceId: activeSequence.id, clipId: clip.id, enabled: clip.disabled }), clip.disabled ? 'Enable clip' : 'Disable clip');
  }, [clip, activeSequence, dispatch]);

  const toggleUnlink = useCallback(() => {
    if (!clip || !activeSequence) return;
    if (clip.linkGroupId) {
      dispatch(makeOp('clip.unlink', { sequenceId: activeSequence.id, clipId: clip.id }), 'Unlink');
    }
  }, [clip, activeSequence, dispatch]);

  if (!clip) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '24px', textAlign: 'center' }}>
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" style={{ opacity: 0.18, marginBottom: '8px' }} aria-hidden="true">
          <rect x="3" y="7" width="22" height="14" rx="2" stroke="var(--color-muted)" strokeWidth="1.5" />
          <path d="M3 11h22" stroke="var(--color-muted)" strokeWidth="1.5" />
          <rect x="7" y="15" width="7" height="3" rx="1" stroke="var(--color-muted)" strokeWidth="1.2" />
        </svg>
        <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginBottom: '3px' }}>No clip selected</div>
        <div style={{ fontSize: '11px', color: 'var(--color-subtle)', lineHeight: 1.5 }}>Click a clip on the timeline to inspect its properties.</div>
      </div>
    );
  }

  const isAudio = clip.kind === 'audio';
  const isMotion = clip.kind === 'motion';
  const isGraphic = clip.kind === 'graphic';
  const startTimecode = toTimecode(clip.startTime, fps);
  const durationTimecode = toTimecode(clip.duration, fps);

  const tabs: { id: InspectorTab; label: string }[] = [
    { id: 'transform', label: 'Transform' },
    { id: 'effects', label: `FX${clip.effects.length > 0 ? ` (${clip.effects.length})` : ''}` },
    { id: 'keyframes', label: `KF${clip.keyframes.length > 0 ? ` (${clip.keyframes.length})` : ''}` },
    { id: 'masks', label: `Masks${clip.masks.length > 0 ? ` (${clip.masks.length})` : ''}` },
    { id: 'audio', label: 'Audio' },
    ...(isMotion || isGraphic ? [{ id: 'motion' as InspectorTab, label: 'Params' }] : []),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Clip identity */}
      <div style={{ padding: '7px 10px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-fg)', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clip.name}</div>
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '10px', background: 'rgba(59,130,255,0.12)', color: 'var(--color-accent)', fontWeight: 500, textTransform: 'capitalize' }}>{clip.kind}</span>
          <span style={{ fontSize: '10px', color: 'var(--color-subtle)', fontFamily: 'var(--font-mono)' }}>{startTimecode}</span>
          <span style={{ fontSize: '10px', color: 'var(--color-subtle)', fontFamily: 'var(--font-mono)' }}>{durationTimecode}</span>
          {clip.speed !== 1 && <span style={{ fontSize: '10px', color: 'var(--color-accent-3)', fontFamily: 'var(--font-mono)' }}>{clip.speed}×</span>}
          {clip.freeze && <span style={{ fontSize: '10px', color: 'var(--color-accent-2)', fontFamily: 'var(--font-mono)' }}>FREEZE</span>}
          {clip.disabled && <span style={{ fontSize: '10px', color: 'var(--color-danger)', fontFamily: 'var(--font-mono)' }}>DISABLED</span>}
          {clip.linkGroupId && <span style={{ fontSize: '10px', color: 'var(--color-subtle)' }}>⛓ linked</span>}
        </div>
        {/* Quick actions */}
        <div style={{ display: 'flex', gap: '4px', marginTop: '5px' }}>
          <button className="btn-ghost" onClick={toggleClipEnable} style={{ fontSize: '10px', padding: '2px 7px', color: clip.disabled ? 'var(--color-success)' : 'var(--color-subtle)' }} aria-label={clip.disabled ? 'Enable clip' : 'Disable clip'}>
            {clip.disabled ? 'Enable' : 'Disable'}
          </button>
          {clip.linkGroupId && (
            <button className="btn-ghost" onClick={toggleUnlink} style={{ fontSize: '10px', padding: '2px 7px', color: 'var(--color-subtle)' }} aria-label="Unlink A/V">Unlink</button>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', gap: '2px', overflowX: 'auto' }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ background: tab === t.id ? 'rgba(59,130,255,0.12)' : 'transparent', border: 'none', borderRadius: '3px', padding: '3px 7px', fontSize: '10px', color: tab === t.id ? 'var(--color-accent)' : 'var(--color-subtle)', cursor: 'pointer', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap', flexShrink: 0 }}
            aria-pressed={tab === t.id}
          >{t.label}</button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '8px' }}>

        {/* ── Transform ── */}
        {tab === 'transform' && !isAudio && (
          <div>
            <InspectorSection title="Opacity">
              <InspectorRow label="Opacity">
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <input type="range" min={0} max={100} value={localOpacity}
                    onChange={(e) => setLocalOpacity(parseInt(e.target.value))}
                    onMouseUp={() => commitTransform({ opacity: localOpacity / 100 })}
                    className="range-slider" style={{ flex: 1 }} aria-label="Opacity" />
                  <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--color-fg)', minWidth: '32px', textAlign: 'right' }}>{localOpacity}%</span>
                  <button className="btn-icon" onClick={() => addKeyframe('transform.opacity', localOpacity / 100)} title="Add keyframe" aria-label="Add opacity keyframe" style={{ fontSize: '10px', color: 'var(--color-accent-3)', padding: '2px 4px' }}>◆</button>
                </div>
              </InspectorRow>
            </InspectorSection>

            {!isMotion && (
              <>
                <InspectorSection title="Position">
                  <InspectorRow label="X">
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      <input type="number" value={localX} onChange={(e) => setLocalX(parseFloat(e.target.value) || 0)}
                        onBlur={() => commitTransform({ x: localX })} className="inspector-input" style={{ flex: 1 }} aria-label="Position X" />
                      <button className="btn-icon" onClick={() => addKeyframe('transform.x', localX)} title="Add keyframe" aria-label="Add X keyframe" style={{ fontSize: '10px', color: 'var(--color-accent-3)', padding: '2px 4px' }}>◆</button>
                    </div>
                  </InspectorRow>
                  <InspectorRow label="Y">
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      <input type="number" value={localY} onChange={(e) => setLocalY(parseFloat(e.target.value) || 0)}
                        onBlur={() => commitTransform({ y: localY })} className="inspector-input" style={{ flex: 1 }} aria-label="Position Y" />
                      <button className="btn-icon" onClick={() => addKeyframe('transform.y', localY)} title="Add keyframe" aria-label="Add Y keyframe" style={{ fontSize: '10px', color: 'var(--color-accent-3)', padding: '2px 4px' }}>◆</button>
                    </div>
                  </InspectorRow>
                </InspectorSection>

                <InspectorSection title="Scale">
                  <InspectorRow label="Scale X %">
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      <input type="number" value={localScaleX} onChange={(e) => setLocalScaleX(parseFloat(e.target.value) || 100)}
                        onBlur={() => commitTransform({ scaleX: localScaleX / 100 })} className="inspector-input" style={{ flex: 1 }} aria-label="Scale X" />
                      <button className="btn-icon" onClick={() => addKeyframe('transform.scaleX', localScaleX / 100)} title="Add keyframe" aria-label="Add scale X keyframe" style={{ fontSize: '10px', color: 'var(--color-accent-3)', padding: '2px 4px' }}>◆</button>
                    </div>
                  </InspectorRow>
                  <InspectorRow label="Scale Y %">
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      <input type="number" value={localScaleY} onChange={(e) => setLocalScaleY(parseFloat(e.target.value) || 100)}
                        onBlur={() => commitTransform({ scaleY: localScaleY / 100 })} className="inspector-input" style={{ flex: 1 }} aria-label="Scale Y" />
                      <button className="btn-icon" onClick={() => addKeyframe('transform.scaleY', localScaleY / 100)} title="Add keyframe" aria-label="Add scale Y keyframe" style={{ fontSize: '10px', color: 'var(--color-accent-3)', padding: '2px 4px' }}>◆</button>
                    </div>
                  </InspectorRow>
                </InspectorSection>

                <InspectorSection title="Rotation">
                  <InspectorRow label="Degrees">
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      <input type="number" value={localRotation} onChange={(e) => setLocalRotation(parseFloat(e.target.value) || 0)}
                        onBlur={() => commitTransform({ rotation: localRotation })} className="inspector-input" style={{ flex: 1 }} aria-label="Rotation" />
                      <button className="btn-icon" onClick={() => addKeyframe('transform.rotation', localRotation)} title="Add keyframe" aria-label="Add rotation keyframe" style={{ fontSize: '10px', color: 'var(--color-accent-3)', padding: '2px 4px' }}>◆</button>
                    </div>
                  </InspectorRow>
                </InspectorSection>

                <InspectorSection title="Crop">
                  {(['cropLeft', 'cropRight', 'cropTop', 'cropBottom'] as const).map((side) => (
                    <InspectorRow key={side} label={side.replace('crop', '')}>
                      <input type="number" min={0} max={1} step={0.01}
                        defaultValue={clip.transform[side]}
                        onBlur={(e) => commitTransform({ [side]: parseFloat(e.target.value) || 0 })}
                        className="inspector-input" style={{ width: '100%' }} aria-label={side} />
                    </InspectorRow>
                  ))}
                </InspectorSection>
              </>
            )}

            <InspectorSection title="Speed / Freeze">
              <InspectorRow label="Speed">
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <input type="range" min={0.1} max={4} step={0.05} value={localSpeed}
                    onChange={(e) => setLocalSpeed(parseFloat(e.target.value))}
                    onMouseUp={() => commitSpeed(localSpeed)}
                    className="range-slider" style={{ flex: 1 }} aria-label="Speed" />
                  <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--color-fg)', minWidth: '36px', textAlign: 'right' }}>{localSpeed.toFixed(2)}×</span>
                </div>
              </InspectorRow>
              <InspectorRow label="Freeze">
                <button className="btn-ghost"
                  onClick={() => { if (!activeSequence) return; dispatch(makeOp('clip.setFreeze', { sequenceId: activeSequence.id, clipId: clip.id, freeze: !clip.freeze, freezeFrame: clip.startTime }), 'Toggle freeze'); }}
                  style={{ fontSize: '11px', padding: '3px 8px', color: clip.freeze ? 'var(--color-accent-2)' : 'var(--color-subtle)', background: clip.freeze ? 'rgba(139,92,246,0.15)' : 'transparent', border: `1px solid ${clip.freeze ? 'rgba(139,92,246,0.4)' : 'var(--color-border)'}` }}
                  aria-pressed={clip.freeze}>
                  {clip.freeze ? 'Frozen' : 'Freeze Frame'}
                </button>
              </InspectorRow>
            </InspectorSection>
          </div>
        )}

        {/* ── Effects ── */}
        {tab === 'effects' && (
          <div>
            <div style={{ marginBottom: '10px' }}>
              <div className="inspector-label" style={{ marginBottom: '5px' }}>Add Effect</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                {Object.keys(EFFECT_DEFINITIONS).map((type) => (
                  <button key={type} className="btn-ghost"
                    onClick={() => addEffect(type)}
                    style={{ fontSize: '10px', padding: '2px 6px', color: 'var(--color-muted)' }}
                    aria-label={`Add ${type} effect`}>
                    {type}
                  </button>
                ))}
              </div>
            </div>
            {clip.effects.length === 0 ? (
              <div style={{ fontSize: '11px', color: 'var(--color-subtle)', textAlign: 'center', padding: '16px' }}>No effects applied</div>
            ) : (
              clip.effects.map((effect) => (
                <EffectCard key={effect.id} effect={effect}
                  onToggle={(enabled) => toggleEffect(effect.id, enabled)}
                  onRemove={() => removeEffect(effect.id)}
                  onSetParam={(key, val) => setEffectParam(effect.id, key, val)}
                  onResetParam={(key) => resetEffectParam(effect.id, key)} />
              ))
            )}
          </div>
        )}

        {/* ── Keyframes ── */}
        {tab === 'keyframes' && (
          <div>
            <div style={{ marginBottom: '8px', fontSize: '11px', color: 'var(--color-subtle)', lineHeight: 1.5 }}>
              Use ◆ buttons in Transform tab to add keyframes at the current playhead position.
            </div>
            {clip.keyframes.length === 0 ? (
              <div style={{ fontSize: '11px', color: 'var(--color-subtle)', textAlign: 'center', padding: '16px' }}>No keyframes</div>
            ) : (
              <div style={{ background: 'var(--color-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                {[...clip.keyframes].sort((a, b) => toSeconds(a.time) - toSeconds(b.time)).map((kf) => (
                  <div key={kf.id} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 8px', borderBottom: '1px solid var(--color-border)' }}>
                    <span style={{ fontSize: '10px', color: 'var(--color-accent-3)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>◆</span>
                    <span style={{ fontSize: '10px', color: 'var(--color-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{kf.property}</span>
                    <span style={{ fontSize: '10px', color: 'var(--color-subtle)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{toTimecode(kf.time, fps)}</span>
                    <select
                      value={kf.easing}
                      onChange={(e) => setKeyframeEasing(kf.id, e.target.value as Keyframe['easing'])}
                      style={{ fontSize: '9px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px', color: 'var(--color-muted)', padding: '1px 3px' }}
                      aria-label="Keyframe easing"
                    >
                      <option value="linear">linear</option>
                      <option value="ease-in">ease-in</option>
                      <option value="ease-out">ease-out</option>
                      <option value="ease-in-out">ease-in-out</option>
                      <option value="hold">hold</option>
                    </select>
                    <button className="btn-icon" onClick={() => removeKeyframe(kf.id)} style={{ fontSize: '10px', color: 'var(--color-danger)', padding: '2px 4px' }} aria-label="Remove keyframe">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Masks ── */}
        {tab === 'masks' && (
          <div>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
              <button className="btn-ghost" onClick={() => addMask('rectangle')} style={{ fontSize: '11px', padding: '4px 10px', flex: 1 }} aria-label="Add rectangle mask">+ Rect</button>
              <button className="btn-ghost" onClick={() => addMask('ellipse')} style={{ fontSize: '11px', padding: '4px 10px', flex: 1 }} aria-label="Add ellipse mask">+ Ellipse</button>
            </div>
            {clip.masks.length === 0 ? (
              <div style={{ fontSize: '11px', color: 'var(--color-subtle)', textAlign: 'center', padding: '16px' }}>No masks</div>
            ) : (
              clip.masks.map((mask) => (
                <MaskCard key={mask.id} mask={mask}
                  onSetProp={(props) => setMaskProp(mask.id, props)}
                  onRemove={() => removeMask(mask.id)} />
              ))
            )}
          </div>
        )}

        {/* ── Audio ── */}
        {tab === 'audio' && (
          <div>
            <InspectorSection title="Gain">
              <InspectorRow label="Gain (dB)">
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <input type="range" min={-60} max={12} step={0.5} value={localVolume}
                    onChange={(e) => setLocalVolume(parseFloat(e.target.value))}
                    onMouseUp={() => commitGain(localVolume)}
                    className="range-slider" style={{ flex: 1 }} aria-label="Gain" />
                  <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--color-fg)', minWidth: '36px', textAlign: 'right' }}>{localVolume > 0 ? '+' : ''}{localVolume.toFixed(1)}</span>
                  <button className="btn-icon" onClick={() => addKeyframe('gain', localVolume)} title="Add keyframe" aria-label="Add gain keyframe" style={{ fontSize: '10px', color: 'var(--color-accent-3)', padding: '2px 4px' }}>◆</button>
                </div>
              </InspectorRow>
            </InspectorSection>

            <InspectorSection title="Pan">
              <InspectorRow label="Pan">
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span style={{ fontSize: '9px', color: 'var(--color-subtle)' }}>L</span>
                  <input type="range" min={-1} max={1} step={0.05} value={localPan}
                    onChange={(e) => setLocalPan(parseFloat(e.target.value))}
                    onMouseUp={() => commitPan(localPan)}
                    className="range-slider" style={{ flex: 1 }} aria-label="Pan" />
                  <span style={{ fontSize: '9px', color: 'var(--color-subtle)' }}>R</span>
                  <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--color-fg)', minWidth: '28px', textAlign: 'right' }}>{localPan > 0 ? '+' : ''}{localPan.toFixed(2)}</span>
                </div>
              </InspectorRow>
            </InspectorSection>

            <InspectorSection title="Fades">
              <InspectorRow label="Fade In (s)">
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <input type="number" min={0} max={10} step={0.1} value={localFadeIn.toFixed(2)}
                    onChange={(e) => setLocalFadeIn(parseFloat(e.target.value) || 0)}
                    onBlur={() => commitFades(localFadeIn, undefined)}
                    className="inspector-input" style={{ flex: 1 }} aria-label="Fade in duration" />
                </div>
              </InspectorRow>
              <InspectorRow label="Fade Out (s)">
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <input type="number" min={0} max={10} step={0.1} value={localFadeOut.toFixed(2)}
                    onChange={(e) => setLocalFadeOut(parseFloat(e.target.value) || 0)}
                    onBlur={() => commitFades(undefined, localFadeOut)}
                    className="inspector-input" style={{ flex: 1 }} aria-label="Fade out duration" />
                </div>
              </InspectorRow>
              <InspectorRow label="Curve">
                <select
                  defaultValue={clip.fadeInType ?? 'linear'}
                  onChange={(e) => { if (!activeSequence) return; dispatch(makeOp('clip.setProps', { sequenceId: activeSequence.id, clipId: clip.id, props: { fadeInType: e.target.value as any } }), 'Set fade curve'); }}
                  style={{ fontSize: '11px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px', color: 'var(--color-muted)', padding: '2px 4px', width: '100%' }}
                  aria-label="Fade curve"
                >
                  <option value="linear">Linear</option>
                  <option value="exponential">Exponential</option>
                  <option value="logarithmic">Logarithmic</option>
                </select>
              </InspectorRow>
            </InspectorSection>

            <InspectorSection title="Role">
              <InspectorRow label="Type">
                <select
                  defaultValue={(clip.graphicParams?.role as string) ?? 'dialogue'}
                  onChange={(e) => { if (!activeSequence) return; dispatch(makeOp('clip.setProps', { sequenceId: activeSequence.id, clipId: clip.id, props: { graphicParams: { ...clip.graphicParams, role: e.target.value } } }), 'Set audio role'); }}
                  style={{ fontSize: '11px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px', color: 'var(--color-muted)', padding: '2px 4px', width: '100%' }}
                  aria-label="Audio role"
                >
                  <option value="dialogue">Dialogue</option>
                  <option value="music">Music</option>
                  <option value="sfx">SFX</option>
                  <option value="ambient">Ambient</option>
                </select>
              </InspectorRow>
            </InspectorSection>
          </div>
        )}

        {/* ── Motion / Graphic Params ── */}
        {tab === 'motion' && (isMotion || isGraphic) && (
          <div>
            {isMotion && (
              <div style={{ padding: '8px', background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: 'var(--radius)', marginBottom: '10px' }}>
                <div style={{ fontSize: '11px', color: 'var(--color-accent-2)', fontWeight: 600, marginBottom: '3px' }}>Motion Item</div>
                <div style={{ fontSize: '10px', color: 'var(--color-subtle)' }}>
                  {clip.motionBundleId ? `Bundle: ${clip.motionBundleId}` : 'No Motion bundle assigned'}
                </div>
              </div>
            )}
            {localGraphicParams && Object.entries(localGraphicParams).map(([key, val]) => (
              <InspectorRow key={key} label={key}>
                {typeof val === 'boolean' ? (
                  <input
                    type="checkbox"
                    checked={Boolean(localGraphicParams[key])}
                    onChange={(e) => {
                      const newVal = e.target.checked;
                      setLocalGraphicParams((prev) => ({ ...prev, [key]: newVal }));
                      if (!activeSequence) return;
                      dispatch(makeOp('graphic.setParam', { sequenceId: activeSequence.id, clipId: clip.id, key, value: newVal }), `Set ${key}`);
                    }}
                    aria-label={key}
                  />
                ) : (
                  <input
                    type={typeof val === 'number' ? 'number' : 'text'}
                    value={String(localGraphicParams[key] ?? '')}
                    onChange={(e) => {
                      const rawVal = e.target.value;
                      const newVal = typeof val === 'number' ? (parseFloat(rawVal) || 0) : rawVal;
                      setLocalGraphicParams((prev) => ({ ...prev, [key]: newVal }));
                    }}
                    onBlur={(e) => {
                      if (!activeSequence) return;
                      const rawVal = e.target.value;
                      const newVal = typeof val === 'number' ? (parseFloat(rawVal) || 0) : rawVal;
                      dispatch(makeOp('graphic.setParam', { sequenceId: activeSequence.id, clipId: clip.id, key, value: newVal }), `Set ${key}`);
                    }}
                    className="inspector-input"
                    style={{ width: '100%' }}
                    aria-label={key}
                    placeholder={key === 'text' ? 'Enter text…' : undefined}
                  />
                )}
              </InspectorRow>
            ))}
            {(!localGraphicParams || Object.keys(localGraphicParams).length === 0) && (
              <div style={{ fontSize: '11px', color: 'var(--color-subtle)', textAlign: 'center', padding: '16px' }}>No parameters</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helper components ──────────────────────────────────────

function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px', paddingBottom: '4px', borderBottom: '1px solid var(--color-border)' }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>{children}</div>
    </div>
  );
}

function InspectorRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minHeight: '24px' }}>
      <span style={{ fontSize: '11px', color: 'var(--color-subtle)', minWidth: '64px', flexShrink: 0, textAlign: 'right' }}>{label}</span>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

function EffectCard({ effect, onToggle, onRemove, onSetParam, onResetParam }: {
  effect: Effect;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
  onSetParam: (key: string, val: number | string | boolean) => void;
  onResetParam: (key: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const def = EFFECT_DEFINITIONS[effect.type as EffectType];

  return (
    <div style={{ background: 'var(--color-elevated)', border: `1px solid ${effect.enabled ? 'var(--color-border)' : 'rgba(244,247,255,0.04)'}`, borderRadius: 'var(--radius)', marginBottom: '6px', overflow: 'hidden', opacity: effect.enabled ? 1 : 0.5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', cursor: 'pointer' }} onClick={() => setExpanded(!expanded)}>
        <button
          className="btn-icon"
          onClick={(e) => { e.stopPropagation(); onToggle(!effect.enabled); }}
          style={{ width: '14px', height: '14px', borderRadius: '3px', background: effect.enabled ? 'var(--color-accent)' : 'var(--color-border)', flexShrink: 0, border: 'none', cursor: 'pointer' }}
          aria-label={effect.enabled ? 'Disable effect' : 'Enable effect'}
          aria-pressed={effect.enabled}
        />
        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-fg)', flex: 1 }}>{effect.type}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 150ms', color: 'var(--color-subtle)' }} aria-hidden="true">
          <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <button className="btn-icon" onClick={(e) => { e.stopPropagation(); onRemove(); }} style={{ fontSize: '10px', color: 'var(--color-danger)', padding: '2px 4px' }} aria-label="Remove effect">✕</button>
      </div>
      {expanded && def && (
        <div style={{ padding: '4px 8px 8px', borderTop: '1px solid var(--color-border)' }}>
          {def.paramDefs.map((param) => (
            <div key={param.key} style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '4px' }}>
              <span style={{ fontSize: '10px', color: 'var(--color-subtle)', minWidth: '72px', textAlign: 'right', flexShrink: 0 }}>{param.label}</span>
              {param.type === 'number' ? (
                <>
                  <input type="range" min={param.min} max={param.max} step={param.step ?? 1}
                    value={Number(effect.params[param.key] ?? param.default)}
                    onChange={(e) => onSetParam(param.key, parseFloat(e.target.value))}
                    className="range-slider" style={{ flex: 1 }} aria-label={param.label} />
                  <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--color-fg)', minWidth: '32px', textAlign: 'right' }}>
                    {Number(effect.params[param.key] ?? param.default).toFixed(1)}
                  </span>
                </>
              ) : param.type === 'boolean' ? (
                <input type="checkbox"
                  checked={Boolean(effect.params[param.key] ?? param.default)}
                  onChange={(e) => onSetParam(param.key, e.target.checked)}
                  aria-label={param.label} />
              ) : (
                <input type="text"
                  defaultValue={String(effect.params[param.key] ?? param.default)}
                  onBlur={(e) => onSetParam(param.key, e.target.value)}
                  className="inspector-input" style={{ flex: 1 }} aria-label={param.label} />
              )}
              <button className="btn-icon" onClick={() => onResetParam(param.key)} title="Reset to default" aria-label={`Reset ${param.label}`} style={{ fontSize: '9px', color: 'var(--color-subtle)', padding: '1px 3px' }}>↺</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MaskCard({ mask, onSetProp, onRemove }: { mask: Mask; onSetProp: (props: Partial<Mask>) => void; onRemove: () => void }) {
  return (
    <div style={{ background: 'var(--color-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', marginBottom: '6px', padding: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-fg)', flex: 1 }}>{mask.shape}</span>
        <button className="btn-ghost" onClick={() => onSetProp({ invert: !mask.invert })}
          style={{ fontSize: '10px', padding: '2px 6px', color: mask.invert ? 'var(--color-accent)' : 'var(--color-subtle)' }}
          aria-pressed={mask.invert} aria-label="Invert mask">Invert</button>
        <button className="btn-icon" onClick={onRemove} style={{ fontSize: '10px', color: 'var(--color-danger)', padding: '2px 4px' }} aria-label="Remove mask">✕</button>
      </div>
      {[
        { label: 'X', key: 'x' as const, min: 0, max: 1, step: 0.01 },
        { label: 'Y', key: 'y' as const, min: 0, max: 1, step: 0.01 },
        { label: 'W', key: 'width' as const, min: 0.01, max: 1, step: 0.01 },
        { label: 'H', key: 'height' as const, min: 0.01, max: 1, step: 0.01 },
        { label: 'Feather', key: 'feather' as const, min: 0, max: 0.5, step: 0.01 },
        { label: 'Rotation', key: 'rotation' as const, min: -180, max: 180, step: 1 },
      ].map(({ label, key, min, max, step }) => (
        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '3px' }}>
          <span style={{ fontSize: '10px', color: 'var(--color-subtle)', minWidth: '48px', textAlign: 'right' }}>{label}</span>
          <input type="range" min={min} max={max} step={step}
            value={mask[key] ?? 0}
            onChange={(e) => onSetProp({ [key]: parseFloat(e.target.value) })}
            className="range-slider" style={{ flex: 1 }} aria-label={label} />
          <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--color-fg)', minWidth: '32px', textAlign: 'right' }}>
            {Number(mask[key] ?? 0).toFixed(2)}
          </span>
        </div>
      ))}
    </div>
  );
}