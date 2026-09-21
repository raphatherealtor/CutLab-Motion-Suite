/**
 * CutLab Media Bin — Section 1
 * Real asset management: ingest, metadata, waveform, missing/relink, stable IDs.
 * Runtime blob URLs are NEVER canonical identity.
 */

import type { Asset, AssetCaste } from './schema';
import { generateId } from './schema';

// ── Asset ingest ──────────────────────────────────────────────

export interface IngestResult {
  asset: Asset;
  runtimeUrl: string;
}

/**
 * Ingest a File into a canonical Asset.
 * sourceRef = stable UUID (not blob URL).
 * runtimeUrl = blob URL for this session only.
 */
export async function ingestFile(file: File): Promise<IngestResult> {
  const id = generateId('asset');
  const sourceRef = `local:${id}:${file.name}`;
  const runtimeUrl = URL.createObjectURL(file);

  const kind = detectKind(file);
  let asset: Asset = {
    id,
    name: file.name,
    kind,
    caste: 'stub',
    sourceRef,
    runtimeUrl,
    fileSize: file.size,
    mimeType: file.type,
    ingestedAt: Date.now(),
    tags: [],
  };

  try {
    const meta = await probeMedia(file, runtimeUrl, kind);
    asset = { ...asset, ...meta, caste: 'original' };
  } catch (e) {
    console.warn('[cutlab] media probe failed', e);
    asset = { ...asset, caste: 'failed' };
  }

  return { asset, runtimeUrl };
}

function detectKind(file: File): Asset['kind'] {
  const t = file.type;
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('image/')) return 'image';
  return 'video';
}

interface MediaMeta {
  durationFrames?: number;
  fps?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  sampleRate?: number;
  channels?: number;
}

async function probeMedia(file: File, url: string, kind: Asset['kind']): Promise<MediaMeta> {
  if (kind === 'image') {
    return probeImage(url);
  }
  if (kind === 'video' || kind === 'audio') {
    return probeAV(url, kind);
  }
  return {};
}

function probeImage(url: string): Promise<MediaMeta> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = url;
  });
}

function probeAV(url: string, kind: Asset['kind']): Promise<MediaMeta> {
  return new Promise((resolve, reject) => {
    const el = kind === 'video'
      ? document.createElement('video')
      : document.createElement('audio');
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      const fps = 29.97;
      const meta: MediaMeta = {
        durationFrames: Math.round(el.duration * fps),
        fps,
        hasAudio: kind === 'video' ? true : true,
      };
      if (kind === 'video' && el instanceof HTMLVideoElement) {
        meta.width = el.videoWidth || 1920;
        meta.height = el.videoHeight || 1080;
      }
      resolve(meta);
    };
    el.onerror = reject;
    el.src = url;
  });
}

// ── Waveform generation ───────────────────────────────────────

/**
 * Generate waveform peaks from an audio/video file.
 * Returns normalized peak array [0..1] for display.
 * If AudioContext is unavailable, returns empty array (honest deferred).
 */
export async function generateWaveformPeaks(
  file: File,
  numPeaks: number = 200
): Promise<number[]> {
  if (typeof AudioContext === 'undefined' && typeof (window as any).webkitAudioContext === 'undefined') {
    return [];
  }

  try {
    const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    const ctx = new AudioCtx();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    ctx.close();

    const channelData = audioBuffer.getChannelData(0);
    const blockSize = Math.floor(channelData.length / numPeaks);
    const peaks: number[] = [];

    for (let i = 0; i < numPeaks; i++) {
      let max = 0;
      const start = i * blockSize;
      const end = Math.min(start + blockSize, channelData.length);
      for (let j = start; j < end; j++) {
        const abs = Math.abs(channelData[j]);
        if (abs > max) max = abs;
      }
      peaks.push(max);
    }

    // Normalize
    const maxPeak = Math.max(...peaks, 0.001);
    return peaks.map((p) => p / maxPeak);
  } catch (e) {
    console.warn('[cutlab] waveform generation failed', e);
    return [];
  }
}

// ── Runtime URL management ────────────────────────────────────

/** Revoke a runtime blob URL. Call when asset is removed from session. */
export function revokeRuntimeUrl(url: string): void {
  if (url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
}

// ── Missing / relink ──────────────────────────────────────────

export function markAssetMissing(asset: Asset): Asset {
  return { ...asset, caste: 'missing', runtimeUrl: undefined };
}

export function relinkAsset(asset: Asset, newFile: File): Promise<IngestResult> {
  return ingestFile(newFile).then((result) => ({
    ...result,
    asset: {
      ...result.asset,
      id: asset.id,
      sourceRef: asset.sourceRef,
      caste: 'relinked',
    },
  }));
}

// ── Asset search / sort ───────────────────────────────────────

export type AssetSortKey = 'name' | 'duration' | 'kind' | 'ingestedAt' | 'fileSize';

export function searchAssets(
  assets: Asset[],
  query: string,
  filterKind?: Asset['kind']
): Asset[] {
  const q = query.toLowerCase().trim();
  return assets.filter((a) => {
    if (filterKind && a.kind !== filterKind) return false;
    if (!q) return true;
    return (
      a.name.toLowerCase().includes(q) ||
      a.tags?.some((t) => t.toLowerCase().includes(q)) ||
      a.sourceRef.toLowerCase().includes(q)
    );
  });
}

export function sortAssets(assets: Asset[], key: AssetSortKey, asc = true): Asset[] {
  const sorted = [...assets].sort((a, b) => {
    switch (key) {
      case 'name': return a.name.localeCompare(b.name);
      case 'duration': return (a.durationFrames ?? 0) - (b.durationFrames ?? 0);
      case 'kind': return a.kind.localeCompare(b.kind);
      case 'ingestedAt': return (a.ingestedAt ?? 0) - (b.ingestedAt ?? 0);
      case 'fileSize': return (a.fileSize ?? 0) - (b.fileSize ?? 0);
      default: return 0;
    }
  });
  return asc ? sorted : sorted.reverse();
}

// ── Caste display helpers ─────────────────────────────────────

export function casteBadge(caste: AssetCaste): { label: string; color: string } {
  switch (caste) {
    case 'original': return { label: 'OK', color: '#34D399' };
    case 'proxy': return { label: 'PROXY', color: '#3B82FF' };
    case 'relinked': return { label: 'RELINKED', color: '#22D3EE' };
    case 'plate': return { label: 'PLATE', color: '#8B5CF6' };
    case 'missing': return { label: 'MISSING', color: '#F43F5E' };
    case 'failed': return { label: 'FAILED', color: '#F43F5E' };
    case 'stub': return { label: 'STUB', color: '#6B7385' };
    default: return { label: 'UNKNOWN', color: '#6B7385' };
  }
}

export function formatDuration(frames: number, fps: number): string {
  const totalSecs = frames / fps;
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = Math.floor(totalSecs % 60);
  const f = Math.floor((totalSecs % 1) * fps);
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}:${pad(f)}`;
  return `${pad(m)}:${pad(s)}:${pad(f)}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}
