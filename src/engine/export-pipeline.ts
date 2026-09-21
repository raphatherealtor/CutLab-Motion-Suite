/**
 * CutLab A/V Export Pipeline v3
 * ONE honest browser A/V production path:
 *   MediaRecorder + canvas capture stream + SAME compositor as Studio Viewer
 *   + canonical PCM audio via MediaStreamAudioDestinationNode → valid playable WebM
 *
 * WebCodecs is NOT used as a successful production export path.
 * It cannot produce a correctly muxed compositor-rendered output in-browser.
 * WAV fallback only if MediaRecorder is unavailable.
 */

import type { ProjectData, ExportPreset } from './schema';
import { buildRenderPlan } from './render-plan';
import { renderFrame } from './compositor';
import { mixdownSequence, audioBufferToWav } from './audio-mixer';
import { toSeconds } from './time';

export type ExportStatus =
  | 'pending' | 'rendering' | 'encoding' | 'muxing' | 'complete' | 'failed';

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
  totalFrames: number;
  renderedFrames: number;
  /** Path used: 'mediarecorder' | 'audio-only' */
  encoderPath?: string;
}

// ── Sequence duration helper ──────────────────────────────────

function getSequenceDurationFrames(project: ProjectData): number {
  const seq = project.sequences[project.activeSequenceId];
  if (!seq) return 0;
  const fps = seq.format.fps;
  return Math.ceil(
    seq.clips.reduce((max, c) => {
      const end = toSeconds(c.startTime) + toSeconds(c.duration);
      return Math.max(max, end);
    }, 0) * fps
  );
}

// ── MediaRecorder export — the ONE production A/V path ────────

/**
 * Export via MediaRecorder.
 * Renders every frame through the SAME compositor as Studio Viewer.
 * Audio is routed to MediaStreamAudioDestinationNode — NOT to speakers.
 * Frame zero is rendered before recording begins to ensure A/V start alignment.
 */
async function exportViaMediaRecorder(
  project: ProjectData,
  preset: ExportPreset,
  onProgress: (p: number, status: ExportStatus) => void
): Promise<Blob | null> {
  if (typeof MediaRecorder === 'undefined') return null;

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus' : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
    ? 'video/webm;codecs=vp8,opus' : MediaRecorder.isTypeSupported('video/webm')
    ? 'video/webm'
    : null;

  if (!mimeType) return null;

  const seq = project.sequences[project.activeSequenceId];
  if (!seq) return null;

  const fps = preset.fps;
  const totalFrames = getSequenceDurationFrames(project);
  if (totalFrames === 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = preset.width;
  canvas.height = preset.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // ── Frame zero: render before recording begins ──
  // This ensures the recorder captures real content from the very first frame.
  const plan0 = buildRenderPlan(project, 0);
  if (plan0) {
    await renderFrame(ctx, plan0, project, { playing: false });
  } else {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, preset.width, preset.height);
  }

  // ── Set up audio: route to MediaStreamAudioDestinationNode, NOT speakers ──
  let audioStream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  let audioSource: AudioBufferSourceNode | null = null;

  try {
    const mixdown = await mixdownSequence(project, (p) => onProgress(p * 0.1, 'encoding'));
    if (mixdown) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      audioCtx = new AudioCtx();
      const dest = audioCtx.createMediaStreamDestination();
      audioSource = audioCtx.createBufferSource();
      audioSource.buffer = mixdown.buffer;
      // Connect to destination stream only — NOT to audioCtx.destination (speakers)
      audioSource.connect(dest);
      audioStream = dest.stream;
    }
  } catch {
    // Audio setup failed — continue with video-only
  }

  // ── Set up MediaRecorder with combined video + audio stream ──
  const videoStream = canvas.captureStream(fps);
  const combinedStream = audioStream
    ? new MediaStream([...videoStream.getTracks(), ...audioStream.getTracks()])
    : videoStream;

  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: preset.bitrate,
    audioBitsPerSecond: preset.audioBitrate ?? 192000,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  // ── Start audio from same origin as recorder ──
  // Frame zero already rendered above. Start recorder, then start audio source.
  recorder.start(100); // collect data every 100ms
  if (audioSource && audioCtx) {
    // Start audio from time 0, synchronized with recorder start
    audioSource.start(audioCtx.currentTime);
  }

  onProgress(0.1, 'rendering');

  // ── Render all frames through the canonical compositor ──
  const frameInterval = 1000 / fps;
  for (let f = 0; f < totalFrames; f++) {
    const plan = buildRenderPlan(project, f);
    if (plan) {
      // Same compositor as Studio Viewer — renders Motion objects, behaviors, signals, assets
      await renderFrame(ctx, plan, project, { playing: false });
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, preset.width, preset.height);
    }

    onProgress(0.1 + (f / totalFrames) * 0.85, 'rendering');
    // Wait one frame interval so MediaRecorder captures this canvas state
    await new Promise((r) => setTimeout(r, frameInterval));
  }

  recorder.stop();
  await new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });

  if (audioCtx) audioCtx.close().catch(() => {});

  if (chunks.length === 0) return null;
  return new Blob(chunks, { type: mimeType });
}

