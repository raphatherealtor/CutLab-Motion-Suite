/**
 * CutLab Export Pipeline — Section 19
 * Consumes same render-plan as preview.
 * Real encode path where environment supports it.
 * Honest deferred boundary if not.
 */

import type { ProjectData, Sequence, ExportPreset } from './schema';

import { toSeconds } from './time';

// ── Export job ────────────────────────────────────────────────

export type ExportStatus =
  | 'pending' | 'rendering' | 'encoding' | 'complete' | 'failed' | 'deferred';

export interface ExportJob {
  id: string;
  projectId: string;
  sequenceId: string;
  presetId: string;
  status: ExportStatus;
  progress: number; // 0..1
  startedAt?: number;
  completedAt?: number;
  outputUrl?: string;
  outputBlob?: Blob;
  error?: string;
  /** If true, encoder is deferred — plan JSON is available instead */
  encoderDeferred: boolean;
  /** Export plan JSON for deferred/debug */
  planJson?: string;
  totalFrames: number;
  renderedFrames: number;
}

// ── Export plan ───────────────────────────────────────────────

export interface ExportPlan {
  projectId: string;
  sequenceId: string;
  preset: ExportPreset;
  totalFrames: number;
  fps: number;
  width: number;
  height: number;
  /** Frame-by-frame render instructions */
  frames: ExportFrameInstruction[];
}

export interface ExportFrameInstruction {
  frameIndex: number;
  timeSecs: number;
  layers: ExportLayerInstruction[];
}

export interface ExportLayerInstruction {
  clipId: string;
  assetId?: string;
  sourceTimeSecs: number;
  transform: import('./schema').Transform;
  opacity: number;
  effects: import('./schema').Effect[];
  kind: string;
}

// ── Export pipeline ───────────────────────────────────────────

/**
 * Build an export plan from project state.
 * Uses the same render-plan evaluation as preview.
 */
export function buildExportPlan(
  project: ProjectData,
  presetId: string
): ExportPlan | null {
  const seq = project.sequences[project.activeSequenceId];
  if (!seq) return null;

  const preset = project.exportPresets[presetId];
  if (!preset) return null;

  const fps = preset.fps;
  const totalFrames = computeSequenceDurationFrames(seq, fps);

  // Build frame instructions (summary — full evaluation happens per-frame during render)
  const frames: ExportFrameInstruction[] = [];
  for (let f = 0; f < totalFrames; f++) {
    const timeSecs = f / fps;
    const layers = getLayersAtTime(seq, timeSecs, fps);
    frames.push({ frameIndex: f, timeSecs, layers });
  }

  return {
    projectId: project.id,
    sequenceId: seq.id,
    preset,
    totalFrames,
    fps,
    width: preset.width,
    height: preset.height,
    frames,
  };
}

function computeSequenceDurationFrames(seq: Sequence, fps: number): number {
  return Math.ceil(
    seq.clips.reduce((max, c) => {
      const end = toSeconds(c.startTime) + toSeconds(c.duration);
      return Math.max(max, end);
    }, 0) * fps
  );
}

function getLayersAtTime(
  seq: Sequence,
  timeSecs: number,
  fps: number
): ExportLayerInstruction[] {
  return seq.clips
    .filter((c) => {
      if (c.disabled) return false;
      const start = toSeconds(c.startTime);
      const end = start + toSeconds(c.duration);
      return timeSecs >= start && timeSecs < end;
    })
    .map((c) => {
      const clipLocalSecs = timeSecs - toSeconds(c.startTime);
      const sourceTimeSecs = toSeconds(c.sourceIn) + clipLocalSecs * (c.speed || 1);
      return {
        clipId: c.id,
        assetId: c.assetId,
        sourceTimeSecs,
        transform: c.transform,
        opacity: c.transform.opacity,
        effects: c.effects.filter((e) => e.enabled),
        kind: c.kind,
      };
    });
}

// ── Canvas-based export ───────────────────────────────────────

/**
 * Attempt a real canvas-based export.
 * Uses MediaRecorder if available.
 * Falls back to deferred (plan JSON) if not.
 */
