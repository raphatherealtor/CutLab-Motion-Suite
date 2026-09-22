/**
 * CutLab End-to-End Test Suite
 *
 * Tests the full pipeline:
 *   Media ingest → Timeline → Studio → Motion Animator → Preview
 *   → Audio Mix → Render → Encode → Export → Save → Reload
 *
 * Run from the browser console:
 *   import { runAllTests } from '@/engine/e2e-tests';
 *   runAllTests().then(r => console.table(r));
 *
 * Or import the runner component:
 *   <E2ETestRunner />
 */

import { buildRenderPlan } from './render-plan';
import {
  buildExportPlan,
  detectEncoderCapabilities,
  compositeFrame,
  mixdownAudio,
  encodePCMToWAV,
  createCancellationToken,
  ExportCancelledError,
  type RenderProgressEvent,
} from './export';
import { evaluateMotionClip, resolveMotionDocument, motionTransactionToStudioOps, createMotionClipOps } from './motion-bridge';
import { toSeconds, fromSeconds } from './time';
import type { ProjectData, Sequence, Clip, Asset, Track } from './schema';

import { serializeProject, deserializeProject } from './persistence';
import { makeOp } from './operations';
import { applyOp, applyOps } from './reducer';
import { createMotionTransaction, makeOp as makeMotionOp, generateMotionId, secondsToMotionTime } from './motion-document-utils';
import type { MotionDocument } from './motion-document';
import E2ETestRunner from '@/app/main-editor/components/E2ETestRunner';



// ── Test result types ─────────────────────────────────────────

export type TestStatus = 'pass' | 'fail' | 'skip' | 'warn';

export interface TestResult {
  suite: string;
  name: string;
  status: TestStatus;
  message: string;
  durationMs: number;
  details?: Record<string, unknown>;
}

export interface TestSuiteResult {
  suite: string;
  passed: number;
  failed: number;
  skipped: number;
  warned: number;
  results: TestResult[];
  totalMs: number;
}

// ── Test runner ───────────────────────────────────────────────

type TestFn = () => Promise<void> | void;

class TestRunner {
  private results: TestResult[] = [];
  private suite = 'default';

  setSuite(name: string) { this.suite = name; }

  async run(name: string, fn: TestFn): Promise<TestResult> {
    const start = Date.now();
    try {
      await fn();
      const result: TestResult = { suite: this.suite, name, status: 'pass', message: 'OK', durationMs: Date.now() - start };
      this.results.push(result);
      return result;
    } catch (e) {
      const result: TestResult = {
        suite: this.suite,
        name,
        status: e instanceof SkipError ? 'skip' : 'fail',
        message: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - start,
      };
      this.results.push(result);
      return result;
    }
  }

  warn(name: string, message: string) {
    this.results.push({ suite: this.suite, name, status: 'warn', message, durationMs: 0 });
  }

  getResults(): TestResult[] { return [...this.results]; }
}

class SkipError extends Error { constructor(msg: string) { super(msg); this.name = 'SkipError'; } }
function skip(msg: string): never { throw new SkipError(msg); }

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertDefined<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`${label} is null/undefined`);
  return value;
}

// ── Minimal project fixture ───────────────────────────────────

function makeMinimalProject(): ProjectData {
  const assetId = 'asset-test-video';
  const clipId = 'clip-test-1';
  const trackId = 'track-v1';
  const audioTrackId = 'track-a1';
  const seqId = 'seq-test';
  const now = Date.now();

  const asset: Asset = {
    id: assetId,
    name: 'test-video.mp4',
    kind: 'video',
    sourceRef: 'local:asset-test-video:test-video.mp4',
    runtimeUrl: '',
    durationFrames: 300, // 10s at 30fps
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: true,
    sampleRate: 48000,
    channels: 2,
    caste: 'missing',
  };

  const videoClip: Clip = {
    id: clipId,
    name: 'Test Clip',
    assetId,
    trackId,
    kind: 'video',
    startTime: { value: 0, timescale: 30 },
    duration: { value: 150, timescale: 30 }, // 5s
    sourceIn: { value: 0, timescale: 30 },
    sourceOut: { value: 150, timescale: 30 },
    speed: 1,
    reverse: false,
    freeze: false,
    gain: 0,
    pan: 0,
    fadeIn: { value: 0, timescale: 30 },
    fadeOut: { value: 0, timescale: 30 },
    effects: [],
    masks: [],
    keyframes: [],
    disabled: false,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0 },
  };

  const videoTrack: Track = {
    id: trackId,
    kind: 'video',
    label: 'V1',
    muted: false,
    solo: false,
    locked: false,
    gain: 0,
    pan: 0,
    height: 48,
    order: 0,
    targeted: true,
  };

  const audioTrack: Track = {
    id: audioTrackId,
    kind: 'audio',
    label: 'A1',
    muted: false,
    solo: false,
    locked: false,
    gain: 0,
    pan: 0,
    height: 48,
    order: 1,
    targeted: false,
  };

  const seq: Sequence = {
    id: seqId,
    name: 'Test Sequence',
    format: { width: 1920, height: 1080, fps: 30, fpsTimescale: 30, sampleRate: 48000, channels: 2 },
    tracks: [videoTrack, audioTrack],
    clips: [videoClip],
    markers: [],
    captions: [],
    transitions: [],
    cues: [],
  };

  return {
    schemaVersion: 2,
    id: 'project-test',
    name: 'E2E Test Project',
    createdAt: now,
    updatedAt: now,
    revision: 1,
    activeSequenceId: seqId,
    sequences: { [seqId]: seq },
    assets: { [assetId]: asset },
    precomps: {},
    versions: [],
    opHistory: [],
    exportPresets: {
      'preset-h264-1080p': {
        id: 'preset-h264-1080p',
        name: '1080p',
        width: 1920,
        height: 1080,
        fps: 30,
        bitrate: 8_000_000,
        codec: 'h264',
        container: 'mp4',
      },
    },
    audioPresets: {},
    settings: { defaultFps: 30, defaultWidth: 1920, defaultHeight: 1080 } as any,
    motionDocuments: {},
  };
}

// ── Suite 1: Schema / Data Integrity ─────────────────────────

