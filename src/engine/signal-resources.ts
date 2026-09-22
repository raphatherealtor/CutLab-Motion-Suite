/**
 * CutLab Signal Host Resources
 * Studio-owned signal resource model with deterministic fixtures.
 * Motion consumes normalized immutable signal resources.
 * 
 * Signal categories:
 * - AUDIO: RMS, low, mid, high, spectral centroid, spectral flux, beat, onset, transient, tempo
 * - SPEECH: active word, word progress, phrase progress, speaker, pause/silence, semantic emphasis
 * - TIMELINE: local time, clip progress, cue, marker, section
 * - SUBJECT: bounds, center, matte availability, tracking
 * - DATA: normalized numeric channels
 */

import type { TranscriptWord, SemanticCue, Marker } from './schema';
import { toSeconds } from './time';
import {
  getActiveSpokenWord,
  getWordProgress,
  getPhraseProgress,
  isSpeechPause,
  getWordEmphasis,
} from './semantic-identity';

// ── Signal Channel Definitions ────────────────────────────────

export interface SignalChannelDef {
  id: string;
  category: 'audio' | 'speech' | 'timeline' | 'subject' | 'data';
  label: string;
  description: string;
  unit?: string;
  /** Whether this channel requires real analysis data */
  requiresAnalysis: boolean;
  /** Whether deterministic fixture is available */
  hasFixture: boolean;
}

export const SIGNAL_CHANNEL_REGISTRY: SignalChannelDef[] = [
  // AUDIO
  { id: 'audio.rms', category: 'audio', label: 'Audio RMS', description: 'Overall audio energy level', requiresAnalysis: false, hasFixture: true },
  { id: 'audio.low', category: 'audio', label: 'Bass Energy', description: 'Low frequency band energy (20-250Hz)', requiresAnalysis: false, hasFixture: true },
  { id: 'audio.mid', category: 'audio', label: 'Mid Energy', description: 'Mid frequency band energy (250Hz-4kHz)', requiresAnalysis: false, hasFixture: true },
  { id: 'audio.high', category: 'audio', label: 'Treble Energy', description: 'High frequency band energy (4kHz+)', requiresAnalysis: false, hasFixture: true },
  { id: 'audio.spectral_centroid', category: 'audio', label: 'Spectral Centroid', description: 'Brightness/timbral center of mass', requiresAnalysis: true, hasFixture: true },
  { id: 'audio.spectral_flux', category: 'audio', label: 'Spectral Flux', description: 'Rate of spectral change', requiresAnalysis: true, hasFixture: true },
  { id: 'audio.beat', category: 'audio', label: 'Beat', description: 'Rhythmic beat pulse', requiresAnalysis: false, hasFixture: true },
  { id: 'audio.onset', category: 'audio', label: 'Onset', description: 'Transient onset detection', requiresAnalysis: false, hasFixture: true },
  { id: 'audio.transient', category: 'audio', label: 'Transient', description: 'Sharp transient events', requiresAnalysis: false, hasFixture: true },
  { id: 'audio.tempo', category: 'audio', label: 'Tempo', description: 'Normalized tempo (BPM/200)', requiresAnalysis: false, hasFixture: true },
  // SPEECH
  { id: 'speech.active_word', category: 'speech', label: 'Active Word', description: '1 when a word is being spoken, 0 otherwise', requiresAnalysis: false, hasFixture: true },
  { id: 'speech.word_progress', category: 'speech', label: 'Word Progress', description: 'Progress through current spoken word (0..1)', requiresAnalysis: false, hasFixture: true },
  { id: 'speech.phrase_progress', category: 'speech', label: 'Phrase Progress', description: 'Progress through current phrase (0..1)', requiresAnalysis: false, hasFixture: true },
  { id: 'speech.speaker', category: 'speech', label: 'Speaker Index', description: 'Normalized speaker index (0..1)', requiresAnalysis: false, hasFixture: true },
  { id: 'speech.pause', category: 'speech', label: 'Pause/Silence', description: '1 during speech pauses, 0 during speech', requiresAnalysis: false, hasFixture: true },
  { id: 'speech.emphasis', category: 'speech', label: 'Semantic Emphasis', description: 'Semantic emphasis level at current time', requiresAnalysis: false, hasFixture: true },
  // TIMELINE
  { id: 'timeline.local_time', category: 'timeline', label: 'Local Time', description: 'Normalized clip-local time (0..1)', requiresAnalysis: false, hasFixture: true },
  { id: 'timeline.clip_progress', category: 'timeline', label: 'Clip Progress', description: 'Progress through clip (0..1)', requiresAnalysis: false, hasFixture: true },
  { id: 'timeline.cue', category: 'timeline', label: 'Cue Trigger', description: 'Pulse at cue points', requiresAnalysis: false, hasFixture: true },
  { id: 'timeline.marker', category: 'timeline', label: 'Marker Trigger', description: 'Pulse at marker points', requiresAnalysis: false, hasFixture: true },
  { id: 'timeline.section_energy', category: 'timeline', label: 'Section Energy', description: 'Energy level of current scene section', requiresAnalysis: false, hasFixture: true },
  // SUBJECT
  { id: 'subject.bounds_x', category: 'subject', label: 'Subject X', description: 'Subject horizontal center (0..1)', requiresAnalysis: true, hasFixture: true },
  { id: 'subject.bounds_y', category: 'subject', label: 'Subject Y', description: 'Subject vertical center (0..1)', requiresAnalysis: true, hasFixture: true },
  { id: 'subject.bounds_width', category: 'subject', label: 'Subject Width', description: 'Subject bounding box width (0..1)', requiresAnalysis: true, hasFixture: true },
  { id: 'subject.matte', category: 'subject', label: 'Matte Available', description: '1 when subject matte is available', requiresAnalysis: true, hasFixture: false },
  { id: 'subject.presence', category: 'subject', label: 'Subject Presence', description: 'Subject detection confidence (0..1)', requiresAnalysis: true, hasFixture: true },
  // DATA
  { id: 'data.channel_0', category: 'data', label: 'Data Channel 0', description: 'Normalized numeric data channel', requiresAnalysis: false, hasFixture: true },
  { id: 'data.channel_1', category: 'data', label: 'Data Channel 1', description: 'Normalized numeric data channel', requiresAnalysis: false, hasFixture: true },
];

