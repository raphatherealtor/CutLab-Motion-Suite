'use client';

/**
 * SpatialDepthPanel — Full compositional 2.5D system.
 * Plane stacks, custom z-depth, parallax, camera push/pull/drift,
 * corridor/stage/tunnel/carousel, foreground overlap, frame breaks,
 * subject occlusion, wraparound. Direct per-layer depth authoring.
 */

import React, { useState, useCallback } from 'react';
import { useEngine } from '@/engine/store';
import { resolveClipMotionDocument, motionTransactionToStudioOps } from '@/engine/motion-bridge';
import type { MotionDocument, MotionObject, MotionBehavior, MotionMaterial } from '@/engine/motion-document';
import { makeOp as makeMotionOp, createMotionTransaction, generateMotionId, secondsToMotionTime, motionTimeToSeconds } from '@/engine/motion-document-utils';

// ── Spatial Rigs ──────────────────────────────────────────────

const SPATIAL_RIGS = [
  {
    id: 'plane-stack', label: 'Plane Stack', icon: '⊟', desc: 'Distribute objects across depth planes',
    apply: (doc: MotionDocument) => {
      const ops: ReturnType<typeof makeMotionOp>[] = [];
      const objs = doc.rootObjectIds.map((id) => doc.objects[id]).filter(Boolean);
      const count = objs.length;
      objs.forEach((obj, i) => {
        const depth = (i / Math.max(1, count - 1)) * 6 - 3;
        const z = depth * 100;
        ops.push(makeMotionOp('motion.setObjectProp', doc.id, { objectId: obj.id, props: { depth } }));
        ops.push(makeMotionOp('motion.setObjectTransform', doc.id, { objectId: obj.id, transform: { z } }));
      });
      return ops;
    },
  },
  {
    id: 'foreground-bg', label: 'Fore/Background', icon: '⬡', desc: 'Split objects into foreground and background layers',
    apply: (doc: MotionDocument) => {
      const ops: ReturnType<typeof makeMotionOp>[] = [];
      const objs = doc.rootObjectIds.map((id) => doc.objects[id]).filter(Boolean);
      objs.forEach((obj, i) => {
        const isFg = i % 2 === 0;
        ops.push(makeMotionOp('motion.setObjectProp', doc.id, { objectId: obj.id, props: { depth: isFg ? 2 : -2, occlusionRole: isFg ? 'foreground' : 'background' } }));
        ops.push(makeMotionOp('motion.setObjectTransform', doc.id, { objectId: obj.id, transform: { z: isFg ? 200 : -200 } }));
      });
      return ops;
    },
  },
  {
    id: 'corridor', label: 'Corridor', icon: '⊞', desc: 'Receding corridor perspective arrangement',
    apply: (doc: MotionDocument) => {
      const ops: ReturnType<typeof makeMotionOp>[] = [];
      const objs = doc.rootObjectIds.map((id) => doc.objects[id]).filter(Boolean);
      objs.forEach((obj, i) => {
        const t = i / Math.max(1, objs.length - 1);
        const z = -t * 600;
        const scale = 1 - t * 0.4;
        ops.push(makeMotionOp('motion.setObjectProp', doc.id, { objectId: obj.id, props: { depth: -t * 4 } }));
        ops.push(makeMotionOp('motion.setObjectTransform', doc.id, { objectId: obj.id, transform: { z, scaleX: scale, scaleY: scale } }));
      });
      return ops;
    },
  },
  {
    id: 'stage', label: 'Stage', icon: '🎭', desc: 'Stage arrangement with wings and center',
    apply: (doc: MotionDocument) => {
      const ops: ReturnType<typeof makeMotionOp>[] = [];
      const objs = doc.rootObjectIds.map((id) => doc.objects[id]).filter(Boolean);
      const positions = [
        { x: 0, y: 0, z: 0, depth: 0 },
        { x: -400, y: 50, z: -200, depth: -2 },
        { x: 400, y: 50, z: -200, depth: -2 },
        { x: -600, y: 100, z: -400, depth: -4 },
        { x: 600, y: 100, z: -400, depth: -4 },
      ];
      objs.forEach((obj, i) => {
        const pos = positions[i % positions.length];
        ops.push(makeMotionOp('motion.setObjectProp', doc.id, { objectId: obj.id, props: { depth: pos.depth } }));
        ops.push(makeMotionOp('motion.setObjectTransform', doc.id, { objectId: obj.id, transform: { x: pos.x, y: pos.y, z: pos.z } }));
      });
      return ops;
    },
  },
  {
    id: 'carousel', label: 'Carousel', icon: '○', desc: 'Circular carousel arrangement',
    apply: (doc: MotionDocument) => {
      const ops: ReturnType<typeof makeMotionOp>[] = [];
      const objs = doc.rootObjectIds.map((id) => doc.objects[id]).filter(Boolean);
      const radius = 300;
      objs.forEach((obj, i) => {
        const angle = (i / objs.length) * Math.PI * 2;
        const x = Math.sin(angle) * radius;
        const z = Math.cos(angle) * radius - radius;
        const depth = Math.cos(angle) * 3;
        ops.push(makeMotionOp('motion.setObjectProp', doc.id, { objectId: obj.id, props: { depth } }));
        ops.push(makeMotionOp('motion.setObjectTransform', doc.id, { objectId: obj.id, transform: { x, y: 0, z } }));
      });
      return ops;
    },
  },
  {
    id: 'tunnel', label: 'Tunnel', icon: '◎', desc: 'Tunnel/vortex depth arrangement',
    apply: (doc: MotionDocument) => {
      const ops: ReturnType<typeof makeMotionOp>[] = [];
      const objs = doc.rootObjectIds.map((id) => doc.objects[id]).filter(Boolean);
      objs.forEach((obj, i) => {
        const t = i / Math.max(1, objs.length - 1);
        const angle = t * Math.PI * 4;
        const radius = 50 + t * 200;
        const x = Math.sin(angle) * radius;
        const y = Math.cos(angle) * radius * 0.5;
        const z = -t * 800;
        ops.push(makeMotionOp('motion.setObjectProp', doc.id, { objectId: obj.id, props: { depth: -t * 5 } }));
        ops.push(makeMotionOp('motion.setObjectTransform', doc.id, { objectId: obj.id, transform: { x, y, z } }));
      });
      return ops;
    },
  },
  {
    id: 'wall-frame', label: 'Wall/Frame', icon: '▭', desc: 'Flat wall with frame-breaking foreground',
    apply: (doc: MotionDocument) => {
      const ops: ReturnType<typeof makeMotionOp>[] = [];
      const objs = doc.rootObjectIds.map((id) => doc.objects[id]).filter(Boolean);
      objs.forEach((obj, i) => {
        const isFrame = i === 0;
        const depth = isFrame ? 3 : -1;
        const z = isFrame ? 300 : -100;
        ops.push(makeMotionOp('motion.setObjectProp', doc.id, { objectId: obj.id, props: { depth, occlusionRole: isFrame ? 'foreground' : 'background' } }));
        ops.push(makeMotionOp('motion.setObjectTransform', doc.id, { objectId: obj.id, transform: { z } }));
      });
      return ops;
    },
  },
  {
    id: 'depth-theater', label: 'Depth Theater', icon: '⬡', desc: 'Full depth theater: deep bg, mid, fg, frame-break',
    apply: (doc: MotionDocument) => {
      const ops: ReturnType<typeof makeMotionOp>[] = [];
      const objs = doc.rootObjectIds.map((id) => doc.objects[id]).filter(Boolean);
      const layers = [
        { depth: -5, z: -500, occlusionRole: 'background' as const },
        { depth: -2, z: -200, occlusionRole: 'background' as const },
        { depth: 0, z: 0, occlusionRole: 'none' as const },
        { depth: 2, z: 200, occlusionRole: 'foreground' as const },
        { depth: 4, z: 400, occlusionRole: 'foreground' as const },
      ];
      objs.forEach((obj, i) => {
        const layer = layers[Math.min(i, layers.length - 1)];
        ops.push(makeMotionOp('motion.setObjectProp', doc.id, { objectId: obj.id, props: { depth: layer.depth, occlusionRole: layer.occlusionRole } }));
        ops.push(makeMotionOp('motion.setObjectTransform', doc.id, { objectId: obj.id, transform: { z: layer.z } }));
      });
      return ops;
    },
  },
];

