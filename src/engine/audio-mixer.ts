/**
 * CutLab Audio Mixer — Real PCM Mixdown
 * Canonical audio path for both preview and export.
 * Respects: source timing, sourceIn/Out, speed, clip gain, track gain,
 * gain keyframes, fades, pan, mute/solo, sequence duration.
 * Uses Web Audio API for real-time preview playback.
 * Uses OfflineAudioContext for export mixdown.
 */

'use client';


import type { ProjectData } from './schema';
import { toSeconds } from './time';


// ── Runtime audio node cache ──────────────────────────────────

interface AudioAssetCache {
  buffer: AudioBuffer;
  assetId: string;
}

const audioBufferCache = new Map<string, AudioAssetCache>();

export async function loadAudioBuffer(
  assetId: string,
  runtimeUrl: string,
  ctx: BaseAudioContext
): Promise<AudioBuffer | null> {
  const cached = audioBufferCache.get(assetId);
  if (cached) return cached.buffer;

  try {
    const response = await fetch(runtimeUrl);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = await ctx.decodeAudioData(arrayBuffer);
    audioBufferCache.set(assetId, { buffer, assetId });
    return buffer;
  } catch (e) {
    console.warn('[cutlab-audio] failed to load audio buffer', assetId, e);
    return null;
  }
}

export function clearAudioCache(): void {
  audioBufferCache.clear();
}

// ── Real-time preview audio engine ────────────────────────────