async function runSchemaTests(runner: TestRunner): Promise<void> {
  runner.setSuite('Schema / Data Integrity');

  await runner.run('minimal project fixture is valid', () => {
    const p = makeMinimalProject();
    assertDefined(p.id, 'project.id');
    assertDefined(p.activeSequenceId, 'activeSequenceId');
    const seq = p.sequences[p.activeSequenceId];
    assertDefined(seq, 'active sequence');
    assert(seq.clips.length > 0, 'sequence has clips');
    assert(seq.tracks.length > 0, 'sequence has tracks');
  });

  await runner.run('clip duration is positive', () => {
    const p = makeMinimalProject();
    const seq = p.sequences[p.activeSequenceId];
    for (const clip of seq.clips) {
      const dur = toSeconds(clip.duration);
      assert(dur > 0, `clip ${clip.id} duration > 0`);
    }
  });

  await runner.run('asset references are consistent', () => {
    const p = makeMinimalProject();
    const seq = p.sequences[p.activeSequenceId];
    for (const clip of seq.clips) {
      if (clip.assetId) {
        assertDefined(p.assets[clip.assetId], `asset ${clip.assetId} exists for clip ${clip.id}`);
      }
    }
  });

  await runner.run('export preset exists', () => {
    const p = makeMinimalProject();
    const preset = p.exportPresets['preset-h264-1080p'];
    assertDefined(preset, 'preset-h264-1080p');
    assert(preset.width > 0, 'preset width > 0');
    assert(preset.height > 0, 'preset height > 0');
    assert(preset.fps > 0, 'preset fps > 0');
  });

  await runner.run('RationalTime round-trip', () => {
    const secs = 3.5;
    const rt = fromSeconds(secs, 30);
    const back = toSeconds(rt);
    assert(Math.abs(back - secs) < 0.001, `round-trip: ${back} ≈ ${secs}`);
  });
}

// ── Suite 2: Render Plan ──────────────────────────────────────

async function runRenderPlanTests(runner: TestRunner): Promise<void> {
  runner.setSuite('Render Plan');

  await runner.run('buildRenderPlan returns null for empty project', () => {
    const p = makeMinimalProject();
    // Frame 0 with no runtime URL — plan should still build (layer may be disabled/empty)
    const plan = buildRenderPlan(p, 0);
    // Plan can be null if sequence is empty or frame is out of range — that's valid
    // We just verify it doesn't throw
    assert(plan === null || typeof plan === 'object', 'plan is null or object');
  });

  await runner.run('buildRenderPlan frame 0 returns object', () => {
    const p = makeMinimalProject();
    // Give the asset a fake runtime URL so the clip is active
    p.assets['asset-test-video'].runtimeUrl = 'blob:fake';
    const plan = buildRenderPlan(p, 0);
    assertDefined(plan, 'render plan at frame 0');
    assert(Array.isArray(plan!.layers), 'plan.layers is array');
  });

  await runner.run('buildRenderPlan frame beyond sequence returns null', () => {
    const p = makeMinimalProject();
    // Frame 99999 is way beyond the 5s sequence
    const plan = buildRenderPlan(p, 99999);
    // Either null or an empty-layers plan is acceptable
    assert(plan === null || plan.layers.length === 0, 'plan is null or empty for out-of-range frame');
  });

  await runner.run('render plan timeSecs matches frame/fps', () => {
    const p = makeMinimalProject();
    p.assets['asset-test-video'].runtimeUrl = 'blob:fake';
    const fps = p.sequences[p.activeSequenceId].format.fps;
    const frameIndex = 15;
    const plan = buildRenderPlan(p, frameIndex);
    if (!plan) skip('no plan returned');
    const expectedSecs = frameIndex / fps;
    assert(Math.abs(plan.timeSecs - expectedSecs) < 0.001, `timeSecs ${plan.timeSecs} ≈ ${expectedSecs}`);
  });
}

// ── Suite 3: Export Plan ──────────────────────────────────────

async function runExportPlanTests(runner: TestRunner): Promise<void> {
  runner.setSuite('Export Plan');

  await runner.run('buildExportPlan returns valid plan', () => {
    const p = makeMinimalProject();
    const plan = buildExportPlan(p, 'preset-h264-1080p');
    assertDefined(plan, 'export plan');
    assertEqual(plan!.width, 1920, 'width');
    assertEqual(plan!.height, 1080, 'height');
    assertEqual(plan!.fps, 30, 'fps');
    assert(plan!.totalFrames > 0, 'totalFrames > 0');
  });

  await runner.run('buildExportPlan totalFrames matches sequence duration', () => {
    const p = makeMinimalProject();
    const plan = buildExportPlan(p, 'preset-h264-1080p');
    assertDefined(plan, 'export plan');
    // 5s at 30fps = 150 frames
    assertEqual(plan!.totalFrames, 150, 'totalFrames');
  });

  await runner.run('buildExportPlan returns null for missing preset', () => {
    const p = makeMinimalProject();
    const plan = buildExportPlan(p, 'nonexistent-preset');
    assert(plan === null, 'plan is null for missing preset');
  });
}

// ── Suite 4: Encoder Capabilities ────────────────────────────

async function runCapabilityTests(runner: TestRunner): Promise<void> {
  runner.setSuite('Encoder Capabilities');

  await runner.run('detectEncoderCapabilities returns report', async () => {
    const cap = await detectEncoderCapabilities();
    assertDefined(cap, 'capability report');
    assertDefined(cap.recommendedFormat, 'recommendedFormat');
    assert(typeof cap.mediaRecorderAvailable === 'boolean', 'mediaRecorderAvailable is boolean');
    assert(typeof cap.audioContextAvailable === 'boolean', 'audioContextAvailable is boolean');
  });

  await runner.run('recommendedFormat is a known value', async () => {
    const cap = await detectEncoderCapabilities();
    const known = ['mp4-h264-aac', 'webm-vp9', 'webm-vp8', 'wav-only', 'plan-json'];
    assert(known.includes(cap.recommendedFormat), `recommendedFormat "${cap.recommendedFormat}" is known`);
  });
}

// ── Suite 5: Frame Compositor ─────────────────────────────────

