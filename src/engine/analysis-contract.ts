/**
 * CutLab Studio Analysis Contract — Convergence Layer
 *
 * Studio owns immutable analysis resources:
 * - transcript / speech timing
 * - audio analysis (RMS, beat, onset, etc.)
 * - subject tracking / matte
 * - cues / markers
 * - data channels
 *
 * Motion consumes these through this contract.
 *
 * Both Studio and Motion Animator see the same resource availability.
 * This is the ONE analysis truth — no separate analysis in Motion Animator.
 *
 * Usage:
 *   const contract = buildAnalysisContract(project, sequence, playheadFrame);
 *   // Pass to Motion evaluator via signal values
 *   const signalValues = contractToSignalValues(contract);
 */

import type { ProjectData, Sequence, TranscriptWord } from './schema';
import { toSeconds } from './time';

// ── Analysis Resource Availability ───────────────────────────

export interface AnalysisResourceAvailability {
  hasTranscript: boolean;
  hasAudioAnalysis: boolean;
  /** Whether audio analysis is real (true) or deterministic fixture (false) */
  audioAnalysisIsReal: boolean;
  hasSubjectTracking: boolean;
  hasBeatData: boolean;
  /** Whether beat data is real (true) or deterministic fixture (false) */
  beatDataIsReal: boolean;
  hasOnsetData: boolean;
  hasSpeakerData: boolean;
  hasCues: boolean;
  hasMarkers: boolean;
  transcriptWordCount: number;
  speakerCount: number;
  cueCount: number;
  markerCount: number;
}

// ── Speech Context ────────────────────────────────────────────

export interface SpeechContext {
  /** Active word at current playhead */
  activeWord: TranscriptWord | null;
  /** Active word progress (0..1) */
  activeWordProgress: number;
  /** Active speaker */
  activeSpeaker: string | null;
  /** Is currently in a speech pause? */
  isSpeechPause: boolean;
  /** Phrase progress (0..1) within current speaker segment */
  phraseProgress: number;
  /** Words in current phrase */
  phraseWords: TranscriptWord[];
  /** Semantic emphasis score for active word (0..1) */
  emphasisScore: number;
  /** Clip progress (0..1) */
  clipProgress: number;
}

// ── Audio Context ─────────────────────────────────────────────

export interface AudioContext {
  /** Normalized RMS (0..1) — deterministic fixture when real data unavailable */
  rms: number;
  /** Low frequency energy (0..1) */
  low: number;
  /** Mid frequency energy (0..1) */
  mid: number;
  /** High frequency energy (0..1) */
  high: number;
  /** Beat pulse (0..1) */
  beat: number;
  /** Onset impulse (0..1) */
  onset: number;
  /** Transient (0..1) */
  transient: number;
  /** Estimated tempo (BPM) */
  tempo: number;
  /** Spectral centroid (0..1) */
  spectralCentroid: number;
}

// ── Subject Context ───────────────────────────────────────────

export interface SubjectContext {
  /** Whether subject tracking data is available */
  available: boolean;
  /** Normalized subject bounds (0..1 of frame) */
  bounds: { x: number; y: number; width: number; height: number } | null;
  /** Subject center (0..1 of frame) */
  center: { x: number; y: number } | null;
  /** Whether subject matte is available */
  hasMatte: boolean;
  /** Subject presence confidence (0..1) */
  presence: number;
}

// ── Studio Analysis Contract ──────────────────────────────────

export interface StudioAnalysisContract {
  /** Resource availability — what Studio has */
  availability: AnalysisResourceAvailability;
  /** Speech context at current playhead */
  speech: SpeechContext;
  /** Audio context at current playhead */
  audio: AudioContext;
  /** Subject context */
  subject: SubjectContext;
  /** Timeline context */
  timeline: {
    localTimeSecs: number;
    clipProgress: number;
    clipDurationSecs: number;
    sequenceTimeSecs: number;
    activeCueLabels: string[];
    activeMarkerLabels: string[];
  };
}

// ── Build Analysis Contract ───────────────────────────────────

/**
 * Build a StudioAnalysisContract from the canonical Studio project state.
 * This is the ONE analysis truth consumed by both Studio and Motion Animator.
 *
 * Uses deterministic fixtures when real analysis data is unavailable.
 * Does NOT fabricate capabilities — reports actual availability.
 */