// ── Signal Mapping (first-class editable) ─────────────────────

export interface SignalMapping {
  id: string;
  /** Source channel ID from SIGNAL_CHANNEL_REGISTRY */
  sourceChannelId: string;
  /** Target property path on the Motion object */
  targetProperty: string;
  /** Target Motion object ID */
  targetObjectId?: string;
  /** Input range normalization */
  inputMin: number;
  inputMax: number;
  /** Output range */
  outputMin: number;
  outputMax: number;
  /** Gain multiplier applied after normalization */
  gain: number;
  /** Offset added after gain */
  offset: number;
  /** Whether to clamp output to [outputMin, outputMax] */
  clamp: boolean;
  /** Whether to invert the signal */
  invert: boolean;
  /** Easing/response curve */
  easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'exponential' | 'logarithmic';
  /** Smoothing factor 0..1 (0 = no smoothing, 1 = max smoothing) */
  smoothing: number;
  /** Threshold — signal must exceed this to have effect */
  threshold: number;
  /** Dead zone — range around zero with no effect */
  deadZone: number;
  /** Trigger mode: 'continuous' | 'gate' | 'trigger' */
  triggerMode: 'continuous' | 'gate' | 'trigger';
  /** Use: 'property-modulation' | 'behavior-parameter' | 'behavior-trigger' */
  use: 'property-modulation' | 'behavior-parameter' | 'behavior-trigger';
  /** Human label */
  label: string;
  enabled: boolean;
}

