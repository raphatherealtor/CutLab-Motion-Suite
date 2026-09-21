/**
 * CutLab Scene Script
 * Semantic structure derived from / attached to the canonical Studio sequence.
 * NOT another timeline. NOT another project truth.
 * A semantic view of the canonical Studio sequence.
 * 
 * Scene Script provides context for Motion choreography:
 * - sections, beats, ideas, speaker segments, emphasis moments
 * - energy levels, camera energy, composition density
 * - connects to Motion via signal/context input
 */

import type { Sequence, SemanticCue, Marker, TranscriptWord } from './schema';
import type { RationalTime } from './time';
import { toSeconds, fromSeconds } from './time';
import { generateId } from './schema';

// ── Scene Script Region Types ─────────────────────────────────

export type SceneRegionKind =
  | 'section'           // Major content section
  | 'beat'              // Musical/rhythmic beat
  | 'idea'              // Conceptual unit
  | 'speaker-segment'   // Continuous speaker block
  | 'emphasis-moment'   // High-emphasis moment
  | 'visual-focus'      // Visual attention point
  | 'energy-change'     // Energy transition
  | 'settle-moment'     // Low-energy settle
  | 'transition-moment' // Compositional transition
  | 'intro'             // Opening section
  | 'outro'             // Closing section
  | 'climax';           // Peak energy moment

export type EnergyLevel = 'low' | 'medium' | 'high' | 'peak';
export type CameraEnergyLevel = 'static' | 'restrained' | 'moderate' | 'active' | 'dynamic';
export type CompositionDensity = 'sparse' | 'balanced' | 'dense' | 'complex';

export interface SceneRegion {
  id: string;
  kind: SceneRegionKind;
  /** Start time in sequence */
  start: RationalTime;
  /** End time in sequence */
  end: RationalTime;
  /** Human label */
  label: string;
  /** Semantic purpose description */
  semanticPurpose?: string;
  /** Dominant subject reference */
  dominantSubject?: string;
  /** Active speaker at this region */
  activeSpeaker?: string;
  /** Energy level */
  energyLevel: EnergyLevel;
  /** Camera energy recommendation */
  cameraEnergy: CameraEnergyLevel;
  /** Composition density recommendation */
  compositionDensity: CompositionDensity;
  /** Emphasis words/phrases in this region */
  emphasisWordIds?: string[];
  /** Desired composition density (0..1) */
  densityValue: number;
  /** Desired camera energy (0..1) */
  cameraEnergyValue: number;
  /** Cue/marker references */
  cueIds?: string[];
  markerIds?: string[];
  /** Motion choreography hints */
  motionHints?: {
    restrainCamera?: boolean;
    settleMotion?: boolean;
    punchEmphasis?: boolean;
    reconfigureComposition?: boolean;
    increaseDepth?: boolean;
    reduceMotion?: boolean;
  };
  /** User-editable notes */
  notes?: string;
  /** Whether this region was auto-derived or user-created */
  source: 'auto' | 'user';
  createdAt: number;
  updatedAt: number;
}

// ── Scene Script ──────────────────────────────────────────────

export interface SceneScript {
  id: string;
  /** The sequence this script is derived from */
  sequenceId: string;
  regions: SceneRegion[];
  /** Global energy profile */
  globalEnergyProfile?: number[];
  /** Version for cache invalidation */
  version: number;
  createdAt: number;
  updatedAt: number;
}

// ── Auto-derive Scene Script from sequence ────────────────────

