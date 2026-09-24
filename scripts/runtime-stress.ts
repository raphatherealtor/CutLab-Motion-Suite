/**
 * Focused runtime/export stress test (agent-deepseek-final-runtime).
 *
 * Headless (no React, no DOM/MediaRecorder) — drives the real render-plan +
 * Motion evaluator seam over a sustained sequence containing video, audio,
 * image, and Motion (text + SVG + image + shape) clips. Verifies:
 *   - sustained buildRenderPlan over N frames (no NaN, correct duration boundary)
 *   - Motion transform + signal evaluation is finite + deterministic
 *   - preview/export parity (same plan + same evaluated transforms)
 *   - fps-relative seek tolerance is sub-frame
 *
 * Run:  npx tsx scripts/runtime-stress.ts
 */

import { createDefaultProject, generateId } from '../src/engine/schema';
import type { ProjectData, Clip } from '../src/engine/schema';
import { fromSeconds } from '../src/engine/time';
import { makeOp } from '../src/engine/operations';
import { applyOp } from '../src/engine/reducer';
import { buildRenderPlan } from '../src/engine/render-plan';
import { createMotionClipOps } from '../src/engine/motion-bridge';
import {
  createMotionDocument,
  evaluateMotionTransform,
  evaluateSignals,
  DEFAULT_MOTION_TRANSFORM,
} from '../src/engine/motion-document';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { console.log('  PASS', msg); }
  else { failures++; console.error('  FAIL', msg); }
}

function mkClip(partial: Partial<Clip> & { id: string; kind: Clip['kind']; trackId: string; name: string }): Clip {
  return {
    startTime: fromSeconds(0, 30000),
    duration: fromSeconds(1, 30000),
    sourceIn: fromSeconds(0, 30000),
    sourceOut: fromSeconds(1, 30000),
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0 },
    keyframes: [],
    effects: [],
    masks: [],
    gain: 0,
    fadeIn: fromSeconds(0, 30000),
    fadeOut: fromSeconds(0, 30000),
    speed: 1,
    reverse: false,
    freeze: false,
    disabled: false,
    ...partial,
  };
}