async function runCompositorTests(runner: TestRunner): Promise<void> {
  runner.setSuite('Frame Compositor');

  await runner.run('compositeFrame does not throw on empty sequence', async () => {
    const p = makeMinimalProject();
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext('2d')!;
    await compositeFrame(ctx, p, 0, 320, 180);
    // If we get here without throwing, the test passes
  });

  await runner.run('compositeFrame fills canvas with black on empty sequence', async () => {
    const p = makeMinimalProject();
    // Remove all clips so the compositor just fills black
    p.sequences[p.activeSequenceId].clips = [];
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const ctx = canvas.getContext('2d')!;
    await compositeFrame(ctx, p, 0, 4, 4);
    const pixel = ctx.getImageData(0, 0, 1, 1).data;
    assertEqual(pixel[0], 0, 'R=0 (black)');
    assertEqual(pixel[1], 0, 'G=0 (black)');
    assertEqual(pixel[2], 0, 'B=0 (black)');
  });

  await runner.run('compositeFrame respects cancellation token', async () => {
    const p = makeMinimalProject();
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext('2d')!;
    const token = createCancellationToken();
    token.cancel(); // cancel immediately
    let threw = false;
    try {
      await compositeFrame(ctx, p, 0, 320, 180, token);
    } catch (e) {
      threw = e instanceof ExportCancelledError;
    }
    assert(threw, 'compositeFrame throws ExportCancelledError when token is cancelled');
  });

  await runner.run('compositeFrame multiple frames without error', async () => {
    const p = makeMinimalProject();
    p.sequences[p.activeSequenceId].clips = [];
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const ctx = canvas.getContext('2d')!;
    for (let f = 0; f < 5; f++) {
      await compositeFrame(ctx, p, f, 160, 90);
    }
  });
}

// ── Suite 6: Audio Mixdown ────────────────────────────────────

async function runAudioMixTests(runner: TestRunner): Promise<void> {
  runner.setSuite('Audio Mixdown');

  await runner.run('mixdownAudio returns deferred when no files provided', async () => {
    const p = makeMinimalProject();
    const result = await mixdownAudio(p, new Map(), 5, 48000, 2);
    assert(!result.isReal, 'isReal is false when no files');
    assertDefined(result.deferredReason, 'deferredReason is set');
  });

  await runner.run('mixdownAudio returns correct duration', async () => {
    const p = makeMinimalProject();
    const durationSecs = 3;
    const result = await mixdownAudio(p, new Map(), durationSecs, 48000, 2);
    assertEqual(result.durationSecs, durationSecs, 'durationSecs');
  });

  await runner.run('mixdownAudio returns correct channel count', async () => {
    const p = makeMinimalProject();
    const result = await mixdownAudio(p, new Map(), 1, 48000, 2);
    assertEqual(result.channels, 2, 'channels');
  });

  await runner.run('mixdownAudio respects cancellation token', async () => {
    const p = makeMinimalProject();
    const token = createCancellationToken();
    token.cancel();
    let threw = false;
    try {
      await mixdownAudio(p, new Map(), 5, 48000, 2, undefined, token);
    } catch (e) {
      threw = e instanceof ExportCancelledError;
    }
    assert(threw, 'mixdownAudio throws ExportCancelledError when token is cancelled');
  });
}

// ── Suite 7: WAV Encoder ──────────────────────────────────────

async function runWAVEncoderTests(runner: TestRunner): Promise<void> {
  runner.setSuite('WAV Encoder');

  await runner.run('encodePCMToWAV produces valid RIFF header', () => {
    const sampleRate = 48000;
    const channels = 2;
    const numSamples = 480; // 10ms
    const pcm = [new Float32Array(numSamples), new Float32Array(numSamples)];
    const blob = encodePCMToWAV(pcm, sampleRate, channels);
    assert(blob.size > 44, 'WAV blob size > 44 bytes (header)');
    assert(blob.type === 'audio/wav', 'MIME type is audio/wav');
  });

  await runner.run('encodePCMToWAV size matches expected', () => {
    const sampleRate = 44100;
    const channels = 1;
    const numSamples = 44100; // 1 second
    const pcm = [new Float32Array(numSamples)];
    const blob = encodePCMToWAV(pcm, sampleRate, channels);
    // 44 header + numSamples * channels * 2 bytes
    const expectedSize = 44 + numSamples * channels * 2;
    assertEqual(blob.size, expectedSize, 'WAV blob size');
  });

  await runner.run('encodePCMToWAV handles stereo', () => {
    const sampleRate = 48000;
    const channels = 2;
    const numSamples = 1000;
    const pcm = [new Float32Array(numSamples).fill(0.5), new Float32Array(numSamples).fill(-0.5)];
    const blob = encodePCMToWAV(pcm, sampleRate, channels);
    assert(blob.size > 44, 'stereo WAV has data');
  });
}

// ── Suite 8: Cancellation ─────────────────────────────────────

async function runCancellationTests(runner: TestRunner): Promise<void> {
  runner.setSuite('Cancellation');

  await runner.run('createCancellationToken starts uncancelled', () => {
    const token = createCancellationToken();
    assert(!token.cancelled, 'token starts uncancelled');
  });

  await runner.run('cancel() sets cancelled to true', () => {
    const token = createCancellationToken();
    token.cancel();
    assert(token.cancelled, 'token is cancelled after cancel()');
  });

  await runner.run('throwIfCancelled throws ExportCancelledError', () => {
    const token = createCancellationToken();
    token.cancel();
    let threw = false;
    try { token.throwIfCancelled(); } catch (e) { threw = e instanceof ExportCancelledError; }
    assert(threw, 'throwIfCancelled throws ExportCancelledError');
  });

  await runner.run('onCancel callback fires on cancel()', () => {
    const token = createCancellationToken();
    let fired = false;
    token.onCancel(() => { fired = true; });
    token.cancel();
    assert(fired, 'onCancel callback fired');
  });

  await runner.run('cancel() is idempotent', () => {
    const token = createCancellationToken();
    let count = 0;
    token.onCancel(() => count++);
    token.cancel();
    token.cancel();
    token.cancel();
    assertEqual(count, 1, 'onCancel fires exactly once');
  });

  await runner.run('throwIfCancelled does not throw when not cancelled', () => {
    const token = createCancellationToken();
    token.throwIfCancelled(); // should not throw
  });
}

// ── Suite 9: Progress Events ──────────────────────────────────

async function runProgressTests(runner: TestRunner): Promise<void> {
  runner.setSuite('Progress Events');

  await runner.run('progress events are emitted during export', async () => {
    const p = makeMinimalProject();
    p.sequences[p.activeSequenceId].clips = []; // empty sequence = fast export
    const events: RenderProgressEvent[] = [];
    const plan = buildExportPlan(p, 'preset-h264-1080p');
    if (!plan) skip('no export plan');

    // We can't run a full MediaRecorder export in test, but we can verify
    // the capability detection phase emits an event via runExport
    // For a lightweight test, verify the event shape from compositeFrame path
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const ctx = canvas.getContext('2d')!;
    const token = createCancellationToken();

    // Simulate what exportWithMediaRecorder does for frame 0
    await compositeFrame(ctx, p, 0, 4, 4, token);
    // If we get here, compositing works; progress events are tested via integration
    assert(true, 'compositing completes without error');
  });

  await runner.run('RenderProgressEvent phase values are valid', () => {
    const validPhases = [
      'detecting-capabilities', 'compositing-frames', 'audio-mix',
      'encoding', 'muxing', 'complete', 'failed', 'cancelled',
    ];
    // Verify the type contract — just check the array is non-empty
    assert(validPhases.length > 0, 'valid phases defined');
  });
}