// ── Camera Moves ──────────────────────────────────────────────

const CAMERA_MOVES = [
  { id: 'push-in', label: 'Push In', icon: '→', desc: 'Camera pushes toward subject', zStart: 0, zEnd: 200 },
  { id: 'pull-out', label: 'Pull Out', icon: '←', desc: 'Camera pulls back from subject', zStart: 0, zEnd: -200 },
  { id: 'drift-right', label: 'Drift Right', icon: '↗', desc: 'Slow rightward camera drift', xStart: -50, xEnd: 50 },
  { id: 'drift-left', label: 'Drift Left', icon: '↖', desc: 'Slow leftward camera drift', xStart: 50, xEnd: -50 },
  { id: 'rise', label: 'Rise', icon: '↑', desc: 'Camera rises upward', yStart: 30, yEnd: -30 },
  { id: 'fall', label: 'Fall', icon: '↓', desc: 'Camera falls downward', yStart: -30, yEnd: 30 },
  { id: 'parallax-float', label: 'Parallax Float', icon: '⊡', desc: 'Gentle parallax float', xStart: -20, xEnd: 20, yStart: 10, yEnd: -10 },
  { id: 'orbit-right', label: 'Orbit Right', icon: '↻', desc: 'Slow orbital camera move', xStart: -100, xEnd: 100, zStart: -50, zEnd: -50 },
];

