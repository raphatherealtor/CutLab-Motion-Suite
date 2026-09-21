/**
 * CutLab Motion Signal Engine
 * Manages signal sources and provides values to the Motion evaluator.
 * Studio owns analysis resources. Motion consumes them as immutable signals.
 */

import type { MotionSignal } from './types';

// ── Signal Value Provider ─────────────────────────────────────

export interface SignalValueProvider {
  /** Get the signal value at a given time in seconds */
  getValue(timeSecs: number): number;
  /** Get a batch of values for a time range */
  getValues(startSecs: number, endSecs: number, count: number): number[];
}

// ── Audio Analysis Resource ───────────────────────────────────

export interface AudioAnalysisResource {
  assetId: string;
  sampleRate: number;
  /** RMS energy per frame */
  rms?: Float32Array;
  /** Low frequency energy per frame */
  lowEnergy?: Float32Array;
  /** Mid frequency energy per frame */
  midEnergy?: Float32Array;
  /** High frequency energy per frame */
  highEnergy?: Float32Array;
  /** Beat positions in seconds */
  beats?: number[];
  /** Onset positions in seconds */
  onsets?: number[];
  /** Transient positions in seconds */
  transients?: number[];
  /** Tempo in BPM */
  tempo?: number;
  /** Frame duration in seconds */
  frameDuration: number;
}

// ── Subject Analysis Resource ─────────────────────────────────

export interface SubjectAnalysisResource {
  assetId: string;
  fps: number;
  /** Per-frame bounding boxes [x, y, width, height] normalized 0..1 */
  bounds?: Array<[number, number, number, number]>;
  /** Per-frame matte availability */
  hasMatte?: boolean[];
  /** Per-frame tracking confidence */
  confidence?: number[];
}

// ── Signal Engine ─────────────────────────────────────────────

export class SignalEngine {
  private audioResources = new Map<string, AudioAnalysisResource>();
  private subjectResources = new Map<string, SubjectAnalysisResource>();
  private manualSignals = new Map<string, number>();

  // ── Resource registration ──────────────────────────────────

  registerAudioResource(resource: AudioAnalysisResource): void {
    this.audioResources.set(resource.assetId, resource);
  }

  registerSubjectResource(resource: SubjectAnalysisResource): void {
    this.subjectResources.set(resource.assetId, resource);
  }

  setManualSignal(signalId: string, value: number): void {
    this.manualSignals.set(signalId, Math.max(0, Math.min(1, value)));
  }

  // ── Signal evaluation ──────────────────────────────────────

  /**
   * Evaluate all signals for a MotionDocument at a given time.
   * Returns a map of signalId → normalized value [0..1].
   */
  evaluateSignals(
    signals: Record<string, MotionSignal>,
    timeSecs: number
  ): Record<string, number> {
    const values: Record<string, number> = {};

    for (const [id, signal] of Object.entries(signals)) {
      values[id] = this.evaluateSignal(signal, timeSecs);
    }

    return values;
  }

  evaluateSignal(signal: MotionSignal, timeSecs: number): number {
    // Use sample data if available (deterministic testing)
    if (signal.sampleData && signal.sampleData.length > 0) {
      return this.sampleFromArray(signal.sampleData, timeSecs);
    }

    switch (signal.kind) {
      case 'audio-rms':
        return this.getAudioRMS(signal.sourceRef, timeSecs);
      case 'audio-low':
        return this.getAudioBand(signal.sourceRef, timeSecs, 'low');
      case 'audio-mid':
        return this.getAudioBand(signal.sourceRef, timeSecs, 'mid');
      case 'audio-high':
        return this.getAudioBand(signal.sourceRef, timeSecs, 'high');
      case 'audio-beat':
        return this.getAudioBeat(signal.sourceRef, timeSecs);
      case 'audio-onset':
        return this.getAudioOnset(signal.sourceRef, timeSecs);
      case 'audio-transient':
        return this.getAudioTransient(signal.sourceRef, timeSecs);
      case 'manual':
        return this.manualSignals.get(signal.id) ?? 0;
      case 'subject-bounds':
        return this.getSubjectBoundsSignal(signal.sourceRef, timeSecs);
      default:
        return 0;
    }
  }

  // ── Audio signal helpers ───────────────────────────────────

  private getAudioRMS(assetId: string | undefined, timeSecs: number): number {
    if (!assetId) return this.generateDeterministicSignal(timeSecs, 'rms');
    const resource = this.audioResources.get(assetId);
    if (!resource?.rms) return this.generateDeterministicSignal(timeSecs, 'rms');
    const frameIdx = Math.floor(timeSecs / resource.frameDuration);
    const value = resource.rms[Math.min(frameIdx, resource.rms.length - 1)] ?? 0;
    return this.normalize(value, 0, 1);
  }

  private getAudioBand(assetId: string | undefined, timeSecs: number, band: 'low' | 'mid' | 'high'): number {
    if (!assetId) return this.generateDeterministicSignal(timeSecs, band);
    const resource = this.audioResources.get(assetId);
    const data = band === 'low' ? resource?.lowEnergy : band === 'mid' ? resource?.midEnergy : resource?.highEnergy;
    if (!data) return this.generateDeterministicSignal(timeSecs, band);
    const frameIdx = Math.floor(timeSecs / (resource?.frameDuration ?? 0.023));
    return this.normalize(data[Math.min(frameIdx, data.length - 1)] ?? 0, 0, 1);
  }