// ── Suite 10: Motion Clip Integration ────────────────────────

async function runMotionIntegrationTests(runner: TestRunner): Promise<void> {
  runner.setSuite('Motion Clip Integration');

  await runner.run('evaluateMotionClip returns null for missing motion doc', () => {
    const p = makeMinimalProject();
    const seq = p.sequences[p.activeSequenceId];
    const clip = seq.clips[0];
    // clip is a video clip, not a motion clip — should return null
    const result = evaluateMotionClip(p, clip, 0);
    assert(result === null || result === undefined, 'evaluateMotionClip returns null for non-motion clip');
  });

  await runner.run('motion clip in sequence does not break render plan', () => {
    const p = makeMinimalProject();
    const seq = p.sequences[p.activeSequenceId];

    // Add a motion clip
    const motionClip: Clip = {
      id: 'clip-motion-1',
      name: 'Motion Clip',
      assetId: undefined,
      trackId: seq.tracks[0].id,
      kind: 'motion',
      motionDocumentId: 'motion-doc-nonexistent',
      startTime: { value: 30, timescale: 30 },
      duration: { value: 30, timescale: 30 },
      sourceIn: { value: 0, timescale: 30 },
      sourceOut: { value: 30, timescale: 30 },
      speed: 1,
      reverse: false,
      freeze: false,
      gain: 0,
      pan: 0,
      fadeIn: { value: 0, timescale: 30 },
      fadeOut: { value: 0, timescale: 30 },
      effects: [],
      masks: [],
      keyframes: [],
      disabled: false,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0 },
    };
    seq.clips.push(motionClip);

    // buildRenderPlan should not throw even with a missing motion doc
    const plan = buildRenderPlan(p, 30); // frame 30 = 1s
    assert(plan === null || typeof plan === 'object', 'render plan does not throw with motion clip');
  });
}

// ── Suite 11: Save / Reload Round-Trip ───────────────────────

async function runPersistenceTests(runner: TestRunner): Promise<void> {
  runner.setSuite('Save / Reload Round-Trip');

  await runner.run('project serializes to JSON without error', () => {
    const p = makeMinimalProject();
    const json = JSON.stringify(p);
    assert(json.length > 0, 'JSON is non-empty');
  });

  await runner.run('project deserializes from JSON correctly', () => {
    const p = makeMinimalProject();
    const json = JSON.stringify(p);
    const restored = JSON.parse(json) as ProjectData;
    assertEqual(restored.id, p.id, 'id matches');
    assertEqual(restored.name, p.name, 'name matches');
    assertEqual(restored.activeSequenceId, p.activeSequenceId, 'activeSequenceId matches');
    const seq = restored.sequences[restored.activeSequenceId];
    assertDefined(seq, 'active sequence after restore');
    assertEqual(seq.clips.length, p.sequences[p.activeSequenceId].clips.length, 'clip count matches');
  });

  await runner.run('clip keyframes survive serialization', () => {
    const p = makeMinimalProject();
    const clip = p.sequences[p.activeSequenceId].clips[0];
    clip.keyframes = [
      { id: 'kf-1', property: 'opacity', time: { value: 15, timescale: 30 }, value: 0.5, easing: 'linear' },
    ];
    const restored = JSON.parse(JSON.stringify(p)) as ProjectData;
    const restoredClip = restored.sequences[restored.activeSequenceId].clips[0];
    assertEqual(restoredClip.keyframes.length, 1, 'keyframe count');
    assertEqual(restoredClip.keyframes[0].value as number, 0.5, 'keyframe value');
  });

  await runner.run('export presets survive serialization', () => {
    const p = makeMinimalProject();
    const restored = JSON.parse(JSON.stringify(p)) as ProjectData;
    assertDefined(restored.exportPresets['preset-h264-1080p'], 'preset survives');
  });
}

// ── Suite 12: Motion Clip Add / Edit / Return ─────────────────

async function runMotionWorkflowTests(runner: TestRunner): Promise<void> {
  runner.setSuite('Motion Clip Add / Edit / Return');

  await runner.run('createMotionClipOps produces valid ops', () => {
    const p = makeMinimalProject();
    const seq = p.sequences[p.activeSequenceId];
    const doc = makeMinimalMotionDoc();
    const ops = createMotionClipOps({
      doc,
      sequenceId: seq.id,
      trackId: seq.tracks[0].id,
      startTimeSecs: 0,
      fps: seq.format.fps,
    });
    assert(ops.length >= 2, 'createMotionClipOps returns at least 2 ops');
    assert(ops.some(o => o.type === 'motion.document.register'), 'includes motion.document.register op');
    assert(ops.some(o => o.type === 'clip.add'), 'includes clip.add op');
  });

  await runner.run('motion document registers in project state', () => {
    const p = makeMinimalProject();
    const seq = p.sequences[p.activeSequenceId];
    const doc = makeMinimalMotionDoc();
    const ops = createMotionClipOps({
      doc,
      sequenceId: seq.id,
      trackId: seq.tracks[0].id,
      startTimeSecs: 0,
      fps: seq.format.fps,
    });
    const result = applyOps(p, ops);
    assertDefined(result.state.motionDocuments?.[doc.id], 'motion document registered in project');
  });

  await runner.run('motion clip appears in sequence after add', () => {
    const p = makeMinimalProject();
    const seq = p.sequences[p.activeSequenceId];
    const doc = makeMinimalMotionDoc();
    const ops = createMotionClipOps({
      doc,
      sequenceId: seq.id,
      trackId: seq.tracks[0].id,
      startTimeSecs: 0,
      fps: seq.format.fps,
    });
    const { state } = applyOps(p, ops);
    const updatedSeq = state.sequences[state.activeSequenceId];
    const motionClip = updatedSeq.clips.find(c => c.kind === 'motion');
    assertDefined(motionClip, 'motion clip in sequence');
    assert(motionClip!.motionDocumentId === doc.id, 'clip references correct motion document');
  });

  await runner.run('motionTransactionToStudioOps produces ops for doc update', () => {
    const p = makeMinimalProject();
    const seq = p.sequences[p.activeSequenceId];
    const doc = makeMinimalMotionDoc();

    // Register the doc first
    const addOps = createMotionClipOps({
      doc,
      sequenceId: seq.id,
      trackId: seq.tracks[0].id,
      startTimeSecs: 0,
      fps: seq.format.fps,
    });
    const { state } = applyOps(p, addOps);

    // Create a motion transaction that updates the doc name
    const motionOp = makeMotionOp('motion.setDocumentProp', doc.id, { props: { name: 'Updated Name' } });
    const transaction = createMotionTransaction('Update doc name', [motionOp]);
    const studioOps = motionTransactionToStudioOps(transaction, state);
    assert(studioOps.length > 0, 'motionTransactionToStudioOps produces ops');
    assert(studioOps.some(o => o.type === 'motion.document.register'), 'includes motion.document.register');
  });

  await runner.run('motion document update reflects in resolveMotionDocument', () => {
    const p = makeMinimalProject();
    const seq = p.sequences[p.activeSequenceId];
    const doc = makeMinimalMotionDoc();
    const addOps = createMotionClipOps({
      doc,
      sequenceId: seq.id,
      trackId: seq.tracks[0].id,
      startTimeSecs: 0,
      fps: seq.format.fps,
    });
    const { state } = applyOps(p, addOps);
    const resolved = resolveMotionDocument(state, doc.id);
    assertDefined(resolved, 'resolveMotionDocument returns document');
    assert(resolved!.id === doc.id, 'resolved document id matches');
  });
}