export function buildAnalysisContract(
  project: ProjectData,
  sequence: Sequence | null,
  playheadFrame: number,
  clipId?: string
): StudioAnalysisContract {
  const fps = sequence?.format.fps ?? 29.97;
  const sequenceTimeSecs = playheadFrame / fps;

  // Find the clip
  const clip = clipId ? sequence?.clips.find((c) => c.id === clipId) : null;
  const clipStartSecs = clip ? toSeconds(clip.startTime) : 0;
  const clipDurationSecs = clip ? toSeconds(clip.duration) : 0;
  const localTimeSecs = clip ? Math.max(0, Math.min(clipDurationSecs, sequenceTimeSecs - clipStartSecs)) : sequenceTimeSecs;
  const clipProgress = clipDurationSecs > 0 ? localTimeSecs / clipDurationSecs : 0;

  // Gather transcript words from all assets
  const allWords: TranscriptWord[] = [];
  for (const asset of Object.values(project.assets)) {
    if (asset.transcriptWords) {
      allWords.push(...asset.transcriptWords);
    }
  }

  // Find active word at playhead
  const activeWord = allWords.find((w) => {
    const start = toSeconds(w.startTime);
    const end = toSeconds(w.endTime);
    return sequenceTimeSecs >= start && sequenceTimeSecs <= end;
  }) ?? null;

  // Find active speaker
  const activeSpeaker = activeWord?.speaker ?? null;

  // Phrase words (same speaker, nearby)
  const phraseWords = activeSpeaker
    ? allWords.filter((w) => {
        const start = toSeconds(w.startTime);
        const end = toSeconds(w.endTime);
        return w.speaker === activeSpeaker && start >= sequenceTimeSecs - 3 && end <= sequenceTimeSecs + 3;
      })
    : [];

  // Active word progress
  let activeWordProgress = 0;
  if (activeWord) {
    const start = toSeconds(activeWord.startTime);
    const end = toSeconds(activeWord.endTime);
    const dur = end - start;
    activeWordProgress = dur > 0 ? (sequenceTimeSecs - start) / dur : 0;
  }

  // Speech pause detection
  const nearestWord = allWords.reduce<{ word: TranscriptWord | null; dist: number }>(
    (best, w) => {
      const mid = (toSeconds(w.startTime) + toSeconds(w.endTime)) / 2;
      const dist = Math.abs(mid - sequenceTimeSecs);
      return dist < best.dist ? { word: w, dist } : best;
    },
    { word: null, dist: Infinity }
  );
  const isSpeechPause = !activeWord && (nearestWord.dist > 0.3);

  // Phrase progress
  const phraseStart = phraseWords.length > 0 ? toSeconds(phraseWords[0].startTime) : sequenceTimeSecs;
  const phraseEnd = phraseWords.length > 0 ? toSeconds(phraseWords[phraseWords.length - 1].endTime) : sequenceTimeSecs;
  const phraseDur = phraseEnd - phraseStart;
  const phraseProgress = phraseDur > 0 ? (sequenceTimeSecs - phraseStart) / phraseDur : 0;

  // Emphasis score — based on word confidence and position
  const emphasisScore = activeWord
    ? Math.min(1, (activeWord.confidence ?? 0.8) * (activeWord.isFiller ? 0.2 : 1.0))
    : 0;

  // Cues at playhead
  const activeCues = sequence?.cues.filter((cue) => {
    const start = toSeconds(cue.timeRange.start);
    const end = toSeconds(cue.timeRange.end);
    return sequenceTimeSecs >= start && sequenceTimeSecs <= end;
  }) ?? [];

  // Markers near playhead
  const activeMarkers = sequence?.markers.filter((m) => {
    const t = toSeconds(m.time);
    return Math.abs(t - sequenceTimeSecs) < 0.1;
  }) ?? [];

  // Audio context — deterministic fixtures (real analysis would come from AudioBridgeSeam)
  // These are bounded, deterministic values that represent plausible audio state
  // IMPORTANT: These are FIXTURE values, not real audio analysis.
  // When real AudioBridgeSeam is connected, replace with actual analysis data.
  const audioPhase = (sequenceTimeSecs * 2.1) % (2 * Math.PI);
  const beatPhase = (sequenceTimeSecs * 1.8) % (2 * Math.PI);
  const audio: AudioContext = {
    rms: 0.4 + 0.3 * Math.sin(audioPhase),
    low: 0.5 + 0.3 * Math.sin(audioPhase * 0.7),
    mid: 0.4 + 0.25 * Math.sin(audioPhase * 1.3),
    high: 0.3 + 0.2 * Math.sin(audioPhase * 2.1),
    beat: Math.max(0, Math.sin(beatPhase) > 0.85 ? 1 : 0),
    onset: Math.max(0, Math.sin(audioPhase * 3.7) > 0.9 ? 0.8 : 0),
    transient: Math.max(0, Math.sin(audioPhase * 5.3) > 0.92 ? 0.6 : 0),
    tempo: 120,
    spectralCentroid: 0.4 + 0.2 * Math.sin(audioPhase * 0.5),
  };

  // Subject context — not available without real tracking data
  const subject: SubjectContext = {
    available: false,
    bounds: null,
    center: null,
    hasMatte: false,
    presence: 0,
  };

  // Resource availability
  const availability: AnalysisResourceAvailability = {
    hasTranscript: allWords.length > 0,
    hasAudioAnalysis: true, // deterministic fixtures always available
    audioAnalysisIsReal: false, // FIXTURE — not real audio analysis
    hasSubjectTracking: false,
    hasBeatData: true,
    beatDataIsReal: false, // FIXTURE — not real beat detection
    hasOnsetData: true,
    hasSpeakerData: allWords.some((w) => !!w.speaker),
    hasCues: (sequence?.cues.length ?? 0) > 0,
    hasMarkers: (sequence?.markers.length ?? 0) > 0,
    transcriptWordCount: allWords.length,
    speakerCount: new Set(allWords.map((w) => w.speaker).filter(Boolean)).size,
    cueCount: sequence?.cues.length ?? 0,
    markerCount: sequence?.markers.length ?? 0,
  };

  return {
    availability,
    speech: {
      activeWord,
      activeWordProgress,
      activeSpeaker,
      isSpeechPause,
      phraseProgress,
      phraseWords,
      emphasisScore,
      clipProgress,
    },
    audio,
    subject,
    timeline: {
      localTimeSecs,
      clipProgress,
      clipDurationSecs,
      sequenceTimeSecs,
      activeCueLabels: activeCues.map((c) => c.label ?? c.type),
      activeMarkerLabels: activeMarkers.map((m) => m.label),
    },
  };
}

