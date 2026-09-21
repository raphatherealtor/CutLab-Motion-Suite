'use client';

/**
 * CreativeMacrosPanel — Semantic macro controls over canonical Motion parameters.
 * Macros expand into ordinary canonical Motion parameter edits through the normal transaction path.
 * The evaluator does NOT read a separate macro state.
 * Changing a macro compiles into normal Motion parameter changes through the transaction system.
 */

import React, { useState, useCallback } from 'react';
import { useEngine } from '@/engine/store';
import { resolveClipMotionDocument, motionTransactionToStudioOps } from '@/engine/motion-bridge';
import type { MotionBehavior, MotionMaterial } from '@/motion/types';
import { makeMotionOp, createMotionTransaction } from '@/motion/transaction';
import { secondsToMotionTime, motionTimeToSeconds, hexToMotionColor } from '@/motion/types';
import { generateMotionId } from '@/motion/utils';

// ── Macro Definitions ─────────────────────────────────────────

interface MacroDef {
  id: string;
  label: string;
  icon: string;
  desc: string;
  affectedParams: string;
  min: number;
  max: number;
  default: number;
  color: string;
}

const MACROS: MacroDef[] = [
  { id: 'energy', label: 'Energy', icon: '⚡', desc: 'Overall animation intensity and speed', affectedParams: 'behavior durations, stagger timing, pulse amplitude', min: 0, max: 10, default: 5, color: '#F59E0B' },
  { id: 'depth', label: 'Depth', icon: '⊡', desc: 'Z-depth and parallax intensity', affectedParams: 'z positions, depth values, parallax behaviors', min: 0, max: 10, default: 3, color: '#3B82F6' },
  { id: 'punch', label: 'Punch', icon: '✦', desc: 'Scale overshoot and impact on key moments', affectedParams: 'scale-in overshoot, bounce easing, impact amplitude', min: 0, max: 10, default: 4, color: '#EF4444' },
  { id: 'polish', label: 'Polish', icon: '◈', desc: 'Easing refinement and motion smoothness', affectedParams: 'easing curves on all behaviors', min: 0, max: 10, default: 7, color: '#8B5CF6' },
  { id: 'readability', label: 'Readability', icon: '📖', desc: 'Text contrast, size, and legibility protection', affectedParams: 'font size, opacity floor, contrast', min: 0, max: 10, default: 8, color: '#10B981' },
  { id: 'spatial', label: 'Spatial Immersion', icon: '🌐', desc: 'Camera movement and 2.5D depth theater', affectedParams: 'camera Z, depth theater, parallax strength', min: 0, max: 10, default: 4, color: '#06B6D4' },
  { id: 'texture', label: 'Surface Texture', icon: '◻', desc: 'Material richness and surface treatment', affectedParams: 'material type, procedural params', min: 0, max: 10, default: 3, color: '#F97316' },
  { id: 'camera', label: 'Camera Energy', icon: '📷', desc: 'Camera push/pull and movement intensity', affectedParams: 'camera keyframes, FOV, push/pull amount', min: 0, max: 10, default: 3, color: '#EC4899' },
  { id: 'wrap', label: 'Wrap Depth', icon: '⟳', desc: 'Wraparound and curved spatial presentation', affectedParams: 'rotation keyframes, wraparound behaviors', min: 0, max: 10, default: 2, color: '#A78BFA' },
];

// ── Macro Preset Combinations ─────────────────────────────────

const MACRO_PRESETS = [
  { id: 'cinematic', label: 'Cinematic', values: { energy: 4, depth: 7, punch: 3, polish: 9, readability: 8, spatial: 7, texture: 5, camera: 5, wrap: 3 } },
  { id: 'energetic', label: 'Energetic', values: { energy: 9, depth: 4, punch: 8, polish: 5, readability: 7, spatial: 4, texture: 4, camera: 7, wrap: 2 } },
  { id: 'editorial', label: 'Editorial', values: { energy: 3, depth: 5, punch: 2, polish: 9, readability: 9, spatial: 5, texture: 3, camera: 2, wrap: 2 } },
  { id: 'immersive', label: 'Immersive', values: { energy: 5, depth: 9, punch: 4, polish: 7, readability: 7, spatial: 9, texture: 6, camera: 6, wrap: 7 } },
  { id: 'minimal', label: 'Minimal', values: { energy: 2, depth: 2, punch: 1, polish: 9, readability: 10, spatial: 2, texture: 1, camera: 1, wrap: 1 } },
];