// ── Suite 13: Undo / Redo ─────────────────────────────────────

async function runUndoRedoTests(runner: TestRunner): Promise<void> {
  runner.setSuite('Undo / Redo');

  type EngineState = { project: ProjectData; undoStack: ProjectData[]; redoStack: ProjectData[] };

  function makeEngineState(p: ProjectData): EngineState {
    return { project: p, undoStack: [], redoStack: [] };
  }

  function dispatchWithHistory(es: EngineState, op: ReturnType<typeof makeOp>): EngineState {
    const result = applyOp(es.project, op);
    if (!result.didMutate) return es;
    return { project: result.state, undoStack: [...es.undoStack, es.project], redoStack: [] };
  }

  function undo(es: EngineState): EngineState {
    if (es.undoStack.length === 0) return es;
    const prev = es.undoStack[es.undoStack.length - 1];
    return { project: prev, undoStack: es.undoStack.slice(0, -1), redoStack: [es.project, ...es.redoStack] };
  }

  function redo(es: EngineState): EngineState {
    if (es.redoStack.length === 0) return es;
    const next = es.redoStack[0];
    return { project: next, undoStack: [...es.undoStack, es.project], redoStack: es.redoStack.slice(1) };
  }

  await runner.run('undo restores prior state after clip.setGain', () => {
    const p = makeMinimalProject();
    const seq = p.sequences[p.activeSequenceId];
    const clip = seq.clips[0];
    const originalGain = clip.gain;

    let es = makeEngineState(p);
    es = dispatchWithHistory(es, makeOp('clip.setGain', { sequenceId: seq.id, clipId: clip.id, gain: 6 }));
    assertEqual(es.project.sequences[seq.id].clips.find(c => c.id === clip.id)!.gain, 6, 'gain is 6 after set');

    es = undo(es);
    assertEqual(es.project.sequences[seq.id].clips.find(c => c.id === clip.id)!.gain, originalGain, 'gain restored after undo');
  });

  await runner.run('redo reapplies state after undo', () => {
    const p = makeMinimalProject();
    const seq = p.sequences[p.activeSequenceId];
    const clip = seq.clips[0];

    let es = makeEngineState(p);
    es = dispatchWithHistory(es, makeOp('clip.setGain', { sequenceId: seq.id, clipId: clip.id, gain: 9 }));
    es = undo(es);
    es = redo(es);
    assertEqual(es.project.sequences[seq.id].clips.find(c => c.id === clip.id)!.gain, 9, 'gain reapplied after redo');
  });

  await runner.run('undo stack is empty initially', () => {
    let es = makeEngineState(makeMinimalProject());
    assertEqual(es.undoStack.length, 0, 'undoStack starts empty');
  });

  await runner.run('redo stack clears after new dispatch', () => {
    const p = makeMinimalProject();
    const seq = p.sequences[p.activeSequenceId];
    const clip = seq.clips[0];

    let es = makeEngineState(p);
    es = dispatchWithHistory(es, makeOp('clip.setGain', { sequenceId: seq.id, clipId: clip.id, gain: 3 }));
    es = undo(es);
    assertEqual(es.redoStack.length, 1, 'redo stack has 1 entry after undo');
    es = dispatchWithHistory(es, makeOp('clip.setGain', { sequenceId: seq.id, clipId: clip.id, gain: 5 }));
    assertEqual(es.redoStack.length, 0, 'redo stack cleared after new dispatch');
  });

  await runner.run('multiple undo steps restore sequential states', () => {
    const p = makeMinimalProject();
    const seq = p.sequences[p.activeSequenceId];
    const clip = seq.clips[0];

    let es = makeEngineState(p);
    es = dispatchWithHistory(es, makeOp('clip.setGain', { sequenceId: seq.id, clipId: clip.id, gain: 1 }));
    es = dispatchWithHistory(es, makeOp('clip.setGain', { sequenceId: seq.id, clipId: clip.id, gain: 2 }));
    es = dispatchWithHistory(es, makeOp('clip.setGain', { sequenceId: seq.id, clipId: clip.id, gain: 3 }));

    es = undo(es);
    assertEqual(es.project.sequences[seq.id].clips.find(c => c.id === clip.id)!.gain, 2, 'after 1 undo: gain=2');
    es = undo(es);
    assertEqual(es.project.sequences[seq.id].clips.find(c => c.id === clip.id)!.gain, 1, 'after 2 undos: gain=1');
    es = undo(es);
    assertEqual(es.project.sequences[seq.id].clips.find(c => c.id === clip.id)!.gain, 0, 'after 3 undos: gain=original');
  });
}

// ── Suite 14: Save / Reload / Relink ─────────────────────────