// ── Contract → Signal Values ──────────────────────────────────

/**
 * Convert a StudioAnalysisContract to a flat signal values map.
 * This is what gets passed to the Motion evaluator.
 * Keys match the SIGNAL_CHANNEL_REGISTRY channel IDs.
 */
export function contractToSignalValues(contract: StudioAnalysisContract): Record<string, number> {
  return {
    // Audio
    'audio.rms': contract.audio.rms,
    'audio.low': contract.audio.low,
    'audio.mid': contract.audio.mid,
    'audio.high': contract.audio.high,
    'audio.beat': contract.audio.beat,
    'audio.onset': contract.audio.onset,
    'audio.transient': contract.audio.transient,
    'audio.tempo': contract.audio.tempo / 200, // normalize to 0..1
    'audio.spectral_centroid': contract.audio.spectralCentroid,
    // Speech
    'speech.active_word': contract.speech.activeWord ? 1 : 0,
    'speech.word_progress': contract.speech.activeWordProgress,
    'speech.phrase_progress': contract.speech.phraseProgress,
    'speech.pause': contract.speech.isSpeechPause ? 1 : 0,
    'speech.emphasis': contract.speech.emphasisScore,
    // Timeline
    'timeline.local_time': contract.timeline.localTimeSecs,
    'timeline.clip_progress': contract.timeline.clipProgress,
    // Subject
    'subject.presence': contract.subject.presence,
    'subject.bounds_x': contract.subject.bounds?.x ?? 0.5,
    'subject.bounds_y': contract.subject.bounds?.y ?? 0.5,
    'subject.bounds_width': contract.subject.bounds?.width ?? 0,
    'subject.matte': contract.subject.hasMatte ? 1 : 0,
  };
}

// ── Workspace Handoff Enrichment ──────────────────────────────

/**
 * Enrich a workspace handoff with real analysis context from Studio.
 * Called when building the handoff for Motion Animator.
 */
export function enrichHandoffWithAnalysis(
  contract: StudioAnalysisContract
): {
  activeSpeaker?: string;
  activeWordId?: string;
  availableSignalIds: string[];
} {
  return {
    activeSpeaker: contract.speech.activeSpeaker ?? undefined,
    activeWordId: contract.speech.activeWord?.id ?? undefined,
    availableSignalIds: Object.keys(contractToSignalValues(contract)),
  };
}