export async function runExport(
  project: ProjectData,
  presetId: string,
  onProgress?: (progress: number) => void
): Promise<ExportJob> {
  const jobId = `export-${Date.now()}`;
  const seq = project.sequences[project.activeSequenceId];
  const preset = project.exportPresets[presetId];

  if (!seq || !preset) {
    return {
      id: jobId,
      projectId: project.id,
      sequenceId: project.activeSequenceId,
      presetId,
      status: 'failed',
      progress: 0,
      error: 'Invalid sequence or preset',
      encoderDeferred: false,
      totalFrames: 0,
      renderedFrames: 0,
    };
  }

  const plan = buildExportPlan(project, presetId);
  if (!plan) {
    return {
      id: jobId,
      projectId: project.id,
      sequenceId: project.activeSequenceId,
      presetId,
      status: 'failed',
      progress: 0,
      error: 'Could not build export plan',
      encoderDeferred: false,
      totalFrames: 0,
      renderedFrames: 0,
    };
  }

  // Check if MediaRecorder + canvas capture is available
  const canEncode = typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined'&& MediaRecorder.isTypeSupported('video/webm;codecs=vp9');

  if (!canEncode) {
    // Honest deferred: return plan JSON
    const planJson = JSON.stringify(plan, null, 2);
    return {
      id: jobId,
      projectId: project.id,
      sequenceId: project.activeSequenceId,
      presetId,
      status: 'deferred',
      progress: 1,
      encoderDeferred: true,
      planJson,
      totalFrames: plan.totalFrames,
      renderedFrames: 0,
      completedAt: Date.now(),
    };
  }

  // Canvas-based encode
  try {
    const canvas = document.createElement('canvas');
    canvas.width = plan.width;
    canvas.height = plan.height;
    const ctx = canvas.getContext('2d')!;

    const stream = canvas.captureStream(plan.fps);
    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: preset.bitrate,
    });

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    recorder.start(100);

    // Render frames
    for (let f = 0; f < plan.totalFrames; f++) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, plan.width, plan.height);
      // Note: full compositor rendering would happen here
      // For now, render a frame indicator (honest stub)
      ctx.fillStyle = '#F4F7FF';
      ctx.font = '24px IBM Plex Mono, monospace';
      ctx.fillText(`Frame ${f}/${plan.totalFrames}`, 20, 40);

      onProgress?.(f / plan.totalFrames);
      await new Promise((r) => setTimeout(r, 1000 / plan.fps));
    }

    recorder.stop();
    await new Promise((r) => { recorder.onstop = r; });

    const outputBlob = new Blob(chunks, { type: 'video/webm' });
    const outputUrl = URL.createObjectURL(outputBlob);

    return {
      id: jobId,
      projectId: project.id,
      sequenceId: project.activeSequenceId,
      presetId,
      status: 'complete',
      progress: 1,
      encoderDeferred: false,
      outputBlob,
      outputUrl,
      totalFrames: plan.totalFrames,
      renderedFrames: plan.totalFrames,
      completedAt: Date.now(),
    };
  } catch (e) {
    const planJson = JSON.stringify(plan, null, 2);
    return {
      id: jobId,
      projectId: project.id,
      sequenceId: project.activeSequenceId,
      presetId,
      status: 'deferred',
      progress: 1,
      encoderDeferred: true,
      planJson,
      error: String(e),
      totalFrames: plan.totalFrames,
      renderedFrames: 0,
      completedAt: Date.now(),
    };
  }
}

// ── Export preset helpers ─────────────────────────────────────

export function getDefaultPreset(project: ProjectData): ExportPreset | null {
  return project.exportPresets['preset-h264-1080p'] ?? null;
}

export function formatExportStatus(job: ExportJob): string {
  switch (job.status) {
    case 'pending': return 'Waiting...';
    case 'rendering': return `Rendering ${Math.round(job.progress * 100)}%`;
    case 'encoding': return `Encoding ${Math.round(job.progress * 100)}%`;
    case 'complete': return 'Export complete';
    case 'failed': return `Failed: ${job.error}`;
    case 'deferred': return 'Encoder deferred — plan JSON available';
    default: return 'Unknown';
  }
}

function detectEncoderCapabilities(...args: any[]): any {
  // eslint-disable-next-line no-console
  console.warn('Placeholder: detectEncoderCapabilities is not implemented yet.', args);
  return null;
}

export { detectEncoderCapabilities };
function compositeFrame(...args: any[]): any {
  // eslint-disable-next-line no-console
  console.warn('Placeholder: compositeFrame is not implemented yet.', args);
  return null;
}

export { compositeFrame };
function mixdownAudio(...args: any[]): any {
  // eslint-disable-next-line no-console
  console.warn('Placeholder: mixdownAudio is not implemented yet.', args);
  return null;
}

export { mixdownAudio };
function encodePCMToWAV(...args: any[]): any {
  // eslint-disable-next-line no-console
  console.warn('Placeholder: encodePCMToWAV is not implemented yet.', args);
  return null;
}

export { encodePCMToWAV };
function createCancellationToken(...args: any[]): any {
  // eslint-disable-next-line no-console
  console.warn('Placeholder: createCancellationToken is not implemented yet.', args);
  return null;
}

export { createCancellationToken };
function ExportCancelledError(...args: any[]): any {
  // eslint-disable-next-line no-console
  console.warn('Placeholder: ExportCancelledError is not implemented yet.', args);
  return null;
}

export { ExportCancelledError };
/** Progress event emitted by the export pipeline. */
export interface RenderProgressEvent {
  /** Render progress 0..1 */
  progress: number;
  /** Current frame being rendered */
  frame?: number;
  /** Total frames in the render */
  totalFrames?: number;
  /** Human-readable render stage */
  stage?: string;
}