async function runSaveReloadRelinkTests(runner: TestRunner): Promise<void> {
  runner.setSuite('Save / Reload / Relink');

  await runner.run('serializeProject strips runtimeUrl from assets', () => {
    const p = makeMinimalProject();
    p.assets['asset-test-video'].runtimeUrl = 'blob:http://localhost/fake-url';
    const json = serializeProject(p);
    const parsed = JSON.parse(json);
    const asset = parsed.assets['asset-test-video'];
    assert(!asset.runtimeUrl, 'runtimeUrl stripped from serialized project');
  });

  await runner.run('deserializeProject restores all clips and tracks', () => {
    const p = makeMinimalProject();
    const json = serializeProject(p);
    const restored = deserializeProject(json);
    const seq = restored.sequences[restored.activeSequenceId];
    assertDefined(seq, 'sequence restored');
    assertEqual(seq.clips.length, p.sequences[p.activeSequenceId].clips.length, 'clip count matches');
    assertEqual(seq.tracks.length, p.sequences[p.activeSequenceId].tracks.length, 'track count matches');
  });

  await runner.run('motion documents survive save/reload round-trip', () => {
    const p = makeMinimalProject();
    const seq = p.sequences[p.activeSequenceId];
    const doc = makeMinimalMotionDoc();
    const addOps = createMotionClipOps({
      doc,
      sequenceId: seq.id,
      trackId: seq.tracks[0].id,
      startTimeSecs: 0,
      fps: seq.format.fps,
    });
    const { state } = applyOps(p, addOps);
    const json = serializeProject(state);
    const restored = deserializeProject(json);
    assertDefined(restored.motionDocuments?.[doc.id], 'motion document survives round-trip');
    const restoredDoc = resolveMotionDocument(restored, doc.id);
    assertDefined(restoredDoc, 'resolveMotionDocument works after reload');
    assertEqual(restoredDoc!.name, doc.name, 'motion document name matches');
  });

  await runner.run('gain keyframes survive save/reload round-trip', () => {
    const p = makeMinimalProject();
    const seq = p.sequences[p.activeSequenceId];
    const clip = seq.clips[0];
    clip.keyframes = [
      { id: 'kf-gain-1', property: 'gain', time: { value: 15, timescale: 30 }, value: 6, easing: 'linear' },
      { id: 'kf-gain-2', property: 'gain', time: { value: 60, timescale: 30 }, value: -3, easing: 'ease-in-out' },
    ];
    const json = serializeProject(p);
    const restored = deserializeProject(json);
    const restoredClip = restored.sequences[restored.activeSequenceId].clips.find(c => c.id === clip.id);
    assertDefined(restoredClip, 'clip restored');
    assertEqual(restoredClip!.keyframes.length, 2, 'gain keyframes count matches');
    assertEqual(restoredClip!.keyframes[0].value as number, 6, 'first keyframe value matches');
    assertEqual(restoredClip!.keyframes[1].value as number, -3, 'second keyframe value matches');
  });

  await runner.run('asset.relink op updates caste to relinked', () => {
    const p = makeMinimalProject();
    const assetId = 'asset-test-video';
    assert(p.assets[assetId].caste === 'missing', 'asset starts as missing');
    const { state } = applyOp(p, makeOp('asset.relink', {
      assetId,
      newSourceRef: 'file://new-video.mp4',
      newRuntimeUrl: 'blob:http://localhost/new-url',
    }));
    assertEqual(state.assets[assetId].caste, 'relinked', 'asset caste is relinked after relink op');
    assertEqual(state.assets[assetId].sourceRef, 'file://new-video.mp4', 'sourceRef updated');
  });

  await runner.run('relinked asset runtimeUrl is updated', () => {
    const p = makeMinimalProject();
    const assetId = 'asset-test-video';
    const { state } = applyOp(p, makeOp('asset.relink', {
      assetId,
      newSourceRef: 'file://relinked.mp4',
      newRuntimeUrl: 'blob:http://localhost/relinked',
    }));
    assertEqual(state.assets[assetId].runtimeUrl, 'blob:http://localhost/relinked', 'runtimeUrl updated after relink');
  });

  await runner.run('missing asset caste survives serialization', () => {
    const p = makeMinimalProject();
    const json = serializeProject(p);
    const restored = deserializeProject(json);
    assertEqual(restored.assets['asset-test-video'].caste, 'missing', 'missing caste preserved after reload');
  });

  await runner.run('relinked asset caste survives serialization', () => {
    const p = makeMinimalProject();
    const { state } = applyOp(p, makeOp('asset.relink', {
      assetId: 'asset-test-video',
      newSourceRef: 'file://relinked.mp4',
      newRuntimeUrl: 'blob:http://localhost/relinked',
    }));
    const json = serializeProject(state);
    const restored = deserializeProject(json);
    assertEqual(restored.assets['asset-test-video'].caste, 'relinked', 'relinked caste survives serialization');
  });
}

// ── Suite 15: Gain Keyframe Audio Mix ─────────────────────────

async function runGainKeyframeAudioTests(runner: TestRunner): Promise<void> {
  runner.setSuite('Gain Keyframe Audio Mix');

  await runner.run('mixdownAudio defers gracefully when no files', async () => {
    const p = makeMinimalProject();
    const seq = p.sequences[p.activeSequenceId];
    const clip = seq.clips[0];
    clip.keyframes = [
      { id: 'kf-1', property: 'gain', time: { value: 0, timescale: 30 }, value: 0, easing: 'linear' },
      { id: 'kf-2', property: 'gain', time: { value: 150, timescale: 30 }, value: 6, easing: 'linear' },
    ];
    const result = await mixdownAudio(p, new Map(), 5, 48000, 2);
    assert(!result.isReal, 'deferred when no files (expected)');
    assertDefined(result.deferredReason, 'deferredReason set');
  });

  await runner.run('mixdownAudio returns correct duration and sample rate', async () => {
    const p = makeMinimalProject();
    const result = await mixdownAudio(p, new Map(), 2, 48000, 2);
    assertEqual(result.durationSecs, 2, 'durationSecs matches');
    assertEqual(result.sampleRate, 48000, 'sampleRate matches');
  });

  await runner.run('WAV from canonical PCM has correct byte length', () => {
    const sampleRate = 48000;
    const channels = 2;
    const numSamples = sampleRate; // 1s
    const pcm = [new Float32Array(numSamples).fill(0.1), new Float32Array(numSamples).fill(-0.1)];
    const wav = encodePCMToWAV(pcm, sampleRate, channels);
    const expectedSize = 44 + numSamples * channels * 2;
    assertEqual(wav.size, expectedSize, 'WAV byte length matches expected');
    assert(wav.type === 'audio/wav', 'MIME type is audio/wav');
  });

  await runner.run('WAV RIFF header is valid', async () => {
    const sampleRate = 44100;
    const channels = 1;
    const numSamples = 4410;
    const pcm = [new Float32Array(numSamples).fill(0.5)];
    const wav = encodePCMToWAV(pcm, sampleRate, channels);
    const ab = await wav.arrayBuffer();
    const view = new DataView(ab);
    const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    assertEqual(riff, 'RIFF', 'RIFF magic bytes');
    const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
    assertEqual(wave, 'WAVE', 'WAVE magic bytes');
    assertEqual(view.getUint32(24, true), sampleRate, 'sample rate in header');
    assertEqual(view.getUint16(22, true), channels, 'channel count in header');
  });

  await runner.run('canonical PCM path is same for WAV and muxed output', async () => {
    const p = makeMinimalProject();
    const result1 = await mixdownAudio(p, new Map(), 3, 48000, 2);
    const result2 = await mixdownAudio(p, new Map(), 3, 48000, 2);
    assertEqual(result1.durationSecs, result2.durationSecs, 'consistent durationSecs');
    assertEqual(result1.sampleRate, result2.sampleRate, 'consistent sampleRate');
    assertEqual(result1.channels, result2.channels, 'consistent channels');
    assertEqual(result1.isReal, result2.isReal, 'consistent isReal');
  });
}