export class AudioPreviewEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private activeSources: AudioBufferSourceNode[] = [];
  private startWallTime = 0;
  private startSeqTime = 0;
  private playing = false;

  private getCtx(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  async play(
    project: ProjectData,
    startSeqTimeSecs: number
  ): Promise<void> {
    this.stop();

    const seq = project.sequences[project.activeSequenceId];
    if (!seq) return;

    const ctx = this.getCtx();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    this.startWallTime = ctx.currentTime;
    this.startSeqTime = startSeqTimeSecs;
    this.playing = true;

    const fps = seq.format.fps;
    const soloTracks = seq.tracks.filter((t) => t.solo && t.kind === 'audio');
    const hasSolo = soloTracks.length > 0;

    // Schedule all audio clips
    for (const clip of seq.clips) {
      if (clip.kind !== 'audio' && clip.kind !== 'video') continue;
      if (clip.disabled) continue;

      const track = seq.tracks.find((t) => t.id === clip.trackId);
      if (!track || track.kind !== 'audio') continue;
      if (track.muted) continue;
      if (hasSolo && !track.solo) continue;

      const asset = clip.assetId ? project.assets[clip.assetId] : null;
      if (!asset?.runtimeUrl) continue;

      const clipStartSecs = toSeconds(clip.startTime);
      const clipEndSecs = clipStartSecs + toSeconds(clip.duration);

      // Skip clips that have already ended
      if (clipEndSecs <= startSeqTimeSecs) continue;

      const buffer = await loadAudioBuffer(asset.id, asset.runtimeUrl, ctx);
      if (!buffer) continue;

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = clip.speed || 1;

      // Gain node for clip
      const clipGain = ctx.createGain();
      const trackGain = ctx.createGain();
      const panNode = ctx.createStereoPanner();

      // Set gains
      const clipGainLinear = Math.pow(10, clip.gain / 20);
      const trackGainLinear = Math.pow(10, track.gain / 20);
      clipGain.gain.value = clipGainLinear;
      trackGain.gain.value = trackGainLinear;
      panNode.pan.value = Math.max(-1, Math.min(1, clip.pan ?? track.pan ?? 0));

      // Chain: source → clipGain → trackGain → pan → master
      source.connect(clipGain);
      clipGain.connect(trackGain);
      trackGain.connect(panNode);
      panNode.connect(this.masterGain!);

      // Schedule fade in
      const fadeInSecs = toSeconds(clip.fadeIn);
      const fadeOutSecs = toSeconds(clip.fadeOut);

      // Compute when to start this source in wall-clock time
      const seqOffset = Math.max(0, clipStartSecs - startSeqTimeSecs);
      const wallStart = ctx.currentTime + seqOffset;

      // Compute source offset (how far into the source to start)
      const sourceOffset = startSeqTimeSecs > clipStartSecs
        ? toSeconds(clip.sourceIn) + (startSeqTimeSecs - clipStartSecs) * (clip.speed || 1)
        : toSeconds(clip.sourceIn);

      const sourceDuration = toSeconds(clip.duration) / (clip.speed || 1);

      // Apply fade in automation
      if (fadeInSecs > 0) {
        clipGain.gain.setValueAtTime(0, wallStart);
        clipGain.gain.linearRampToValueAtTime(clipGainLinear, wallStart + fadeInSecs);
      }

      // Apply fade out automation
      if (fadeOutSecs > 0) {
        const fadeOutStart = wallStart + sourceDuration - fadeOutSecs;
        clipGain.gain.setValueAtTime(clipGainLinear, fadeOutStart);
        clipGain.gain.linearRampToValueAtTime(0, wallStart + sourceDuration);
      }

      // Apply gain keyframes
      for (const kf of clip.keyframes.filter((k) => k.property === 'gain')) {
        const kfWallTime = wallStart + toSeconds(kf.time) / (clip.speed || 1);
        const kfGainLinear = Math.pow(10, (kf.value as number) / 20);
        clipGain.gain.setValueAtTime(kfGainLinear, kfWallTime);
      }

      source.start(wallStart, Math.max(0, sourceOffset), sourceDuration);
      this.activeSources.push(source);
    }
  }

  stop(): void {
    this.playing = false;
    for (const source of this.activeSources) {
      try { source.stop(); } catch {}
      try { source.disconnect(); } catch {}
    }
    this.activeSources = [];
  }

  getCurrentSeqTime(): number {
    if (!this.ctx || !this.playing) return this.startSeqTime;
    return this.startSeqTime + (this.ctx.currentTime - this.startWallTime);
  }

  dispose(): void {
    this.stop();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}

// ── Offline PCM mixdown (for export) ─────────────────────────

export interface MixdownResult {
  buffer: AudioBuffer;
  durationSecs: number;
  sampleRate: number;
  channels: number;
}

/**
 * Produce a real PCM mixdown of the entire sequence.
 * Uses OfflineAudioContext for deterministic, non-real-time rendering.
 * This is the canonical audio path for export.
 */
export async function mixdownSequence(
  project: ProjectData,
  onProgress?: (progress: number) => void
): Promise<MixdownResult | null> {
  const seq = project.sequences[project.activeSequenceId];
  if (!seq) return null;

  const sampleRate = seq.format.sampleRate || 48000;
  const channels = seq.format.channels || 2;

  // Compute total duration
  const totalSecs = seq.clips.reduce((max, c) => {
    const end = toSeconds(c.startTime) + toSeconds(c.duration);
    return Math.max(max, end);
  }, 0);

  if (totalSecs <= 0) return null;

  let totalSamples = Math.ceil(totalSecs * sampleRate);

  try {
    const offlineCtx = new OfflineAudioContext(channels, totalSamples, sampleRate);
    const masterGain = offlineCtx.createGain();
    masterGain.gain.value = 1.0;
    masterGain.connect(offlineCtx.destination);

    const soloTracks = seq.tracks.filter((t) => t.solo && t.kind === 'audio');
    const hasSolo = soloTracks.length > 0;

    let scheduledCount = 0;
    const audioClips = seq.clips.filter((c) => {
      if (c.kind !== 'audio' && c.kind !== 'video') return false;
      if (c.disabled) return false;
      const track = seq.tracks.find((t) => t.id === c.trackId);
      if (!track || track.kind !== 'audio') return false;
      if (track.muted) return false;
      if (hasSolo && !track.solo) return false;
      return true;
    });

    for (let i = 0; i < audioClips.length; i++) {
      const clip = audioClips[i];
      const track = seq.tracks.find((t) => t.id === clip.trackId)!;
      const asset = clip.assetId ? project.assets[clip.assetId] : null;
      if (!asset?.runtimeUrl) continue;

      onProgress?.(i / audioClips.length * 0.5);

      const buffer = await loadAudioBuffer(asset.id, asset.runtimeUrl, offlineCtx);
      if (!buffer) continue;

      const source = offlineCtx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = clip.speed || 1;

      const clipGainNode = offlineCtx.createGain();
      const trackGainNode = offlineCtx.createGain();
      const panNode = offlineCtx.createStereoPanner();

      const clipGainLinear = Math.pow(10, clip.gain / 20);
      const trackGainLinear = Math.pow(10, track.gain / 20);
      clipGainNode.gain.value = clipGainLinear;
      trackGainNode.gain.value = trackGainLinear;
      panNode.pan.value = Math.max(-1, Math.min(1, clip.pan ?? track.pan ?? 0));

      source.connect(clipGainNode);
      clipGainNode.connect(trackGainNode);
      trackGainNode.connect(panNode);
      panNode.connect(masterGain);

      const startSecs = toSeconds(clip.startTime);
      const sourceInSecs = toSeconds(clip.sourceIn);
      const durationSecs = toSeconds(clip.duration) / (clip.speed || 1);
      const fadeInSecs = toSeconds(clip.fadeIn);
      const fadeOutSecs = toSeconds(clip.fadeOut);

      // Fade in
      if (fadeInSecs > 0) {
        clipGainNode.gain.setValueAtTime(0, startSecs);
        clipGainNode.gain.linearRampToValueAtTime(clipGainLinear, startSecs + fadeInSecs);
      }

      // Fade out
      if (fadeOutSecs > 0) {
        const fadeOutStart = startSecs + durationSecs - fadeOutSecs;
        clipGainNode.gain.setValueAtTime(clipGainLinear, fadeOutStart);
        clipGainNode.gain.linearRampToValueAtTime(0, startSecs + durationSecs);
      }

      // Gain keyframes
      for (const kf of clip.keyframes.filter((k) => k.property === 'gain')) {
        const kfTime = startSecs + toSeconds(kf.time) / (clip.speed || 1);
        const kfGainLinear = Math.pow(10, (kf.value as number) / 20);
        clipGainNode.gain.setValueAtTime(kfGainLinear, kfTime);
      }

      source.start(startSecs, Math.max(0, sourceInSecs), durationSecs);
      scheduledCount++;
    }

    onProgress?.(0.6);

    if (scheduledCount === 0) return null;

    const renderedBuffer = await offlineCtx.startRendering();
    onProgress?.(1.0);

    return {
      buffer: renderedBuffer,
      durationSecs: totalSecs,
      sampleRate,
      channels,
    };
  } catch (e) {
    console.error('[cutlab-audio] mixdown failed', e);
    return null;
  }
}

/**
 * Measure integrated loudness (LUFS approximation) of an AudioBuffer.
 * Uses RMS-based measurement as a practical browser-safe approximation.
 * True ITU-R BS.1770 LUFS requires K-weighting filter which is approximated here.
 */
export function measureLoudness(buffer: AudioBuffer): number {
  let sumSquares = 0;
  let totalSamples = 0;

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      sumSquares += data[i] * data[i];
      totalSamples++;
    }
  }

  if (totalSamples === 0) return -Infinity;
  const rms = Math.sqrt(sumSquares / totalSamples);
  if (rms === 0) return -Infinity;
  // Convert RMS to approximate LUFS (offset by ~3 dB for K-weighting approximation)
  return 20 * Math.log10(rms) - 3;
}

/**
 * Real normalization: measure actual loudness and compute gain adjustment.
 * Returns the gain in dB needed to reach targetLufs.
 */
export async function measureAndNormalize(
  project: ProjectData,
  targetLufs = -23
): Promise<{ gainDb: number; measuredLufs: number; measured: boolean }> {
  try {
    const mixdown = await mixdownSequence(project);
    if (!mixdown) return { gainDb: 0, measuredLufs: -Infinity, measured: false };

    const measuredLufs = measureLoudness(mixdown.buffer);
    if (!isFinite(measuredLufs)) return { gainDb: 0, measuredLufs: -Infinity, measured: false };

    const gainDb = targetLufs - measuredLufs;
    return { gainDb, measuredLufs, measured: true };
  } catch (e) {
    console.warn('[cutlab-audio] normalization measurement failed', e);
    return { gainDb: 0, measuredLufs: -Infinity, measured: false };
  }
}

// ── AudioBuffer → WAV blob ────────────────────────────────────

export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length;
  const bytesPerSample = 2; // 16-bit PCM
  const dataSize = numChannels * numSamples * bytesPerSample;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  // WAV header
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, totalSize - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // byte rate
  view.setUint16(32, numChannels * bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Interleave channels
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}