  private getAudioBeat(assetId: string | undefined, timeSecs: number): number {
    if (!assetId) return this.generateBeatSignal(timeSecs, 120);
    const resource = this.audioResources.get(assetId);
    if (!resource?.beats) return this.generateBeatSignal(timeSecs, resource?.tempo ?? 120);
    // Return 1 if within 50ms of a beat
    const nearBeat = resource.beats.some((b) => Math.abs(b - timeSecs) < 0.05);
    return nearBeat ? 1 : 0;
  }

  private getAudioOnset(assetId: string | undefined, timeSecs: number): number {
    if (!assetId) return 0;
    const resource = this.audioResources.get(assetId);
    if (!resource?.onsets) return 0;
    const nearOnset = resource.onsets.some((o) => Math.abs(o - timeSecs) < 0.03);
    return nearOnset ? 1 : 0;
  }

  private getAudioTransient(assetId: string | undefined, timeSecs: number): number {
    if (!assetId) return 0;
    const resource = this.audioResources.get(assetId);
    if (!resource?.transients) return 0;
    const nearTransient = resource.transients.some((t) => Math.abs(t - timeSecs) < 0.02);
    return nearTransient ? 1 : 0;
  }

  private getSubjectBoundsSignal(assetId: string | undefined, timeSecs: number): number {
    if (!assetId) return 0.5;
    const resource = this.subjectResources.get(assetId);
    if (!resource?.bounds) return 0.5;
    const frameIdx = Math.floor(timeSecs * resource.fps);
    const bounds = resource.bounds[Math.min(frameIdx, resource.bounds.length - 1)];
    if (!bounds) return 0.5;
    // Return center X as signal
    return bounds[0] + bounds[2] / 2;
  }

  // ── Deterministic sample generators (for testing) ──────────

  private generateDeterministicSignal(timeSecs: number, seed: string): number {
    // Deterministic pseudo-random signal based on time and seed
    const seedHash = seed.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const freq1 = 0.5 + (seedHash % 7) * 0.3;
    const freq2 = 1.2 + (seedHash % 5) * 0.4;
    const phase = (seedHash % 100) / 100;
    const v = (Math.sin(timeSecs * freq1 * Math.PI * 2 + phase) + 1) / 2 * 0.6
      + (Math.sin(timeSecs * freq2 * Math.PI * 2) + 1) / 2 * 0.4;
    return Math.max(0, Math.min(1, v));
  }

  private generateBeatSignal(timeSecs: number, bpm: number): number {
    const beatInterval = 60 / bpm;
    const phase = timeSecs % beatInterval;
    // Sharp attack, fast decay
    return phase < 0.05 ? 1 - phase / 0.05 : 0;
  }

  private sampleFromArray(data: number[], timeSecs: number): number {
    // Assume data covers 0..N seconds at 1 sample/second
    const idx = Math.floor(timeSecs);
    if (idx < 0 || idx >= data.length) return 0;
    // Linear interpolation
    const frac = timeSecs - idx;
    const v0 = data[idx];
    const v1 = data[Math.min(idx + 1, data.length - 1)];
    return v0 + (v1 - v0) * frac;
  }

  private normalize(value: number, min: number, max: number): number {
    if (max <= min) return 0;
    return Math.max(0, Math.min(1, (value - min) / (max - min)));
  }
}

// ── Audio Bridge Seam ─────────────────────────────────────────

/**
 * AudioBridgeSeam — connects Studio audio analysis to Motion signals.
 * Studio owns the analysis. Motion consumes it as immutable resources.
 */
export class AudioBridgeSeam {
  private engine: SignalEngine;

  constructor(engine: SignalEngine) {
    this.engine = engine;
  }

  /**
   * Ingest Studio audio analysis into the signal engine.
   * Called when Studio completes audio analysis for an asset.
   */
  ingestAudioAnalysis(resource: AudioAnalysisResource): void {
    this.engine.registerAudioResource(resource);
  }

  /**
   * Create deterministic sample fixtures for testing.
   * Generates realistic-looking audio analysis data.
   */
  createSampleFixtures(assetId: string, durationSecs: number): AudioAnalysisResource {
    const frameDuration = 0.023; // ~23ms frames
    const frameCount = Math.ceil(durationSecs / frameDuration);
    const sampleRate = 44100;

    const rms = new Float32Array(frameCount);
    const lowEnergy = new Float32Array(frameCount);
    const midEnergy = new Float32Array(frameCount);
    const highEnergy = new Float32Array(frameCount);
    const beats: number[] = [];
    const onsets: number[] = [];
    const transients: number[] = [];

    // Generate deterministic fixture data
    for (let i = 0; i < frameCount; i++) {
      let t = i * frameDuration;
      rms[i] = 0.3 + 0.4 * Math.abs(Math.sin(t * 1.5)) + 0.1 * Math.abs(Math.sin(t * 7.3));
      lowEnergy[i] = 0.4 + 0.4 * Math.abs(Math.sin(t * 0.8));
      midEnergy[i] = 0.3 + 0.5 * Math.abs(Math.sin(t * 2.1));
      highEnergy[i] = 0.2 + 0.3 * Math.abs(Math.sin(t * 4.7));
    }

    // Generate beats at 120 BPM
    const beatInterval = 60 / 120;
    for (let t = 0; t < durationSecs; t += beatInterval) {
      beats.push(t);
    }

    // Generate onsets
    for (let t = 0.1; t < durationSecs; t += 0.4 + Math.sin(t) * 0.1) {
      onsets.push(t);
    }

    const resource: AudioAnalysisResource = {
      assetId,
      sampleRate,
      rms,
      lowEnergy,
      midEnergy,
      highEnergy,
      beats,
      onsets,
      transients,
      tempo: 120,
      frameDuration,
    };

    this.engine.registerAudioResource(resource);
    return resource;
  }
}