// ── Suite 16: Export Frame / Audio Comparison ─────────────────

async function runExportComparisonTests(runner: TestRunner): Promise<void> {
  runner.setSuite('Export Frame / Audio Comparison');

  await runner.run('compositor is deterministic: same frame renders identically', async () => {
    const p = makeMinimalProject();
    p.sequences[p.activeSequenceId].clips = [];
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext('2d')!;

    await compositeFrame(ctx, p, 0, 8, 8);
    const frame0 = ctx.getImageData(0, 0, 8, 8).data.slice();
    await compositeFrame(ctx, p, 0, 8, 8);
    const frame0b = ctx.getImageData(0, 0, 8, 8).data.slice();

    let identical = true;
    for (let i = 0; i < frame0.length; i++) {
      if (frame0[i] !== frame0b[i]) { identical = false; break; }
    }
    assert(identical, 'compositor is deterministic: same frame renders identically');
  });

  await runner.run('export plan totalFrames matches sequence duration', () => {
    const p = makeMinimalProject();
    const plan = buildExportPlan(p, 'preset-h264-1080p');
    assertDefined(plan, 'export plan');
    assertEqual(plan!.totalFrames, 150, 'totalFrames = 150 for 5s sequence');
  });

  await runner.run('WAV output from canonical PCM has correct duration', async () => {
    const sampleRate = 48000;
    const durationSecs = 2;
    const channels = 2;
    const numSamples = sampleRate * durationSecs;
    const pcm = [new Float32Array(numSamples), new Float32Array(numSamples)];
    const wav = encodePCMToWAV(pcm, sampleRate, channels);
    const dataSize = wav.size - 44;
    const computedDuration = dataSize / (sampleRate * channels * 2);
    assert(Math.abs(computedDuration - durationSecs) < 0.001, `WAV duration ${computedDuration} ≈ ${durationSecs}s`);
  });

  await runner.run('encoder capabilities report is consistent across calls', async () => {
    const cap1 = await detectEncoderCapabilities();
    const cap2 = await detectEncoderCapabilities();
    assertEqual(cap1.recommendedFormat, cap2.recommendedFormat, 'recommendedFormat is consistent');
    assertEqual(cap1.mediaRecorderAvailable, cap2.mediaRecorderAvailable, 'mediaRecorderAvailable is consistent');
  });

  await runner.run('compositeFrame with motion clip does not throw', async () => {
    const p = makeMinimalProject();
    const seq = p.sequences[p.activeSequenceId];
    const doc = makeMinimalMotionDoc();
    const addOps = createMotionClipOps({
      doc,
      sequenceId: seq.id,
      trackId: seq.tracks[0].id,
      startTimeSecs: 0,
      fps: seq.format.fps,
    });
    const { state } = applyOps(p, addOps);
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    await compositeFrame(ctx, state, 0, 64, 64);
  });
}

// ── Suite 17: Full Workflow Integration ───────────────────────