export function createDefaultSignalMapping(
  sourceChannelId: string,
  targetProperty: string,
  label: string
): SignalMapping {
  return {
    id: `mapping-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sourceChannelId,
    targetProperty,
    inputMin: 0,
    inputMax: 1,
    outputMin: 0,
    outputMax: 1,
    gain: 1,
    offset: 0,
    clamp: true,
    invert: false,
    easing: 'linear',
    smoothing: 0,
    threshold: 0,
    deadZone: 0,
    triggerMode: 'continuous',
    use: 'property-modulation',
    label,
    enabled: true,
  };
}

// ── Apply mapping to a raw signal value ──────────────────────

export function applySignalMapping(mapping: SignalMapping, rawValue: number): number {
  if (!mapping.enabled) return mapping.outputMin;

  // Normalize input
  const inputRange = mapping.inputMax - mapping.inputMin;
  let v = inputRange > 0 ? (rawValue - mapping.inputMin) / inputRange : 0;

  // Dead zone
  if (Math.abs(v - 0.5) < mapping.deadZone / 2) v = 0.5;

  // Threshold
  if (v < mapping.threshold) return mapping.outputMin;

  // Invert
  if (mapping.invert) v = 1 - v;

  // Easing
  v = applyEasing(v, mapping.easing);

  // Gain + offset
  v = v * mapping.gain + mapping.offset;

  // Map to output range
  const outputRange = mapping.outputMax - mapping.outputMin;
  v = mapping.outputMin + v * outputRange;

  // Clamp
  if (mapping.clamp) {
    const lo = Math.min(mapping.outputMin, mapping.outputMax);
    const hi = Math.max(mapping.outputMin, mapping.outputMax);
    v = Math.max(lo, Math.min(hi, v));
  }

  return v;
}

function applyEasing(t: number, easing: SignalMapping['easing']): number {
  switch (easing) {
    case 'ease-in': return t * t;
    case 'ease-out': return 1 - (1 - t) * (1 - t);
    case 'ease-in-out': return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case 'exponential': return t === 0 ? 0 : Math.pow(2, 10 * t - 10);
    case 'logarithmic': return t === 0 ? 0 : Math.log(1 + t * 9) / Math.log(10);
    default: return t;
  }
}

// ── Signal Intersection / Gating ─────────────────────────────

export interface SignalGate {
  id: string;
  label: string;
  /** Primary signal channel */
  primaryChannelId: string;
  /** Gate signal channel — primary is only active when gate exceeds threshold */
  gateChannelId: string;
  /** Gate threshold */
  gateThreshold: number;
  /** Gate mode: 'and' = both active, 'not' = primary active when gate inactive */
  gateMode: 'and' | 'not' | 'multiply' | 'min' | 'max';
  /** Output mapping */
  outputMapping: Omit<SignalMapping, 'id' | 'label'>;
}

export function evaluateSignalGate(
  gate: SignalGate,
  primaryValue: number,
  gateValue: number
): number {
  let gateActive: boolean;
  let result: number;

  switch (gate.gateMode) {
    case 'and':
      gateActive = gateValue >= gate.gateThreshold;
      result = gateActive ? primaryValue : 0;
      break;
    case 'not':
      gateActive = gateValue < gate.gateThreshold;
      result = gateActive ? primaryValue : 0;
      break;
    case 'multiply':
      result = primaryValue * gateValue;
      break;
    case 'min':
      result = Math.min(primaryValue, gateValue);
      break;
    case 'max':
      result = Math.max(primaryValue, gateValue);
      break;
    default:
      result = primaryValue;
  }

  return result;
}

// ── Preset signal gates ───────────────────────────────────────

export const PRESET_SIGNAL_GATES: Omit<SignalGate, 'id'>[] = [
  {
    label: 'Onset × Emphasis',
    primaryChannelId: 'audio.onset',
    gateChannelId: 'speech.emphasis',
    gateThreshold: 0.5,
    gateMode: 'and',
    outputMapping: { sourceChannelId: 'audio.onset', targetProperty: 'scale.uniform', inputMin: 0, inputMax: 1, outputMin: 1, outputMax: 1.4, gain: 1, offset: 0, clamp: true, invert: false, easing: 'ease-out', smoothing: 0, threshold: 0, deadZone: 0, triggerMode: 'trigger', use: 'property-modulation', enabled: true },
  },
  {
    label: 'Active Word × Low Energy',
    primaryChannelId: 'speech.active_word',
    gateChannelId: 'audio.low',
    gateThreshold: 0.3,
    gateMode: 'multiply',
    outputMapping: { sourceChannelId: 'speech.active_word', targetProperty: 'position.z', inputMin: 0, inputMax: 1, outputMin: 0, outputMax: 120, gain: 1, offset: 0, clamp: true, invert: false, easing: 'ease-out', smoothing: 0.3, threshold: 0, deadZone: 0, triggerMode: 'continuous', use: 'property-modulation', enabled: true },
  },
  {
    label: 'Pause × Clip Progress',
    primaryChannelId: 'speech.pause',
    gateChannelId: 'timeline.clip_progress',
    gateThreshold: 0.1,
    gateMode: 'and',
    outputMapping: { sourceChannelId: 'speech.pause', targetProperty: 'opacity', inputMin: 0, inputMax: 1, outputMin: 0.7, outputMax: 1, gain: 1, offset: 0, clamp: true, invert: false, easing: 'ease-in-out', smoothing: 0.5, threshold: 0, deadZone: 0, triggerMode: 'continuous', use: 'property-modulation', enabled: true },
  },
  {
    label: 'Speaker × Emphasis',
    primaryChannelId: 'speech.speaker',
    gateChannelId: 'speech.emphasis',
    gateThreshold: 0.5,
    gateMode: 'and',
    outputMapping: { sourceChannelId: 'speech.speaker', targetProperty: 'material.color', inputMin: 0, inputMax: 1, outputMin: 0, outputMax: 1, gain: 1, offset: 0, clamp: true, invert: false, easing: 'linear', smoothing: 0.2, threshold: 0, deadZone: 0, triggerMode: 'continuous', use: 'property-modulation', enabled: true },
  },
  {
    label: 'Beat × Section Energy',
    primaryChannelId: 'audio.beat',
    gateChannelId: 'timeline.section_energy',
    gateThreshold: 0.5,
    gateMode: 'multiply',
    outputMapping: { sourceChannelId: 'audio.beat', targetProperty: 'scale.uniform', inputMin: 0, inputMax: 1, outputMin: 1, outputMax: 1.2, gain: 1, offset: 0, clamp: true, invert: false, easing: 'ease-out', smoothing: 0, threshold: 0, deadZone: 0, triggerMode: 'trigger', use: 'property-modulation', enabled: true },
  },
];

// ── Signal Host Resource Evaluator ───────────────────────────

export interface SignalHostContext {
  timeSecs: number;
  clipDurationSecs: number;
  words?: TranscriptWord[];
  cues?: SemanticCue[];
  markers?: Marker[];
  speakers?: string[];
  /** Audio analysis data if available */
  audioRms?: number;
  audioLow?: number;
  audioMid?: number;
  audioHigh?: number;
  audioBeat?: number;
  audioOnset?: number;
  audioTransient?: number;
  audioTempo?: number;
  /** Subject data if available */
  subjectBoundsX?: number;
  subjectBoundsY?: number;
  subjectBoundsWidth?: number;
  subjectPresence?: number;
  /** Scene section energy */
  sectionEnergy?: number;
}

export function evaluateSignalChannel(
  channelId: string,
  ctx: SignalHostContext
): number {
  const t = ctx.timeSecs;
  const dur = ctx.clipDurationSecs;

  switch (channelId) {
    // AUDIO
    case 'audio.rms':
      return ctx.audioRms ?? generateDeterministicSignal(t, 'rms');
    case 'audio.low':
      return ctx.audioLow ?? generateDeterministicSignal(t, 'low');
    case 'audio.mid':
      return ctx.audioMid ?? generateDeterministicSignal(t, 'mid');
    case 'audio.high':
      return ctx.audioHigh ?? generateDeterministicSignal(t, 'high');
    case 'audio.spectral_centroid':
      return generateDeterministicSignal(t, 'spectral_centroid');
    case 'audio.spectral_flux':
      return generateDeterministicSignal(t, 'spectral_flux');
    case 'audio.beat':
      return ctx.audioBeat ?? generateBeatSignal(t, 120);
    case 'audio.onset':
      return ctx.audioOnset ?? 0;
    case 'audio.transient':
      return ctx.audioTransient ?? 0;
    case 'audio.tempo':
      return ctx.audioTempo ? ctx.audioTempo / 200 : 0.6;

    // SPEECH
    case 'speech.active_word': {
      if (!ctx.words) return generateDeterministicSignal(t, 'speech');
      const active = getActiveSpokenWord(ctx.words, t);
      return active ? 1 : 0;
    }
    case 'speech.word_progress': {
      if (!ctx.words) return (t % 0.5) / 0.5;
      const active = getActiveSpokenWord(ctx.words, t);
      return active ? getWordProgress(active, t) : 0;
    }
    case 'speech.phrase_progress': {
      if (!ctx.words) return (t % 2) / 2;
      // Find current phrase (words within 0.8s gap)
      const sorted = [...ctx.words].sort((a, b) => toSeconds(a.startTime) - toSeconds(b.startTime));
      const currentWord = getActiveSpokenWord(sorted, t);
      if (!currentWord) return 0;
      // Find phrase boundaries
      const phraseWords: TranscriptWord[] = [currentWord];
      const idx = sorted.indexOf(currentWord);
      for (let i = idx - 1; i >= 0; i--) {
        const gap = toSeconds(sorted[i + 1].startTime) - toSeconds(sorted[i].endTime);
        if (gap > 0.8 || sorted[i].speaker !== currentWord.speaker) break;
        phraseWords.unshift(sorted[i]);
      }
      for (let i = idx + 1; i < sorted.length; i++) {
        const gap = toSeconds(sorted[i].startTime) - toSeconds(sorted[i - 1].endTime);
        if (gap > 0.8 || sorted[i].speaker !== currentWord.speaker) break;
        phraseWords.push(sorted[i]);
      }
      return getPhraseProgress(sorted, phraseWords.map((w) => w.id), t);
    }
    case 'speech.speaker': {
      if (!ctx.words || !ctx.speakers || ctx.speakers.length === 0) return 0;
      const active = getActiveSpokenWord(ctx.words, t);
      if (!active?.speaker) return 0;
      const idx = ctx.speakers.indexOf(active.speaker);
      return idx >= 0 ? idx / Math.max(1, ctx.speakers.length - 1) : 0;
    }
    case 'speech.pause': {
      if (!ctx.words) return 0;
      return isSpeechPause(ctx.words, t) ? 1 : 0;
    }
    case 'speech.emphasis': {
      if (!ctx.words) return 0;
      const active = getActiveSpokenWord(ctx.words, t);
      if (!active) return 0;
      return getWordEmphasis(active, ctx.cues);
    }

    // TIMELINE
    case 'timeline.local_time':
      return dur > 0 ? Math.max(0, Math.min(1, t / dur)) : 0;
    case 'timeline.clip_progress':
      return dur > 0 ? Math.max(0, Math.min(1, t / dur)) : 0;
    case 'timeline.cue': {
      if (!ctx.cues) return 0;
      const nearCue = ctx.cues.some((c) => Math.abs(toSeconds(c.timeRange.start) - t) < 0.05);
      return nearCue ? 1 : 0;
    }
    case 'timeline.marker': {
      if (!ctx.markers) return 0;
      const nearMarker = ctx.markers.some((m) => Math.abs(toSeconds(m.time) - t) < 0.05);
      return nearMarker ? 1 : 0;
    }
    case 'timeline.section_energy':
      return ctx.sectionEnergy ?? generateDeterministicSignal(t, 'section');

    // SUBJECT
    case 'subject.bounds_x':
      return ctx.subjectBoundsX ?? 0.5;
    case 'subject.bounds_y':
      return ctx.subjectBoundsY ?? 0.5;
    case 'subject.bounds_width':
      return ctx.subjectBoundsWidth ?? 0.3;
    case 'subject.matte':
      return 0; // Not available without real analysis
    case 'subject.presence':
      return ctx.subjectPresence ?? 0;

    // DATA
    case 'data.channel_0':
      return generateDeterministicSignal(t, 'data0');
    case 'data.channel_1':
      return generateDeterministicSignal(t, 'data1');

    default:
      return 0;
  }
}

// ── Deterministic fixture generators ─────────────────────────

function generateDeterministicSignal(timeSecs: number, seed: string): number {
  const seedHash = seed.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const freq1 = 0.5 + (seedHash % 7) * 0.3;
  const freq2 = 1.2 + (seedHash % 5) * 0.4;
  const phase = (seedHash % 100) / 100;
  let v = (Math.sin(timeSecs * freq1 * Math.PI * 2 + phase) + 1) / 2 * 0.6
    + (Math.sin(timeSecs * freq2 * Math.PI * 2) + 1) / 2 * 0.4;
  return Math.max(0, Math.min(1, v));
}

function generateBeatSignal(timeSecs: number, bpm: number): number {
  const beatInterval = 60 / bpm;
  const phase = timeSecs % beatInterval;
  return phase < 0.05 ? 1 - phase / 0.05 : 0;
}

// ── Evaluate all signal channels for a context ───────────────

export function evaluateAllSignals(ctx: SignalHostContext): Record<string, number> {
  let result: Record<string, number> = {};
  for (const channel of SIGNAL_CHANNEL_REGISTRY) {
    result[channel.id] = evaluateSignalChannel(channel.id, ctx);
  }
  return result;
}