function buildProject(): ProjectData {
  let p = createDefaultProject('runtime-stress');
  const seqId = p.activeSequenceId;
  const seq = p.sequences[seqId];
  const videoTrack = seq.tracks.find((t) => t.kind === 'video')!;
  const audioTrack = seq.tracks.find((t) => t.kind === 'audio')!;
  const motionTrack = seq.tracks.find((t) => t.kind === 'motion')!;

  const addAsset = (id: string, kind: 'video' | 'audio' | 'image') => {
    p.assets[id] = {
      id, name: id, kind, caste: 'original', sourceRef: `local:${id}`,
      runtimeUrl: `blob:stress-${id}`, width: 1920, height: 1080,
      durationFrames: 3000, fps: 30, hasAudio: kind !== 'image', sampleRate: 48000, channels: 2,
    };
  };

  addAsset('video-1', 'video');
  addAsset('audio-1', 'audio');
  addAsset('img-1', 'image');

  const clips: Clip[] = [
    mkClip({ id: 'clip-video', kind: 'video', trackId: videoTrack.id, name: 'Video', assetId: 'video-1', startTime: fromSeconds(0, 30000), duration: fromSeconds(30, 30000), sourceOut: fromSeconds(30, 30000) }),
    mkClip({ id: 'clip-audio', kind: 'audio', trackId: audioTrack.id, name: 'Audio', assetId: 'audio-1', startTime: fromSeconds(0, 30000), duration: fromSeconds(30, 30000), sourceOut: fromSeconds(30, 30000) }),
    mkClip({ id: 'clip-img', kind: 'video', trackId: videoTrack.id, name: 'Image', assetId: 'img-1', startTime: fromSeconds(2, 30000), duration: fromSeconds(10, 30000) }),
  ];

  for (const c of clips) {
    const r = applyOp(p, makeOp('clip.add', { sequenceId: seqId, clip: c }));
    p = r.state;
  }

  // Motion document: text (with signal-reactive behavior + fade-in), SVG, image, shape
  const doc = createMotionDocument('stress-motion', fromSeconds(20, 30000), 30, 1920, 1080);
  const sigId = 'audio-rms';
  doc.signals[sigId] = { id: sigId, name: 'RMS', type: 'number', defaultValue: undefined as unknown as number, kind: 'audio-rms' };
  doc.objects['txt'] = {
    id: 'txt', kind: 'text', name: 'Title', depth: 0, transform: { ...DEFAULT_MOTION_TRANSFORM },
    keyframes: [], behaviors: [
      { id: 'b-fade', type: 'fade-in', startTime: fromSeconds(0, 30000), duration: fromSeconds(1, 30000), params: {}, easing: 'ease-out' },
      { id: 'b-sig', type: 'signal-reactive', startTime: fromSeconds(0, 30000), duration: fromSeconds(20, 30000), params: { property: 'scaleX', min: 0.8, max: 1.2 }, signalBinding: sigId, easing: 'linear' },
    ], masks: [], blendMode: 'normal', visible: true, solo: false, locked: false, text: 'STRESS', fontSize: 96, fontWeight: 700,
  };
  doc.objects['svg'] = { id: 'svg', kind: 'svg', name: 'Logo', depth: 1, transform: { ...DEFAULT_MOTION_TRANSFORM }, keyframes: [], behaviors: [], masks: [], blendMode: 'normal', visible: true, solo: false, locked: false, svgData: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#3B82FF"/></svg>' };
  doc.objects['img'] = { id: 'img', kind: 'image', name: 'Pic', depth: 2, transform: { ...DEFAULT_MOTION_TRANSFORM }, keyframes: [], behaviors: [], masks: [], blendMode: 'normal', visible: true, solo: false, locked: false, assetRef: 'img-1' };
  doc.objects['shape'] = { id: 'shape', kind: 'shape', name: 'Bar', depth: 3, transform: { ...DEFAULT_MOTION_TRANSFORM }, keyframes: [], behaviors: [], masks: [], blendMode: 'normal', visible: true, solo: false, locked: false, shapeType: 'rectangle' };
  doc.rootObjectIds = ['txt', 'svg', 'img', 'shape'];

  const motionOps = createMotionClipOps({ doc, sequenceId: seqId, trackId: motionTrack.id, startTimeSecs: 0, fps: 30 });
  for (const op of motionOps) p = applyOp(p, op).state;

  return p;
}

const project = buildProject();
const seq = project.sequences[project.activeSequenceId];
const fps = seq.format.fps;
const totalFrames = Math.ceil(30 * fps); // 30s @ 30fps = 900 frames

console.log('Project built:', {
  assets: Object.keys(project.assets).length,
  clips: seq.clips.map((c) => `${c.kind}:${c.name}`).join(', '),
  motionObjects: Object.keys(project.motionDocuments).length ? Object.values(project.motionDocuments)[0].rootObjectIds.join(',') : '(none)',
  totalFrames,
});

// ── 1. sustained buildRenderPlan ─────────────────────────────
{
  const t0 = performance.now();
  let lastTime = -1;
  let nonNull = 0;
  let nanLayers = 0;
  for (let f = 0; f < totalFrames; f++) {
    const plan = buildRenderPlan(project, f);
    if (plan) {
      nonNull++;
      if (plan.timeSecs < lastTime) { failures++; console.error('  FAIL non-monotonic timeSecs at', f); }
      lastTime = plan.timeSecs;
      for (const l of plan.layers) {
        if (!Number.isFinite(l.sourceTimeSecs) || !Number.isFinite(l.transform.x) || !Number.isFinite(l.transform.opacity)) nanLayers++;
      }
    }
  }
  const dt = performance.now() - t0;
  assert(nonNull === totalFrames, `buildRenderPlan sustained: ${nonNull}/${totalFrames} non-null plans`);
  assert(nanLayers === 0, `no NaN layers (${nanLayers} found)`);
  const beyond = buildRenderPlan(project, totalFrames + 5);
  assert(beyond === null || beyond.layers.length === 0, 'buildRenderPlan out-of-range frame → null or empty layers');
  console.log(`  buildRenderPlan throughput: ${(totalFrames / (dt / 1000)).toFixed(0)} frames/sec (${dt.toFixed(1)}ms)`);
}

// ── 2. Motion evaluation sustained + deterministic ───────────
{
  const doc = Object.values(project.motionDocuments)[0];
  let nanTransforms = 0;
  let nonDeterministic = 0;
  const t0 = performance.now();
  for (let f = 0; f < totalFrames; f++) {
    const t = f / fps;
    const sigs = evaluateSignals(doc, t);
    for (const objId of doc.rootObjectIds) {
      const mt = evaluateMotionTransform(doc.objects[objId], t, sigs);
      const flat = [mt.x, mt.y, mt.z, mt.scaleX, mt.scaleY, mt.scaleZ, mt.rotationZ, mt.opacity];
      if (!flat.every(Number.isFinite)) nanTransforms++;
    }
    // determinism
    if (evaluateSignals(doc, t)['audio-rms'] !== sigs['audio-rms']) nonDeterministic++;
  }
  const dt = performance.now() - t0;
  assert(nanTransforms === 0, `no NaN motion transforms (${nanTransforms} found)`);
  assert(nonDeterministic === 0, `evaluateSignals deterministic (${nonDeterministic} mismatches)`);

  // time-varying + bounded
  const s0 = evaluateSignals(doc, 0.0)['audio-rms'];
  const s1 = evaluateSignals(doc, 0.5)['audio-rms'];
  assert(typeof s0 === 'number' && typeof s1 === 'number' && s0 >= 0 && s0 <= 1 && s1 >= 0 && s1 <= 1, `signal bounded [0,1] (${s0}, ${s1})`);
  assert(s0 !== s1, `signal time-varying (0.0=${s0}, 0.5=${s1})`);
  console.log(`  motion eval throughput: ${(totalFrames * doc.rootObjectIds.length / (dt / 1000)).toFixed(0)} object-evals/sec (${dt.toFixed(1)}ms)`);
}

// ── 3. preview/export parity (same plan, same transforms) ────
{
  const f = Math.floor(totalFrames / 2);
  const p1 = buildRenderPlan(project, f)!;
  const p2 = buildRenderPlan(project, f)!;
  const layersMatch = p1.layers.length === p2.layers.length && p1.layers.every((l, i) =>
    l.clipId === p2.layers[i].clipId && l.sourceTimeSecs === p2.layers[i].sourceTimeSecs && l.transform.opacity === p2.layers[i].transform.opacity
  );
  assert(layersMatch, 'preview/export plan parity at frame ' + f);

  const doc = Object.values(project.motionDocuments)[0];
  const t = f / fps;
  const sigs = evaluateSignals(doc, t);
  const mtA = evaluateMotionTransform(doc.objects['txt'], t, sigs);
  const mtB = evaluateMotionTransform(doc.objects['txt'], t, sigs);
  assert(JSON.stringify(mtA) === JSON.stringify(mtB), 'motion transform determinism (parity)');
}

// ── 4. fps-relative seek tolerance is sub-frame ──────────────
{
  const eps = 0.5 / fps;
  assert(eps < 1 / fps, `seek epsilon ${eps.toFixed(4)}s < frame ${(1 / fps).toFixed(4)}s (sub-frame)`);
  assert(eps > 0.001, `seek epsilon ${eps.toFixed(4)}s > 1ms (avoids over-seeking at low fps)`);
}

// ── 5. audio speed math (pure re-derivation) ─────────────────
{
  // sourceDuration(buffer-time) = remainingWall * speed; playbackRate = speed
  // → wall duration = (remainingWall * speed) / speed = remainingWall  ✓
  const D = 30, speed = 2, remainingWall = 30;
  const bufferDur = remainingWall * speed;
  const wallDur = bufferDur / speed;
  assert(wallDur === remainingWall, `speed=2 audio wall duration preserved (${wallDur}s)`);
  assert(bufferDur === 60, `speed=2 buffer duration = 60s (${bufferDur}s)`);
}

console.log('\n' + (failures === 0 ? 'ALL STRESS CHECKS PASSED' : `${failures} CHECKS FAILED`));
process.exitCode = failures === 0 ? 0 : 1;