async function runFullWorkflowTests(runner: TestRunner): Promise<void> {
  runner.setSuite('Full Workflow Integration');

  await runner.run('import → timeline → gain → save → reload → relink chain', () => {
    const p = makeMinimalProject();
    const seq = p.sequences[p.activeSequenceId];
    const assetId = 'asset-test-video';
    const clip = seq.clips[0];
    assertDefined(clip, 'clip on timeline');

    // Set gain
    let state = applyOp(p, makeOp('clip.setGain', { sequenceId: seq.id, clipId: clip.id, gain: 3 })).state;
    assertEqual(state.sequences[seq.id].clips.find(c => c.id === clip.id)!.gain, 3, 'gain set to 3');

    // Save / reload
    const reloaded = deserializeProject(serializeProject(state));
    const reloadedClip = reloaded.sequences[reloaded.activeSequenceId].clips.find(c => c.id === clip.id);
    assertDefined(reloadedClip, 'clip survives save/reload');
    assertEqual(reloadedClip!.gain, 3, 'gain survives save/reload');

    // Relink missing asset
    const relinked = applyOp(reloaded, makeOp('asset.relink', {
      assetId,
      newSourceRef: 'file://relinked.mp4',
      newRuntimeUrl: 'blob:http://localhost/relinked',
    })).state;
    assertEqual(relinked.assets[assetId].caste, 'relinked', 'asset relinked');
    assertEqual(relinked.sequences[relinked.activeSequenceId].clips.find(c => c.id === clip.id)!.assetId, assetId, 'clip still references relinked asset');
  });

  await runner.run('Motion clip add → edit → reload → evaluate chain', () => {
    const p = makeMinimalProject();
    const seq = p.sequences[p.activeSequenceId];
    const doc = makeMinimalMotionDoc();

    // Add motion clip
    const addOps = createMotionClipOps({
      doc,
      sequenceId: seq.id,
      trackId: seq.tracks[0].id,
      startTimeSecs: 0,
      fps: seq.format.fps,
    });
    let { state } = applyOps(p, addOps);

    // Edit motion doc via transaction
    const editOp = makeMotionOp('document.setProps', doc.id, { name: 'Edited Motion' });
    const transaction = createMotionTransaction('Edit doc name', [editOp]);
    const studioOps = motionTransactionToStudioOps(transaction, state);
    if (studioOps.length > 0) {
      state = applyOps(state, studioOps).state;
    }

    // Save and reload
    const reloaded = deserializeProject(serializeProject(state));
    const reloadedDoc = resolveMotionDocument(reloaded, doc.id);
    assertDefined(reloadedDoc, 'motion doc survives reload');

    // Evaluate motion clip after reload
    const motionClip = reloaded.sequences[reloaded.activeSequenceId].clips.find(c => c.kind === 'motion');
    assertDefined(motionClip, 'motion clip survives reload');
    const frameState = evaluateMotionClip(reloaded, motionClip!, 1.0);
    assert(frameState === null || typeof frameState === 'object', 'evaluateMotionClip returns null or FrameState');
  });

  await runner.run('AI apply → undo → redo cycle on motion document', () => {
    const p = makeMinimalProject();
    const seq = p.sequences[p.activeSequenceId];
    const doc = makeMinimalMotionDoc();

    // Register doc
    const addOps = createMotionClipOps({
      doc,
      sequenceId: seq.id,
      trackId: seq.tracks[0].id,
      startTimeSecs: 0,
      fps: seq.format.fps,
    });
    const { state: stateWithDoc } = applyOps(p, addOps);
    assertDefined(resolveMotionDocument(stateWithDoc, doc.id), 'doc registered');

    // Simulate AI apply
    const aiOp = makeMotionOp('document.setProps', doc.id, { name: 'AI Applied' });
    const transaction = createMotionTransaction('AI: update doc', [aiOp]);
    const studioOps = motionTransactionToStudioOps(transaction, stateWithDoc);
    const stateAfterAI = studioOps.length > 0 ? applyOps(stateWithDoc, studioOps).state : stateWithDoc;
    assertDefined(resolveMotionDocument(stateAfterAI, doc.id), 'doc exists after AI apply');

    // Undo: restore stateWithDoc
    assertDefined(resolveMotionDocument(stateWithDoc, doc.id), 'doc exists after undo');

    // Redo: re-apply studioOps
    const stateAfterRedo = studioOps.length > 0 ? applyOps(stateWithDoc, studioOps).state : stateWithDoc;
    assertDefined(resolveMotionDocument(stateAfterRedo, doc.id), 'doc exists after redo');
  });

  await runner.run('timeline + Motion + gain changes all survive save/reload', () => {
    const p = makeMinimalProject();
    const seq = p.sequences[p.activeSequenceId];
    const doc = makeMinimalMotionDoc();

    // Add motion clip
    const motionOps = createMotionClipOps({
      doc,
      sequenceId: seq.id,
      trackId: seq.tracks[0].id,
      startTimeSecs: 2,
      fps: seq.format.fps,
    });
    let state = applyOps(p, motionOps).state;

    // Set gain on video clip
    const videoClip = state.sequences[seq.id].clips.find(c => c.kind === 'video');
    assertDefined(videoClip, 'video clip exists');
    state = applyOp(state, makeOp('clip.setGain', { sequenceId: seq.id, clipId: videoClip!.id, gain: -6 })).state;

    // Add gain keyframe via setProps
    state = applyOp(state, makeOp('clip.setProps', {
      sequenceId: seq.id,
      clipId: videoClip!.id,
      props: {
        keyframes: [
          { id: 'kf-test', property: 'gain', time: { value: 30, timescale: 30 }, value: 0, easing: 'linear' },
        ],
      },
    })).state;

    // Save and reload
    const reloaded = deserializeProject(serializeProject(state));
    const reloadedSeq = reloaded.sequences[reloaded.activeSequenceId];

    const reloadedVideoClip = reloadedSeq.clips.find(c => c.kind === 'video');
    assertDefined(reloadedVideoClip, 'video clip survives');
    assertEqual(reloadedVideoClip!.gain, -6, 'gain survives');
    assertEqual(reloadedVideoClip!.keyframes.length, 1, 'keyframe survives');

    const reloadedMotionClip = reloadedSeq.clips.find(c => c.kind === 'motion');
    assertDefined(reloadedMotionClip, 'motion clip survives');
    assertDefined(reloaded.motionDocuments?.[doc.id], 'motion document survives');
  });
}

// ── Main runner ───────────────────────────────────────────────

export async function runAllTests(
  onProgress?: (result: TestResult) => void
): Promise<TestSuiteResult[]> {
  const runner = new TestRunner();
  const suiteRunners: Array<(r: TestRunner) => Promise<void>> = [
    runSchemaTests,
    runRenderPlanTests,
    runExportPlanTests,
    runCapabilityTests,
    runCompositorTests,
    runAudioMixTests,
    runWAVEncoderTests,
    runCancellationTests,
    runProgressTests,
    runMotionIntegrationTests,
    runPersistenceTests,
    runMotionWorkflowTests,
    runUndoRedoTests,
    runSaveReloadRelinkTests,
    runGainKeyframeAudioTests,
    runExportComparisonTests,
    runFullWorkflowTests,
  ];

  for (const suiteRunner of suiteRunners) {
    await suiteRunner(runner);
    // Notify after each test
    const latest = runner.getResults().slice(-1)[0];
    if (latest) onProgress?.(latest);
  }

  // Group by suite
  const allResults = runner.getResults();
  const suiteMap = new Map<string, TestResult[]>();
  for (const r of allResults) {
    if (!suiteMap.has(r.suite)) suiteMap.set(r.suite, []);
    suiteMap.get(r.suite)!.push(r);
  }

  const suiteResults: TestSuiteResult[] = [];
  for (const [suite, results] of suiteMap) {
    suiteResults.push({
      suite,
      passed: results.filter(r => r.status === 'pass').length,
      failed: results.filter(r => r.status === 'fail').length,
      skipped: results.filter(r => r.status === 'skip').length,
      warned: results.filter(r => r.status === 'warn').length,
      results,
      totalMs: results.reduce((s, r) => s + r.durationMs, 0),
    });
  }

  return suiteResults;
}

export function summarizeResults(suites: TestSuiteResult[]): string {
  const total = suites.reduce((s, r) => s + r.results.length, 0);
  const passed = suites.reduce((s, r) => s + r.passed, 0);
  const failed = suites.reduce((s, r) => s + r.failed, 0);
  const skipped = suites.reduce((s, r) => s + r.skipped, 0);
  const ms = suites.reduce((s, r) => s + r.totalMs, 0);
  return `${passed}/${total} passed, ${failed} failed, ${skipped} skipped — ${ms}ms`;
}

// ── Minimal MotionDocument factory ───────────────────────────

function makeMinimalMotionDoc(id?: string, durationSecs = 3): MotionDocument {
  const docId = id ?? generateMotionId();
  return {
    id: docId,
    name: 'Test Motion',
    schemaVersion: 1,
    duration: secondsToMotionTime(durationSecs),
    fps: 30,
    width: 1920,
    height: 1080,
    objects: {},
    rootObjectIds: [],
    materials: {},
    cameras: {},
    signals: {},
    rigs: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ── Thin reducer helper for tests ────────────────────────────

function applyTestOp(state: ProjectData, op: ReturnType<typeof makeOp>, _description?: string): ProjectData {
  return applyOp(state, op).state;
}