// ── Main export function ──────────────────────────────────────

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
      id: jobId, projectId: project.id, sequenceId: project.activeSequenceId, presetId,
      status: 'failed', progress: 0, error: 'Invalid sequence or preset',
      totalFrames: 0, renderedFrames: 0,
    };
  }

  const totalFrames = getSequenceDurationFrames(project);
  const progressFn = (p: number, _status?: ExportStatus) => onProgress?.(p);

  let outputBlob: Blob | null = null;
  let encoderPath = 'unknown';

  try {
    // MediaRecorder is the ONE production A/V export path.
    // WebCodecs is NOT used — it cannot produce correctly muxed compositor-rendered output.
    outputBlob = await exportViaMediaRecorder(project, preset, progressFn);
    if (outputBlob) encoderPath = 'mediarecorder';

    if (!outputBlob) {
      // Last resort: audio-only WAV export
      const mixdown = await mixdownSequence(project, onProgress);
      if (mixdown) {
        outputBlob = audioBufferToWav(mixdown.buffer);
        encoderPath = 'audio-only';
      }
    }

    if (!outputBlob) {
      return {
        id: jobId, projectId: project.id, sequenceId: project.activeSequenceId, presetId,
        status: 'failed', progress: 0, error: 'MediaRecorder not available in this browser',
        totalFrames, renderedFrames: 0, encoderPath,
      };
    }

    const outputUrl = URL.createObjectURL(outputBlob);
    onProgress?.(1.0);

    return {
      id: jobId, projectId: project.id, sequenceId: project.activeSequenceId, presetId,
      status: 'complete', progress: 1,
      outputBlob, outputUrl,
      totalFrames, renderedFrames: totalFrames,
      completedAt: Date.now(),
      encoderPath,
    };
  } catch (e) {
    return {
      id: jobId, projectId: project.id, sequenceId: project.activeSequenceId, presetId,
      status: 'failed', progress: 0, error: String(e),
      totalFrames, renderedFrames: 0, encoderPath,
    };
  }
}

export function getDefaultPreset(project: ProjectData): ExportPreset | null {
  return project.exportPresets['preset-webm-1080p']
    ?? project.exportPresets['preset-h264-1080p']
    ?? null;
}

export function formatExportStatus(job: ExportJob): string {
  switch (job.status) {
    case 'pending': return 'Waiting...';
    case 'rendering': return `Rendering ${Math.round(job.progress * 100)}%`;
    case 'encoding': return `Encoding ${Math.round(job.progress * 100)}%`;
    case 'muxing': return `Muxing ${Math.round(job.progress * 100)}%`;
    case 'complete': return `Export complete (${job.encoderPath})`;
    case 'failed': return `Failed: ${job.error}`;
    default: return 'Unknown';
  }
}