// ── Calibration Bands ─────────────────────────────────────────

const CALIBRATION_BANDS = [
  { id: 'subtle', label: 'Subtle', icon: '◌', desc: 'Barely perceptible — refined, professional', multiplier: 0.3 },
  { id: 'musical', label: 'Musical', icon: '♩', desc: 'Rhythmic and expressive — feels alive', multiplier: 0.6 },
  { id: 'strong', label: 'Strong', icon: '◈', desc: 'Clearly present — confident and direct', multiplier: 0.85 },
  { id: 'aggressive', label: 'Aggressive', icon: '✦', desc: 'Maximum expression — high impact', multiplier: 1.0 },
];

interface CreativeMacrosPanelProps {
  clipId: string;
}

export default function CreativeMacrosPanel({ clipId }: CreativeMacrosPanelProps) {
  const engine = useEngine();
  const { project, activeSequence, dispatchBatch } = engine;

  const clip = activeSequence?.clips.find((c) => c.id === clipId) ?? null;
  const doc = clip && project ? resolveClipMotionDocument(project, clip) : null;

  const [macroValues, setMacroValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(MACROS.map((m) => [m.id, m.default]))
  );
  const [showAffected, setShowAffected] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [activeBand, setActiveBand] = useState<string | null>(null);

  const applyMotionOps = useCallback((ops: ReturnType<typeof makeMotionOp>[], description: string) => {
    if (!project || !doc) return;
    const transaction = createMotionTransaction(description, ops);
    const studioOps = motionTransactionToStudioOps(transaction, project);
    if (studioOps.length > 0) dispatchBatch(studioOps, description);
  }, [project, doc, dispatchBatch]);

  if (!doc) {
    return (
      <div style={{ padding: '16px', textAlign: 'center', fontSize: '11px', color: 'var(--color-muted)' }}>
        Select a Motion clip to use macros
      </div>
    );
  }

  const expandMacro = (macroId: string, value: number) => {
    if (!doc) return;
    const ops: ReturnType<typeof makeMotionOp>[] = [];
    const docDurSecs = motionTimeToSeconds(doc.duration);
    const rootObjs = doc.rootObjectIds.map((id) => doc.objects[id]).filter(Boolean);

    switch (macroId) {
      case 'energy': {
        // Expand: behavior durations, stagger timing, pulse amplitude
        const energyScale = value / 5; // 1.0 at default
        for (const obj of rootObjs) {
          const updatedBehaviors = obj.behaviors.map((b) => ({
            ...b,
            duration: secondsToMotionTime(Math.max(0.1, motionTimeToSeconds(b.duration) / Math.max(0.1, energyScale))),
            params: {
              ...b.params,
              ...(b.type === 'pulse' ? { amplitude: 0.05 * energyScale } : {}),
              ...(b.type === 'shake' ? { amplitude: 3 * energyScale } : {}),
              ...(b.type === 'word-by-word' ? { stagger: (b.params.stagger as number ?? 0.08) / Math.max(0.1, energyScale) } : {}),
            },
          }));
          if (updatedBehaviors.length > 0) {
            ops.push(makeMotionOp('motion.setObjectProp', doc.id, { objectId: obj.id, props: { behaviors: updatedBehaviors } }));
          }
        }
        break;
      }

      case 'depth': {
        // Expand: z positions, depth values, parallax
        const depthScale = value / 3;
        for (let i = 0; i < rootObjs.length; i++) {
          const obj = rootObjs[i];
          const layerDepth = (i - Math.floor(rootObjs.length / 2)) * depthScale;
          ops.push(makeMotionOp('motion.setObjectProp', doc.id, { objectId: obj.id, props: { depth: layerDepth } }));
          ops.push(makeMotionOp('motion.setObjectTransform', doc.id, { objectId: obj.id, transform: { position: { ...obj.transform.position, z: layerDepth * 80 } } }));
        }
        // Also add parallax behaviors proportional to depth
        if (value > 4) {
          for (const obj of rootObjs) {
            const parallaxStrength = (obj.depth ?? 0) * 0.04 * (value / 5);
            if (Math.abs(parallaxStrength) > 0.001) {
              const existingParallax = obj.behaviors.find((b) => b.type === 'signal-reactive' && b.params.property === 'position.x');
              if (!existingParallax) {
                const beh: MotionBehavior = {
                  id: generateMotionId('beh'), type: 'signal-reactive',
                  startTime: secondsToMotionTime(0), duration: secondsToMotionTime(docDurSecs),
                  params: { property: 'position.x', min: -25 * parallaxStrength, max: 25 * parallaxStrength },
                  easing: 'linear',
                };
                ops.push(makeMotionOp('motion.addBehavior', doc.id, { objectId: obj.id, behavior: beh }));
              }
            }
          }
        }
        break;
      }

      case 'punch': {
        // Expand: scale-in overshoot, bounce easing
        const punchAmt = value / 5;
        for (const obj of rootObjs) {
          const existingScaleIn = obj.behaviors.find((b) => b.type === 'scale-in');
          if (existingScaleIn) {
            const updated = { ...existingScaleIn, params: { ...existingScaleIn.params, fromScale: Math.max(0, 1.3 * punchAmt), overshoot: 0.2 * punchAmt }, easing: 'bounce' as const };
            ops.push(makeMotionOp('motion.removeBehavior', doc.id, { objectId: obj.id, behaviorId: existingScaleIn.id }));
            ops.push(makeMotionOp('motion.addBehavior', doc.id, { objectId: obj.id, behavior: updated }));
          } else if (value > 3) {
            const newBeh: MotionBehavior = {
              id: generateMotionId('beh'), type: 'scale-in',
              startTime: secondsToMotionTime(0), duration: secondsToMotionTime(0.3),
              params: { fromScale: 1.3 * punchAmt, overshoot: 0.15 * punchAmt },
              easing: 'bounce',
            };
            ops.push(makeMotionOp('motion.addBehavior', doc.id, { objectId: obj.id, behavior: newBeh }));
          }
        }
        break;
      }

      case 'polish': {
        // Expand: easing quality on all behaviors
        const easingMap: Record<number, MotionBehavior['easing']> = {
          0: 'linear', 3: 'ease-out', 5: 'ease-in-out', 7: 'spring', 10: 'elastic',
        };
        const closestKey = Object.keys(easingMap).reduce((prev, curr) => Math.abs(+curr - value) < Math.abs(+prev - value) ? curr : prev);
        const easing = easingMap[+closestKey] ?? 'ease-in-out';
        for (const obj of rootObjs) {
          const updatedBehaviors = obj.behaviors.map((b) => ({ ...b, easing }));
          if (updatedBehaviors.length > 0) {
            ops.push(makeMotionOp('motion.setObjectProp', doc.id, { objectId: obj.id, props: { behaviors: updatedBehaviors } }));
          }
        }
        break;
      }

      case 'readability': {
        // Expand: font size boost, contrast, opacity floor
        // Readability protects its own domain — higher value = more protection
        const readScale = value / 8;
        for (const obj of rootObjs) {
          if (obj.kind === 'text' && obj.textSegments?.[0]) {
            const seg = obj.textSegments[0];
            // Protect minimum font size
            const minFontSize = 18 + value * 2;
            const newFontSize = Math.max(minFontSize, (seg.fontSize ?? 48));
            if (newFontSize !== seg.fontSize) {
              ops.push(makeMotionOp('motion.setTextSegment', doc.id, { objectId: obj.id, segment: { ...seg, fontSize: newFontSize } }));
            }
          }
          // Ensure opacity doesn't go below readability floor
          const opacityFloor = 0.5 + readScale * 0.4;
          if (obj.transform.opacity < opacityFloor) {
            ops.push(makeMotionOp('motion.setObjectTransform', doc.id, { objectId: obj.id, transform: { opacity: opacityFloor } }));
          }
        }
        break;
      }

      case 'spatial': {
        // Expand: camera movement, depth theater
        const spatialScale = value / 4;
        if (doc.camera) {
          const newCam = {
            ...doc.camera,
            keyframes: [
              ...doc.camera.keyframes.filter((k) => k.property !== 'position.z'),
              { id: generateMotionId('kf'), time: secondsToMotionTime(0), property: 'position.z', value: -800 - spatialScale * 200, easing: 'ease-in-out' as const },
              { id: generateMotionId('kf'), time: secondsToMotionTime(docDurSecs), property: 'position.z', value: -800 + spatialScale * 100, easing: 'ease-in-out' as const },
            ],
          };
          ops.push(makeMotionOp('motion.setCamera', doc.id, { camera: newCam }));
        } else if (value > 3) {
          const newCam = {
            id: generateMotionId('cam'), name: 'Camera',
            transform: { position: { x: 0, y: 0, z: -800 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, anchor: { x: 0, y: 0, z: 0 }, opacity: 1 },
            keyframes: [
              { id: generateMotionId('kf'), time: secondsToMotionTime(0), property: 'position.z', value: -800, easing: 'ease-in-out' as const },
              { id: generateMotionId('kf'), time: secondsToMotionTime(docDurSecs), property: 'position.z', value: -800 + spatialScale * 100, easing: 'ease-in-out' as const },
            ],
            fov: 60, near: 1, far: 10000,
          };
          ops.push(makeMotionOp('motion.setCamera', doc.id, { camera: newCam }));
        }
        break;
      }

      case 'texture': {
        // Expand: material richness — calibrated, not extreme
        const textureTypes: MotionMaterial['type'][] = ['flat', 'flat', 'flat', 'flat', 'glass', 'glass', 'metal', 'procedural', 'procedural', 'neon', 'neon'];
        const matType = textureTypes[Math.min(10, Math.round(value))] ?? 'flat';
        for (const obj of rootObjs) {
          if (obj.kind === 'text') {
            const mat: MotionMaterial = {
              id: generateMotionId('mat'),
              type: matType,
              color: obj.material?.color ?? hexToMotionColor('#ffffff'),
              opacity: 1,
              ...(matType === 'procedural' ? { params: { style: value > 7 ? 'chrome' : 'paper' } } : {}),
              ...(matType === 'neon' ? { params: { glowRadius: 15 + value * 2 } } : {}),
            };
            ops.push(makeMotionOp('motion.setMaterial', doc.id, { objectId: obj.id, material: mat }));
          }
        }
        break;
      }

      case 'camera': {
        // Expand: camera keyframes for push/pull — calibrated
        const camEnergy = value / 3;
        const pushAmount = camEnergy * 60; // max ~200px at value=10
        if (!doc.camera) {
          const newCam = {
            id: generateMotionId('cam'), name: 'Camera',
            transform: { position: { x: 0, y: 0, z: -800 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, anchor: { x: 0, y: 0, z: 0 }, opacity: 1 },
            keyframes: [
              { id: generateMotionId('kf'), time: secondsToMotionTime(0), property: 'position.z', value: -800, easing: 'ease-in-out' as const },
              { id: generateMotionId('kf'), time: secondsToMotionTime(docDurSecs * 0.5), property: 'position.z', value: -800 + pushAmount, easing: 'ease-in-out' as const },
              { id: generateMotionId('kf'), time: secondsToMotionTime(docDurSecs), property: 'position.z', value: -800 + pushAmount * 0.5, easing: 'ease-in-out' as const },
            ],
            fov: Math.max(30, 60 - camEnergy * 3),
            near: 1, far: 10000,
          };
          ops.push(makeMotionOp('motion.setCamera', doc.id, { camera: newCam }));
        } else {
          const updatedCam = {
            ...doc.camera,
            fov: Math.max(30, 60 - camEnergy * 3),
            keyframes: [
              ...doc.camera.keyframes.filter((k) => k.property !== 'position.z'),
              { id: generateMotionId('kf'), time: secondsToMotionTime(0), property: 'position.z', value: -800, easing: 'ease-in-out' as const },
              { id: generateMotionId('kf'), time: secondsToMotionTime(docDurSecs), property: 'position.z', value: -800 + pushAmount, easing: 'ease-in-out' as const },
            ],
          };
          ops.push(makeMotionOp('motion.setCamera', doc.id, { camera: updatedCam }));
        }
        break;
      }

      case 'wrap': {
        // Expand: wraparound/curved presentation via rotation keyframes — calibrated
        const wrapAmt = value / 2;
        for (const obj of rootObjs) {
          if (obj.kind === 'text') {
            const wrapBeh: MotionBehavior = {
              id: generateMotionId('beh'), type: 'signal-reactive',
              startTime: secondsToMotionTime(0), duration: secondsToMotionTime(docDurSecs),
              params: { property: 'rotation.y', min: -wrapAmt * 12, max: wrapAmt * 12 },
              easing: 'ease-in-out',
            };
            // Only add if not already present
            const existingWrap = obj.behaviors.find((b) => b.params.property === 'rotation.y');
            if (!existingWrap) {
              ops.push(makeMotionOp('motion.addBehavior', doc.id, { objectId: obj.id, behavior: wrapBeh }));
            } else {
              const updated = { ...existingWrap, params: { ...existingWrap.params, min: -wrapAmt * 12, max: wrapAmt * 12 } };
              ops.push(makeMotionOp('motion.removeBehavior', doc.id, { objectId: obj.id, behaviorId: existingWrap.id }));
              ops.push(makeMotionOp('motion.addBehavior', doc.id, { objectId: obj.id, behavior: updated }));
            }
          }
        }
        break;
      }
    }

    if (ops.length > 0) {
      applyMotionOps(ops, `Macro: ${macroId} = ${value}`);
    }
  };

  const handleMacroChange = (macroId: string, value: number) => {
    setMacroValues((prev) => ({ ...prev, [macroId]: value }));
  };

  const handleMacroCommit = (macroId: string, value: number) => {
    setMacroValues((prev) => ({ ...prev, [macroId]: value }));
    expandMacro(macroId, value);
  };

  const applyPreset = (preset: typeof MACRO_PRESETS[0]) => {
    setActivePreset(preset.id);
    setMacroValues(preset.values);
    // Apply all macros in one batch
    const allOps: ReturnType<typeof makeMotionOp>[] = [];
    // We'll apply each macro's ops sequentially
    Object.entries(preset.values).forEach(([macroId, value]) => {
      // Collect ops without dispatching
      expandMacro(macroId, value);
    });
  };

  return (
    <div style={{ padding: '8px' }}>
      <div style={{ fontSize: '10px', color: 'var(--color-subtle)', marginBottom: '8px', lineHeight: 1.5 }}>
        Macros expand into canonical Motion ops through the normal transaction path. Changes are undoable.
      </div>

      {/* Calibration bands */}
      <div style={{ marginBottom: '10px' }}>
        <Label>Calibration Band</Label>
        <div style={{ display: 'flex', gap: '3px' }}>
          {CALIBRATION_BANDS.map((band) => (
            <button
              key={band.id}
              onClick={() => {
                setActiveBand(band.id);
                // Scale all macros by band multiplier relative to their defaults
                const scaled = Object.fromEntries(
                  MACROS.map((m) => {
                    const scaledVal = Math.round(m.default * band.multiplier * 2) / 2;
                    return [m.id, Math.max(m.min, Math.min(m.max, scaledVal))];
                  })
                );
                setMacroValues(scaled);
                setActivePreset(null);
                // Apply all macros
                Object.entries(scaled).forEach(([macroId, value]) => expandMacro(macroId, value));
              }}
              title={band.desc}
              style={{
                flex: 1, fontSize: '9px', padding: '4px 2px',
                background: activeBand === band.id ? 'rgba(139,92,246,0.15)' : 'var(--color-well)',
                border: `1px solid ${activeBand === band.id ? 'rgba(139,92,246,0.4)' : 'var(--color-border)'}`,
                borderRadius: '3px', color: activeBand === band.id ? 'var(--color-accent-2)' : 'var(--color-muted)',
                cursor: 'pointer', fontFamily: 'var(--font-sans)', textAlign: 'center',
              }}
            >
              <div>{band.icon}</div>
              <div style={{ marginTop: '1px' }}>{band.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Preset combinations */}
      <div style={{ marginBottom: '10px' }}>
        <Label>Preset Combinations</Label>
        <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
          {MACRO_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => applyPreset(preset)}
              style={{ fontSize: '9px', padding: '3px 8px', background: activePreset === preset.id ? 'rgba(139,92,246,0.15)' : 'var(--color-well)', border: `1px solid ${activePreset === preset.id ? 'rgba(139,92,246,0.4)' : 'var(--color-border)'}`, borderRadius: '10px', color: activePreset === preset.id ? 'var(--color-accent-2)' : 'var(--color-muted)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
            >{preset.label}</button>
          ))}
        </div>
      </div>

      {MACROS.map((macro) => {
        const value = macroValues[macro.id] ?? macro.default;

        return (
          <div key={macro.id} style={{ marginBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
              <span style={{ fontSize: '12px', flexShrink: 0 }}>{macro.icon}</span>
              <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-fg)', flex: 1 }}>{macro.label}</span>
              <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: macro.color, minWidth: '20px', textAlign: 'right' }}>{value.toFixed(1)}</span>
              <button
                onClick={() => setShowAffected(showAffected === macro.id ? null : macro.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-subtle)', fontSize: '9px', padding: '0 2px' }}
                title="Show affected parameters"
                aria-label="Show affected parameters"
              >?</button>
            </div>

            {showAffected === macro.id && (
              <div style={{ fontSize: '9px', color: 'var(--color-subtle)', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px', padding: '4px 6px', marginBottom: '4px', lineHeight: 1.5 }}>
                <strong style={{ color: 'var(--color-fg)' }}>{macro.desc}</strong><br />
                Affects: {macro.affectedParams}
              </div>
            )}

            <div style={{ position: 'relative' }}>
              <input
                type="range"
                min={macro.min}
                max={macro.max}
                step={0.5}
                value={value}
                onChange={(e) => handleMacroChange(macro.id, +e.target.value)}
                onMouseUp={(e) => handleMacroCommit(macro.id, +(e.target as HTMLInputElement).value)}
                onTouchEnd={(e) => handleMacroCommit(macro.id, +(e.target as HTMLInputElement).value)}
                className="range-slider"
                style={{ width: '100%', accentColor: macro.color }}
                aria-label={`${macro.label} macro`}
              />
              {/* Center marker */}
              <div style={{ position: 'absolute', top: '50%', left: `${((macro.default - macro.min) / (macro.max - macro.min)) * 100}%`, transform: 'translate(-50%, -50%)', width: '1px', height: '8px', background: 'rgba(244,247,255,0.2)', pointerEvents: 'none' }} aria-hidden="true" />
            </div>
          </div>
        );
      })}

      <button
        onClick={() => {
          const defaults = Object.fromEntries(MACROS.map((m) => [m.id, m.default]));
          setMacroValues(defaults);
          setActivePreset(null);
        }}
        style={{ width: '100%', padding: '5px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px', color: 'var(--color-muted)', cursor: 'pointer', fontSize: '10px', fontFamily: 'var(--font-sans)', marginTop: '4px' }}
      >
        Reset to Defaults
      </button>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: '9px', fontWeight: 600, color: 'var(--color-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px', marginTop: '2px' }}>{children}</div>;
}