// ── Depth Compositions ────────────────────────────────────────

const DEPTH_COMPOSITIONS = [
  {
    id: 'semantic-depth-caption',
    label: 'Semantic Depth Caption',
    icon: '🎙',
    desc: 'Transcript-bound, active word depth, emphasis response',
    category: 'caption',
  },
  {
    id: 'behind-subject-editorial',
    label: 'Behind-Subject Editorial',
    icon: '⬡',
    desc: 'Subject relation, partial occlusion, depth separation',
    category: 'caption',
  },
  {
    id: 'projector-typography',
    label: 'Projector Typography',
    icon: '💡',
    desc: 'Layered text, cast-shadow/projector feel, camera response',
    category: 'title',
  },
  {
    id: 'plane-stack-headline',
    label: 'Plane-Stack Headline',
    icon: '⊟',
    desc: 'Multiple words/phrases across shallow depth, camera push',
    category: 'title',
  },
  {
    id: 'beat-reactive-card',
    label: 'Beat-Reactive Card',
    icon: '🎵',
    desc: 'Visible audio bindings, subtle depth/scale response',
    category: 'card',
  },
  {
    id: 'corridor-stage-title',
    label: 'Corridor/Stage Title',
    icon: '⊞',
    desc: 'Structured spatial environment, title moving through structure',
    category: 'title',
  },
  {
    id: 'frame-break-composition',
    label: 'Frame-Break Composition',
    icon: '⊠',
    desc: 'Text/graphic intentionally crossing visible frame hierarchy',
    category: 'graphic',
  },
  {
    id: 'wraparound-editorial',
    label: 'Wraparound Editorial',
    icon: '⟳',
    desc: 'Curved/spatial text arrangement, foreground/background transition',
    category: 'editorial',
  },
];

const numInputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px',
  color: 'var(--color-fg)', fontSize: '11px', fontFamily: 'var(--font-mono)', padding: '3px 6px', boxSizing: 'border-box',
};

interface SpatialDepthPanelProps {
  clipId: string;
}