export function deriveSceneScript(
  sequence: Sequence,
  words?: TranscriptWord[]
): SceneScript {
  const now = Date.now();
  const regions: SceneRegion[] = [];

  // 1. Derive from semantic cues
  for (const cue of sequence.cues) {
    const kind = cueTypeToRegionKind(cue.type);
    const startSecs = toSeconds(cue.timeRange.start);
    const endSecs = toSeconds(cue.timeRange.end);
    const duration = endSecs - startSecs;

    regions.push({
      id: generateId('scene-region'),
      kind,
      start: cue.timeRange.start,
      end: cue.timeRange.end,
      label: cue.label ?? cue.type,
      semanticPurpose: cue.type,
      energyLevel: inferEnergyFromCue(cue),
      cameraEnergy: inferCameraEnergyFromCue(cue),
      compositionDensity: 'balanced',
      densityValue: 0.5,
      cameraEnergyValue: 0.5,
      cueIds: [cue.id],
      source: 'auto',
      createdAt: now,
      updatedAt: now,
    });
  }

  // 2. Derive speaker segments from transcript
  if (words && words.length > 0) {
    const speakerSegments = extractSpeakerSegments(words);
    for (const seg of speakerSegments) {
      // Only add if not already covered by a cue region
      const alreadyCovered = regions.some((r) => {
        const rStart = toSeconds(r.start);
        const rEnd = toSeconds(r.end);
        return rStart <= seg.startSecs && rEnd >= seg.endSecs;
      });

      if (!alreadyCovered) {
        regions.push({
          id: generateId('scene-region'),
          kind: 'speaker-segment',
          start: fromSeconds(seg.startSecs),
          end: fromSeconds(seg.endSecs),
          label: `${seg.speaker ?? 'Speaker'} segment`,
          activeSpeaker: seg.speaker,
          energyLevel: 'medium',
          cameraEnergy: 'restrained',
          compositionDensity: 'balanced',
          densityValue: 0.5,
          cameraEnergyValue: 0.3,
          source: 'auto',
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  // 3. Derive from markers
  for (const marker of sequence.markers) {
    const markerSecs = toSeconds(marker.time);
    regions.push({
      id: generateId('scene-region'),
      kind: 'transition-moment',
      start: marker.time,
      end: fromSeconds(markerSecs + 0.5),
      label: marker.label || 'Marker',
      energyLevel: 'medium',
      cameraEnergy: 'moderate',
      compositionDensity: 'balanced',
      densityValue: 0.5,
      cameraEnergyValue: 0.5,
      markerIds: [marker.id],
      source: 'auto',
      createdAt: now,
      updatedAt: now,
    });
  }

  // 4. Add intro/outro if sequence has duration
  const seqClips = sequence.clips;
  if (seqClips.length > 0) {
    const allEnds = seqClips.map((c) => toSeconds(c.startTime) + toSeconds(c.duration));
    const seqDuration = Math.max(...allEnds);

    if (seqDuration > 2) {
      // Intro: first 10% or 3s
      const introDur = Math.min(3, seqDuration * 0.1);
      regions.push({
        id: generateId('scene-region'),
        kind: 'intro',
        start: fromSeconds(0),
        end: fromSeconds(introDur),
        label: 'Intro',
        energyLevel: 'low',
        cameraEnergy: 'restrained',
        compositionDensity: 'sparse',
        densityValue: 0.2,
        cameraEnergyValue: 0.2,
        motionHints: { restrainCamera: true },
        source: 'auto',
        createdAt: now,
        updatedAt: now,
      });

      // Outro: last 10% or 3s
      const outroDur = Math.min(3, seqDuration * 0.1);
      regions.push({
        id: generateId('scene-region'),
        kind: 'outro',
        start: fromSeconds(seqDuration - outroDur),
        end: fromSeconds(seqDuration),
        label: 'Outro',
        energyLevel: 'low',
        cameraEnergy: 'static',
        compositionDensity: 'sparse',
        densityValue: 0.2,
        cameraEnergyValue: 0.1,
        motionHints: { reduceMotion: true, settleMotion: true },
        source: 'auto',
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // Sort by start time
  regions.sort((a, b) => toSeconds(a.start) - toSeconds(b.start));

  return {
    id: generateId('scene-script'),
    sequenceId: sequence.id,
    regions,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

// ── Get active scene region at time ──────────────────────────

export function getActiveSceneRegion(
  script: SceneScript,
  timeSecs: number,
  kind?: SceneRegionKind
): SceneRegion | null {
  const candidates = script.regions.filter((r) => {
    const start = toSeconds(r.start);
    const end = toSeconds(r.end);
    const inRange = timeSecs >= start && timeSecs <= end;
    return inRange && (!kind || r.kind === kind);
  });

  if (candidates.length === 0) return null;
  // Return most specific (shortest duration) region
  return candidates.sort((a, b) => {
    const durA = toSeconds(a.end) - toSeconds(a.start);
    const durB = toSeconds(b.end) - toSeconds(b.start);
    return durA - durB;
  })[0];
}

// ── Get scene context for Motion choreography ─────────────────

export interface SceneMotionContext {
  activeRegion: SceneRegion | null;
  energyLevel: EnergyLevel;
  cameraEnergy: CameraEnergyLevel;
  compositionDensity: CompositionDensity;
  energyValue: number;
  cameraEnergyValue: number;
  densityValue: number;
  motionHints: SceneRegion['motionHints'];
  activeSpeaker?: string;
  isIntro: boolean;
  isOutro: boolean;
  isEmphasis: boolean;
  isSettle: boolean;
  isTransition: boolean;
}

export function getSceneMotionContext(
  script: SceneScript,
  timeSecs: number
): SceneMotionContext {
  const region = getActiveSceneRegion(script, timeSecs);

  return {
    activeRegion: region,
    energyLevel: region?.energyLevel ?? 'medium',
    cameraEnergy: region?.cameraEnergy ?? 'restrained',
    compositionDensity: region?.compositionDensity ?? 'balanced',
    energyValue: region?.densityValue ?? 0.5,
    cameraEnergyValue: region?.cameraEnergyValue ?? 0.3,
    densityValue: region?.densityValue ?? 0.5,
    motionHints: region?.motionHints,
    activeSpeaker: region?.activeSpeaker,
    isIntro: region?.kind === 'intro',
    isOutro: region?.kind === 'outro',
    isEmphasis: region?.kind === 'emphasis-moment',
    isSettle: region?.kind === 'settle-moment',
    isTransition: region?.kind === 'transition-moment',
  };
}

// ── Helpers ───────────────────────────────────────────────────

function cueTypeToRegionKind(cueType: string): SceneRegionKind {
  switch (cueType) {
    case 'emphasis': return 'emphasis-moment';
    case 'beat': return 'beat';
    case 'chapter': return 'section';
    case 'speaker-change': return 'speaker-segment';
    case 'transition-point': return 'transition-moment';
    case 'highlight': return 'visual-focus';
    default: return 'idea';
  }
}

function inferEnergyFromCue(cue: SemanticCue): EnergyLevel {
  switch (cue.type) {
    case 'emphasis': return 'high';
    case 'beat': return 'medium';
    case 'chapter': return 'medium';
    case 'callout': return 'high';
    default: return 'medium';
  }
}

function inferCameraEnergyFromCue(cue: SemanticCue): CameraEnergyLevel {
  switch (cue.type) {
    case 'emphasis': return 'active';
    case 'beat': return 'moderate';
    case 'chapter': return 'restrained';
    case 'transition-point': return 'moderate';
    default: return 'restrained';
  }
}

interface SpeakerSegment {
  speaker?: string;
  startSecs: number;
  endSecs: number;
  wordCount: number;
}

function extractSpeakerSegments(words: TranscriptWord[]): SpeakerSegment[] {
  const sorted = [...words].sort((a, b) => toSeconds(a.startTime) - toSeconds(b.startTime));
  const segments: SpeakerSegment[] = [];
  let current: SpeakerSegment | null = null;

  for (const word of sorted) {
    const startSecs = toSeconds(word.startTime);
    const endSecs = toSeconds(word.endTime);

    if (!current || word.speaker !== current.speaker || startSecs - current.endSecs > 1.0) {
      if (current) segments.push(current);
      current = { speaker: word.speaker, startSecs, endSecs, wordCount: 1 };
    } else {
      current.endSecs = endSecs;
      current.wordCount++;
    }
  }
  if (current) segments.push(current);

  return segments;
}

// ── Scene Script → Motion choreography hints ─────────────────

export interface SceneChoreographyDirective {
  /** Camera behavior for this region */
  cameraDirective: 'static' | 'micro-push' | 'push-in' | 'pull-out' | 'drift' | 'dynamic';
  /** Text/graphic behavior */
  textDirective: 'stable' | 'step-forward' | 'settle' | 'reconfigure' | 'reduce';
  /** Signal gain multiplier */
  signalGain: number;
  /** Depth multiplier */
  depthMultiplier: number;
  /** Stagger compression (lower = faster) */
  staggerCompression: number;
}

export function getChoreographyDirective(ctx: SceneMotionContext): SceneChoreographyDirective {
  if (ctx.isIntro) {
    return { cameraDirective: 'static', textDirective: 'stable', signalGain: 0.5, depthMultiplier: 0.5, staggerCompression: 1.2 };
  }
  if (ctx.isOutro) {
    return { cameraDirective: 'static', textDirective: 'reduce', signalGain: 0.3, depthMultiplier: 0.3, staggerCompression: 1.5 };
  }
  if (ctx.isEmphasis) {
    return { cameraDirective: 'micro-push', textDirective: 'step-forward', signalGain: 1.5, depthMultiplier: 1.5, staggerCompression: 0.7 };
  }
  if (ctx.isSettle) {
    return { cameraDirective: 'static', textDirective: 'settle', signalGain: 0.4, depthMultiplier: 0.8, staggerCompression: 1.3 };
  }
  if (ctx.isTransition) {
    return { cameraDirective: 'drift', textDirective: 'reconfigure', signalGain: 0.8, depthMultiplier: 1.0, staggerCompression: 0.9 };
  }

  // Default based on energy
  switch (ctx.energyLevel) {
    case 'peak':
      return { cameraDirective: 'dynamic', textDirective: 'step-forward', signalGain: 2.0, depthMultiplier: 2.0, staggerCompression: 0.5 };
    case 'high':
      return { cameraDirective: 'push-in', textDirective: 'step-forward', signalGain: 1.3, depthMultiplier: 1.3, staggerCompression: 0.7 };
    case 'low':
      return { cameraDirective: 'static', textDirective: 'stable', signalGain: 0.6, depthMultiplier: 0.7, staggerCompression: 1.2 };
    default:
      return { cameraDirective: 'micro-push', textDirective: 'stable', signalGain: 1.0, depthMultiplier: 1.0, staggerCompression: 1.0 };
  }
}