export default function SpatialDepthPanel({ clipId }: SpatialDepthPanelProps) {
  const engine = useEngine();
  const { project, activeSequence, dispatchBatch } = engine;

  const clip = activeSequence?.clips.find((c) => c.id === clipId) ?? null;
  const doc = clip && project ? resolveClipMotionDocument(project, clip) : null;

  const [cameraZ, setCameraZ] = useState(-800);
  const [cameraFov, setCameraFov] = useState(60);
  const [cameraDof, setCameraDof] = useState(false);
  const [activeTab, setActiveTab] = useState<'rigs' | 'camera' | 'parallax' | 'compositions' | 'layers'>('rigs');
  const [compCategory, setCompCategory] = useState<'all' | 'caption' | 'title' | 'card' | 'graphic' | 'editorial'>('all');

  const applyMotionOps = useCallback((ops: ReturnType<typeof makeMotionOp>[], description: string) => {
    if (!project || !doc) return;
    const transaction = createMotionTransaction(description, ops);
    const studioOps = motionTransactionToStudioOps(transaction, project);
    if (studioOps.length > 0) dispatchBatch(studioOps, description);
  }, [project, doc, dispatchBatch]);

  if (!doc) {
    return (
      <div style={{ padding: '16px', textAlign: 'center', fontSize: '11px', color: 'var(--color-muted)' }}>
        Select a Motion clip to use spatial controls
      </div>
    );
  }

  const docDurSecs = motionTimeToSeconds(doc.duration);

  // Canonical camera access — cameras map + activeCameraId
  const activeCamera = doc.activeCameraId ? doc.cameras[doc.activeCameraId] : undefined;
  const getActiveCam = () => activeCamera;

  const applyRig = (rig: typeof SPATIAL_RIGS[0]) => {
    const ops = rig.apply(doc);
    applyMotionOps(ops, `Spatial rig: ${rig.label}`);
  };

  const applyCameraMove = (move: typeof CAMERA_MOVES[0]) => {
    const ops: ReturnType<typeof makeMotionOp>[] = [];
    const baseCam = (doc.activeCameraId ? doc.cameras[doc.activeCameraId] : undefined) ?? {
      id: generateMotionId('cam'),
      name: 'Camera',
      transform: { x: 0, y: 0, z: cameraZ, scaleX: 1, scaleY: 1, scaleZ: 1, rotationX: 0, rotationY: 0, rotationZ: 0, anchorX: 0, anchorY: 0, anchorZ: 0, opacity: 1 },
      keyframes: [],
      fov: cameraFov,
      near: 1,
      far: 10000,
      active: true,
    };

    const newKfs: typeof baseCam.keyframes = [];
    if ('zStart' in move && move.zStart !== undefined) {
      newKfs.push({ id: generateMotionId('kf'), time: secondsToMotionTime(0), property: 'z', value: cameraZ + (move.zStart ?? 0), easing: 'ease-in-out' });
      newKfs.push({ id: generateMotionId('kf'), time: secondsToMotionTime(docDurSecs), property: 'z', value: cameraZ + (move.zEnd ?? 0), easing: 'ease-in-out' });
    }
    if ('xStart' in move && move.xStart !== undefined) {
      newKfs.push({ id: generateMotionId('kf'), time: secondsToMotionTime(0), property: 'x', value: move.xStart, easing: 'ease-in-out' });
      newKfs.push({ id: generateMotionId('kf'), time: secondsToMotionTime(docDurSecs), property: 'x', value: move.xEnd ?? 0, easing: 'ease-in-out' });
    }
    if ('yStart' in move && move.yStart !== undefined) {
      newKfs.push({ id: generateMotionId('kf'), time: secondsToMotionTime(0), property: 'y', value: move.yStart, easing: 'ease-in-out' });
      newKfs.push({ id: generateMotionId('kf'), time: secondsToMotionTime(docDurSecs), property: 'y', value: move.yEnd ?? 0, easing: 'ease-in-out' });
    }

    const updatedCam = {
      ...baseCam,
      keyframes: [...baseCam.keyframes.filter((k) => !newKfs.some((nk) => nk.property === k.property)), ...newKfs],
      fov: cameraFov,
      ...(cameraDof ? { dof: { enabled: true, focalDistance: 400, aperture: 2.8, blurRadius: 4 } } : {}),
    };
    ops.push(makeMotionOp('motion.setCamera', doc.id, { camera: updatedCam }));
    applyMotionOps(ops, `Camera: ${move.label}`);
  };

  const addParallaxToAll = () => {
    const ops: ReturnType<typeof makeMotionOp>[] = [];
    const rootObjs = doc.rootObjectIds.map((id) => doc.objects[id]).filter(Boolean);
    for (const obj of rootObjs) {
      const parallaxStrength = (obj.depth ?? 0) * 0.05;
      if (Math.abs(parallaxStrength) < 0.001) continue;
      const beh: MotionBehavior = {
        id: generateMotionId('beh'),
        type: 'signal-reactive',
        startTime: secondsToMotionTime(0),
        duration: secondsToMotionTime(docDurSecs),
        params: { property: 'position.x', min: -30 * parallaxStrength, max: 30 * parallaxStrength },
        easing: 'linear',
      };
      ops.push(makeMotionOp('motion.addBehavior', doc.id, { objectId: obj.id, behavior: beh }));
    }
    if (ops.length > 0) applyMotionOps(ops, 'Add parallax to all layers');
  };

  const applyDepthComposition = (compId: string) => {
    const ops: ReturnType<typeof makeMotionOp>[] = [];
    const rootObjs = doc.rootObjectIds.map((id) => doc.objects[id]).filter(Boolean);
    const firstObj = rootObjs[0];
    if (!firstObj) return;

    switch (compId) {
      case 'semantic-depth-caption': {
        const sigId = generateMotionId('sig');
        ops.push(makeMotionOp('motion.upsertSignal', doc.id, { signal: { id: sigId, name: 'speech-timing', type: 'number' as const, defaultValue: 0 } }));
        ops.push(makeMotionOp('motion.setObjectProp', doc.id, { objectId: firstObj.id, props: { depth: 0 } }));
        const depthBeh: MotionBehavior = {
          id: generateMotionId('beh'), type: 'signal-reactive',
          startTime: secondsToMotionTime(0), duration: secondsToMotionTime(docDurSecs),
          params: { property: 'position.z', min: 0, max: 120 }, signalBinding: sigId, easing: 'spring',
        };
        const emphSigId = generateMotionId('sig');
        ops.push(makeMotionOp('motion.upsertSignal', doc.id, { signal: { id: emphSigId, name: 'semantic-emphasis', type: 'number' as const, defaultValue: 0 } }));
        const emphBeh: MotionBehavior = {
          id: generateMotionId('beh'), type: 'signal-reactive',
          startTime: secondsToMotionTime(0), duration: secondsToMotionTime(docDurSecs),
          params: { property: 'scale.x', min: 1, max: 1.2 }, signalBinding: emphSigId, easing: 'bounce',
        };
        ops.push(makeMotionOp('motion.addBehavior', doc.id, { objectId: firstObj.id, behavior: depthBeh }));
        ops.push(makeMotionOp('motion.addBehavior', doc.id, { objectId: firstObj.id, behavior: emphBeh }));
        break;
      }
      case 'behind-subject-editorial': {
        ops.push(makeMotionOp('motion.setObjectProp', doc.id, { objectId: firstObj.id, props: { depth: -1, occlusionRole: 'background' } }));
        ops.push(makeMotionOp('motion.setObjectTransform', doc.id, { objectId: firstObj.id, transform: { z: -100 } }));
        break;
      }
      case 'projector-typography': {
        const projMat: MotionMaterial = { id: generateMotionId('mat'), name: 'Projector', type: 'shadow', color: '#ffffff', opacity: 0.9, params: { projector: true, shadowBlur: 20, shadowOpacity: 0.7 } };
        ops.push(makeMotionOp('motion.setMaterial', doc.id, { objectId: firstObj.id, material: projMat }));
        ops.push(makeMotionOp('motion.setObjectProp', doc.id, { objectId: firstObj.id, props: { depth: 1 } }));
        // Camera response
        const cam = getActiveCam() ?? { id: generateMotionId('cam'), name: 'Camera', transform: { x: 0, y: 0, z: cameraZ, scaleX: 1, scaleY: 1, scaleZ: 1, rotationX: 0, rotationY: 0, rotationZ: 0, anchorX: 0, anchorY: 0, anchorZ: 0, opacity: 1 }, keyframes: [], fov: cameraFov, near: 1, far: 10000, active: true };
        const updCam = { ...cam, keyframes: [...cam.keyframes, { id: generateMotionId('kf'), time: secondsToMotionTime(0), property: 'z', value: cameraZ, easing: 'ease-in-out' as const }, { id: generateMotionId('kf'), time: secondsToMotionTime(docDurSecs), property: 'z', value: cameraZ + 80, easing: 'ease-in-out' as const }] };
        ops.push(makeMotionOp('motion.setCamera', doc.id, { camera: updCam }));
        break;
      }
      case 'plane-stack-headline': {
        // Distribute objects across shallow depth planes
        rootObjs.forEach((obj, i) => {
          const depth = (i / Math.max(1, rootObjs.length - 1)) * 4 - 2;
          ops.push(makeMotionOp('motion.setObjectProp', doc.id, { objectId: obj.id, props: { depth } }));
          ops.push(makeMotionOp('motion.setObjectTransform', doc.id, { objectId: obj.id, transform: { z: depth * 80 } }));
        });
        // Camera push
        const cam = getActiveCam() ?? { id: generateMotionId('cam'), name: 'Camera', transform: { x: 0, y: 0, z: cameraZ, scaleX: 1, scaleY: 1, scaleZ: 1, rotationX: 0, rotationY: 0, rotationZ: 0, anchorX: 0, anchorY: 0, anchorZ: 0, opacity: 1 }, keyframes: [], fov: cameraFov, near: 1, far: 10000, active: true };
        const updCam = { ...cam, keyframes: [{ id: generateMotionId('kf'), time: secondsToMotionTime(0), property: 'z', value: cameraZ, easing: 'ease-in-out' as const }, { id: generateMotionId('kf'), time: secondsToMotionTime(docDurSecs), property: 'z', value: cameraZ + 150, easing: 'ease-in-out' as const }] };
        ops.push(makeMotionOp('motion.setCamera', doc.id, { camera: updCam }));
        break;
      }
      case 'beat-reactive-card': {
        const beatSigId = generateMotionId('sig');
        ops.push(makeMotionOp('motion.upsertSignal', doc.id, { signal: { id: beatSigId, name: 'audio-beat', type: 'number' as const, defaultValue: 0 } }));
        const scaleBeh: MotionBehavior = { id: generateMotionId('beh'), type: 'signal-reactive', startTime: secondsToMotionTime(0), duration: secondsToMotionTime(docDurSecs), params: { property: 'scale.x', min: 0.97, max: 1.04 }, signalBinding: beatSigId, easing: 'spring' };
        const depthBeh: MotionBehavior = { id: generateMotionId('beh'), type: 'signal-reactive', startTime: secondsToMotionTime(0), duration: secondsToMotionTime(docDurSecs), params: { property: 'position.z', min: 0, max: 30 }, signalBinding: beatSigId, easing: 'spring' };
        ops.push(makeMotionOp('motion.addBehavior', doc.id, { objectId: firstObj.id, behavior: scaleBeh }));
        ops.push(makeMotionOp('motion.addBehavior', doc.id, { objectId: firstObj.id, behavior: depthBeh }));
        break;
      }
      case 'corridor-stage-title': {
        // Apply corridor rig
        const corridorOps = SPATIAL_RIGS.find((r) => r.id === 'corridor')?.apply(doc) ?? [];
        ops.push(...corridorOps);
        // Add camera push
        const cam = getActiveCam() ?? { id: generateMotionId('cam'), name: 'Camera', transform: { x: 0, y: 0, z: cameraZ, scaleX: 1, scaleY: 1, scaleZ: 1, rotationX: 0, rotationY: 0, rotationZ: 0, anchorX: 0, anchorY: 0, anchorZ: 0, opacity: 1 }, keyframes: [], fov: cameraFov, near: 1, far: 10000, active: true };
        const updCam = { ...cam, keyframes: [{ id: generateMotionId('kf'), time: secondsToMotionTime(0), property: 'z', value: cameraZ, easing: 'ease-in-out' as const }, { id: generateMotionId('kf'), time: secondsToMotionTime(docDurSecs), property: 'z', value: cameraZ + 300, easing: 'ease-in-out' as const }] };
        ops.push(makeMotionOp('motion.setCamera', doc.id, { camera: updCam }));
        break;
      }
      case 'frame-break-composition': {
        // First object breaks the frame (very high depth)
        ops.push(makeMotionOp('motion.setObjectProp', doc.id, { objectId: firstObj.id, props: { depth: 5, occlusionRole: 'foreground' } }));
        ops.push(makeMotionOp('motion.setObjectTransform', doc.id, { objectId: firstObj.id, transform: { z: 500, scaleX: 1.15, scaleY: 1.15 } }));
        // Remaining objects stay in background
        rootObjs.slice(1).forEach((obj) => {
          ops.push(makeMotionOp('motion.setObjectProp', doc.id, { objectId: obj.id, props: { depth: -2, occlusionRole: 'background' } }));
          ops.push(makeMotionOp('motion.setObjectTransform', doc.id, { objectId: obj.id, transform: { z: -200 } }));
        });
        break;
      }
      case 'wraparound-editorial': {
        // Distribute objects in a curved arc
        rootObjs.forEach((obj, i) => {
          const t = i / Math.max(1, rootObjs.length - 1);
          const angle = (t - 0.5) * Math.PI * 0.4; // -36° to +36°
          const radius = 600;
          const x = Math.sin(angle) * radius;
          const z = Math.cos(angle) * radius - radius;
          const depth = Math.cos(angle) * 2;
          ops.push(makeMotionOp('motion.setObjectProp', doc.id, { objectId: obj.id, props: { depth } }));
          ops.push(makeMotionOp('motion.setObjectTransform', doc.id, { objectId: obj.id, transform: { x, y: 0, z, rotationY: angle * (180 / Math.PI) } }));
        });
        break;
      }
    }

    if (ops.length > 0) applyMotionOps(ops, `Composition: ${compId}`);
  };

  const tabStyle = (active: boolean) => ({
    flex: 1, padding: '4px 4px', background: active ? 'rgba(59,130,255,0.12)' : 'transparent',
    border: 'none', borderBottom: `2px solid ${active ? 'var(--color-accent)' : 'transparent'}`,
    color: active ? 'var(--color-accent)' : 'var(--color-subtle)', cursor: 'pointer', fontSize: '9px',
    fontFamily: 'var(--font-sans)', fontWeight: active ? 600 : 400, whiteSpace: 'nowrap' as const,
  });

  const filteredComps = DEPTH_COMPOSITIONS.filter((c) => compCategory === 'all' || c.category === compCategory);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', flexShrink: 0, overflowX: 'auto' }}>
        <button style={tabStyle(activeTab === 'rigs')} onClick={() => setActiveTab('rigs')}>Rigs</button>
        <button style={tabStyle(activeTab === 'camera')} onClick={() => setActiveTab('camera')}>Camera</button>
        <button style={tabStyle(activeTab === 'parallax')} onClick={() => setActiveTab('parallax')}>Parallax</button>
        <button style={tabStyle(activeTab === 'compositions')} onClick={() => setActiveTab('compositions')}>Comps</button>
        <button style={tabStyle(activeTab === 'layers')} onClick={() => setActiveTab('layers')}>Layers</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '8px' }}>
        {/* Rigs */}
        {activeTab === 'rigs' && (
          <>
            <div style={{ fontSize: '10px', color: 'var(--color-subtle)', marginBottom: '8px', lineHeight: 1.5 }}>
              Spatial rigs distribute objects across depth planes. Applies to all root objects.
            </div>
            {SPATIAL_RIGS.map((rig) => (
              <button
                key={rig.id}
                onClick={() => applyRig(rig)}
                style={{ width: '100%', padding: '7px 8px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'var(--color-fg)', cursor: 'pointer', fontSize: '10px', fontFamily: 'var(--font-sans)', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}
              >
                <span style={{ fontSize: '16px', flexShrink: 0 }}>{rig.icon}</span>
                <div>
                  <div style={{ fontWeight: 600 }}>{rig.label}</div>
                  <div style={{ fontSize: '9px', color: 'var(--color-subtle)', marginTop: '1px' }}>{rig.desc}</div>
                </div>
              </button>
            ))}
          </>
        )}

        {/* Camera */}
        {activeTab === 'camera' && (
          <>
            <div style={{ marginBottom: '10px' }}>
              <Label>Camera Z Position</Label>
              <input type="number" value={cameraZ} step={50} onChange={(e) => setCameraZ(+e.target.value)} style={numInputStyle} />
            </div>
            <div style={{ marginBottom: '10px' }}>
              <Label>Field of View</Label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input type="range" min={20} max={120} value={cameraFov} onChange={(e) => setCameraFov(+e.target.value)} className="range-slider" style={{ flex: 1 }} aria-label="Camera FOV" />
                <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--color-fg)', minWidth: '28px' }}>{cameraFov}°</span>
              </div>
            </div>
            <div style={{ marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="checkbox" id="dof-toggle" checked={cameraDof} onChange={(e) => setCameraDof(e.target.checked)} />
              <label htmlFor="dof-toggle" style={{ fontSize: '10px', color: 'var(--color-fg)', cursor: 'pointer' }}>Depth of Field</label>
            </div>

            <Label>Camera Moves</Label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
              {CAMERA_MOVES.map((move) => (
                <button
                  key={move.id}
                  onClick={() => applyCameraMove(move)}
                  title={move.desc}
                  style={{ padding: '5px 6px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'var(--color-fg)', cursor: 'pointer', fontSize: '10px', fontFamily: 'var(--font-sans)', display: 'flex', alignItems: 'center', gap: '5px' }}
                >
                  <span style={{ fontSize: '12px' }}>{move.icon}</span>
                  <span>{move.label}</span>
                </button>
              ))}
            </div>

            {activeCamera && (
              <div style={{ marginTop: '10px', padding: '6px 8px', background: 'rgba(59,130,255,0.06)', border: '1px solid rgba(59,130,255,0.15)', borderRadius: '4px' }}>
                <div style={{ fontSize: '9px', color: 'var(--color-subtle)', marginBottom: '3px' }}>Active Camera</div>
                <div style={{ fontSize: '10px', color: 'var(--color-fg)', fontFamily: 'var(--font-mono)' }}>
                  z:{activeCamera.transform.z.toFixed(0)} · fov:{activeCamera.fov}° · {activeCamera.keyframes.length}kf
                </div>
              </div>
            )}
          </>
        )}

        {/* Parallax */}
        {activeTab === 'parallax' && (
          <>
            <div style={{ fontSize: '10px', color: 'var(--color-subtle)', marginBottom: '8px', lineHeight: 1.5 }}>
              Parallax behavior is driven by object depth. Objects further back move less than foreground objects.
            </div>

            <button
              onClick={addParallaxToAll}
              style={{ width: '100%', padding: '6px', background: 'rgba(59,130,255,0.1)', border: '1px solid rgba(59,130,255,0.3)', borderRadius: '4px', color: 'var(--color-accent)', cursor: 'pointer', fontSize: '11px', fontFamily: 'var(--font-sans)', fontWeight: 600, marginBottom: '10px' }}
            >
              Add Parallax to All Layers
            </button>

            <Label>Layer Depths</Label>
            {doc.rootObjectIds.map((objId) => {
              const obj = doc.objects[objId];
              if (!obj) return null;
              return (
                <div key={objId} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', padding: '4px 6px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px' }}>
                  <span style={{ fontSize: '10px', color: 'var(--color-fg)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{obj.name}</span>
                  <input
                    type="number"
                    defaultValue={obj.depth}
                    step={0.5}
                    onBlur={(e) => applyMotionOps([makeMotionOp('motion.setObjectProp', doc.id, { objectId: obj.id, props: { depth: +e.target.value } })], 'Set depth')}
                    style={{ width: '50px', background: 'var(--color-elevated)', border: '1px solid var(--color-border)', borderRadius: '3px', color: 'var(--color-fg)', fontSize: '10px', fontFamily: 'var(--font-mono)', padding: '2px 4px' }}
                  />
                  <span style={{ fontSize: '9px', color: 'var(--color-subtle)', minWidth: '30px', fontFamily: 'var(--font-mono)' }}>z:{obj.transform.z.toFixed(0)}</span>
                </div>
              );
            })}
          </>
        )}

        {/* Compositions */}
        {activeTab === 'compositions' && (
          <>
            <div style={{ fontSize: '10px', color: 'var(--color-subtle)', marginBottom: '8px', lineHeight: 1.5 }}>
              Reusable editable spatial/text treatments. All remain editable after placement.
            </div>
            <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', marginBottom: '8px' }}>
              {(['all', 'caption', 'title', 'card', 'graphic', 'editorial'] as const).map((cat) => (
                <button key={cat} onClick={() => setCompCategory(cat)} style={{ fontSize: '9px', padding: '2px 7px', background: compCategory === cat ? 'rgba(139,92,246,0.15)' : 'transparent', border: `1px solid ${compCategory === cat ? 'rgba(139,92,246,0.4)' : 'var(--color-border)'}`, borderRadius: '10px', color: compCategory === cat ? 'var(--color-accent-2)' : 'var(--color-subtle)', cursor: 'pointer', fontFamily: 'var(--font-sans)', textTransform: 'capitalize' }}>{cat}</button>
              ))}
            </div>
            {filteredComps.map((comp) => (
              <button
                key={comp.id}
                onClick={() => applyDepthComposition(comp.id)}
                style={{ width: '100%', padding: '7px 8px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'var(--color-fg)', cursor: 'pointer', fontSize: '10px', fontFamily: 'var(--font-sans)', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}
              >
                <span style={{ fontSize: '16px', flexShrink: 0 }}>{comp.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{comp.label}</div>
                  <div style={{ fontSize: '9px', color: 'var(--color-subtle)', marginTop: '1px' }}>{comp.desc}</div>
                </div>
                <span style={{ fontSize: '8px', color: 'var(--color-subtle)', background: 'var(--color-elevated)', padding: '1px 4px', borderRadius: '3px', flexShrink: 0 }}>{comp.category}</span>
              </button>
            ))}
          </>
        )}

        {/* Layers — direct per-layer authoring */}
        {activeTab === 'layers' && (
          <>
            <div style={{ fontSize: '10px', color: 'var(--color-subtle)', marginBottom: '8px', lineHeight: 1.5 }}>
              Direct per-layer depth authoring. Edit depth, Z, parallax, and occlusion role for each object.
            </div>
            {doc.rootObjectIds.length === 0 && (
              <div style={{ fontSize: '11px', color: 'var(--color-muted)', textAlign: 'center', padding: '16px' }}>No objects in this document</div>
            )}
            {doc.rootObjectIds.map((objId) => {
              const obj = doc.objects[objId];
              if (!obj) return null;
              return (
                <div key={objId} style={{ marginBottom: '8px', padding: '8px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '4px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-fg)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '9px', color: 'var(--color-subtle)', background: 'var(--color-elevated)', padding: '1px 4px', borderRadius: '2px' }}>{obj.kind}</span>
                    {obj.name}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                    <div>
                      <Label>Depth</Label>
                      <input type="number" defaultValue={obj.depth} step={0.5} onBlur={(e) => applyMotionOps([makeMotionOp('motion.setObjectProp', doc.id, { objectId: obj.id, props: { depth: +e.target.value } })], 'Set depth')} style={{ ...numInputStyle, fontSize: '10px' }} />
                    </div>
                    <div>
                      <Label>Z Pos</Label>
                      <input type="number" defaultValue={obj.transform.z} step={10} onBlur={(e) => applyMotionOps([makeMotionOp('motion.setObjectTransform', doc.id, { objectId: obj.id, transform: { z: +e.target.value } })], 'Set Z')} style={{ ...numInputStyle, fontSize: '10px' }} />
                    </div>
                    <div>
                      <Label>X Pos</Label>
                      <input type="number" defaultValue={obj.transform.x} step={5} onBlur={(e) => applyMotionOps([makeMotionOp('motion.setObjectTransform', doc.id, { objectId: obj.id, transform: { x: +e.target.value } })], 'Set X')} style={{ ...numInputStyle, fontSize: '10px' }} />
                    </div>
                    <div>
                      <Label>Y Pos</Label>
                      <input type="number" defaultValue={obj.transform.y} step={5} onBlur={(e) => applyMotionOps([makeMotionOp('motion.setObjectTransform', doc.id, { objectId: obj.id, transform: { y: +e.target.value } })], 'Set Y')} style={{ ...numInputStyle, fontSize: '10px' }} />
                    </div>
                    <div>
                      <Label>Scale X</Label>
                      <input type="number" defaultValue={obj.transform.scaleX} step={0.05} min={0.01} onBlur={(e) => applyMotionOps([makeMotionOp('motion.setObjectTransform', doc.id, { objectId: obj.id, transform: { scaleX: +e.target.value } })], 'Set scale X')} style={{ ...numInputStyle, fontSize: '10px' }} />
                    </div>
                    <div>
                      <Label>Rotation Z</Label>
                      <input type="number" defaultValue={obj.transform.rotationZ} step={1} onBlur={(e) => applyMotionOps([makeMotionOp('motion.setObjectTransform', doc.id, { objectId: obj.id, transform: { rotationZ: +e.target.value } })], 'Set rotation')} style={{ ...numInputStyle, fontSize: '10px' }} />
                    </div>
                  </div>
                  <div style={{ marginTop: '4px' }}>
                    <Label>Occlusion</Label>
                    <select
                      defaultValue={obj.occlusionRole ?? 'none'}
                      onChange={(e) => applyMotionOps([makeMotionOp('motion.setObjectProp', doc.id, { objectId: obj.id, props: { occlusionRole: e.target.value as MotionObject['occlusionRole'] } })], 'Set occlusion')}
                      style={{ ...numInputStyle, fontFamily: 'var(--font-sans)', fontSize: '10px' }}
                    >
                      <option value="none">None</option>
                      <option value="foreground">Foreground</option>
                      <option value="background">Background</option>
                      <option value="subject">Subject</option>
                    </select>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: '9px', fontWeight: 600, color: 'var(--color-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px', marginTop: '2px' }}>{children}</div>;
}
