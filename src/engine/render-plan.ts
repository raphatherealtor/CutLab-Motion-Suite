/**
 * CutLab Render Plan v2 — Sections 4, 14, 20, 21
 * Shared render truth for preview and export.
 * Transitions, graphics, captions, Motion seam, spoken-word foundation.
 * ProjectState + RationalTime → buildRenderPlan → compositor → frame
 */

import type { ProjectData, Sequence, Clip, Caption, Transition } from './schema';
import type { RationalTime } from './time';
import { fromSeconds, toSeconds } from './time';
import { evaluateClipTransform } from './keyframes';
import { getCueContext } from './cues';

// ── Render layer ──────────────────────────────────────────────

export interface RenderLayer {
  clipId: string;
  kind: Clip['kind'];
  assetId?: string;
  runtimeUrl?: string;
  sourceTimeSecs: number;
  transform: import('./schema').Transform;
  effects: import('./schema').Effect[];
  masks: import('./schema').Mask[];
  graphicParams?: Record<string, string | number | boolean>;
  graphicType?: Clip['graphicType'];
  motionBundleId?: string;
  captionText?: string;
  captionStyle?: import('./schema').CaptionStyle;
  gain: number;
  pan?: number;
  fadeGain: number; // 0..1 fade multiplier
  disabled: boolean;
  zOrder: number;
  /** Transition applied to this layer */
  transitionAlpha?: number;
  transitionType?: import('./schema').TransitionType;
  /** Cue context for Motion/Graphics evaluator */
  cueContext?: ReturnType<typeof getCueContext>;
  /** Word-level timing for spoken-word foundation */
  wordTimings?: Caption['wordTimings'];
}

export interface RenderPlan {
  frameIndex: number;
  timeSecs: number;
  fps: number;
  width: number;
  height: number;
  layers: RenderLayer[];
  activeCaptions: Caption[];
  /** Active cue context at this frame */
  cueContext: ReturnType<typeof getCueContext>;
  /** Transition state at this frame */
  transitions: TransitionState[];
}

export interface TransitionState {
  transition: Transition;
  alpha: number; // 0..1 progress through transition
  clipAId: string;
  clipBId: string;
}

// ── Build render plan ─────────────────────────────────────────

export function buildRenderPlan(
  project: ProjectData,
  frameIndex: number
): RenderPlan | null {
  const seq = project.sequences[project.activeSequenceId];
  if (!seq) return null;

  const fps = seq.format.fps;
  const timeSecs = frameIndex / fps;
  const seqTime = fromSeconds(timeSecs, 30000);

  // Active clips at this time
  const activeClips = seq.clips.filter((c) => {
    if (c.disabled) return false;
    const start = toSeconds(c.startTime);
    const end = start + toSeconds(c.duration);
    return timeSecs >= start && timeSecs < end;
  });

  // Compute transition states
  const transitionStates = computeTransitionStates(seq, timeSecs);
  const transitionAlphaMap = new Map<string, { alpha: number; type: import('./schema').TransitionType }>();
  for (const ts of transitionStates) {
    transitionAlphaMap.set(ts.clipAId, { alpha: 1 - ts.alpha, type: ts.transition.type });
    transitionAlphaMap.set(ts.clipBId, { alpha: ts.alpha, type: ts.transition.type });
  }

  // Cue context at this time
  const cueContext = getCueContext(seq.cues, seqTime);

  // Build layers
  const layers: RenderLayer[] = activeClips.map((clip) => {
    const clipLocalSecs = timeSecs - toSeconds(clip.startTime);
    const clipLocalTime = fromSeconds(clipLocalSecs, 30000);
    const sourceTimeSecs = toSeconds(clip.sourceIn) + clipLocalSecs * (clip.speed || 1);

    // Evaluate keyframed transform
    const transform = evaluateClipTransform(clip, clipLocalTime);

    // Fade gain
    const fadeGain = computeFadeGain(clip, timeSecs);

    // Asset runtime URL
    const asset = clip.assetId ? project.assets[clip.assetId] : null;
    const runtimeUrl = asset?.runtimeUrl;

    // Transition alpha
    const transState = transitionAlphaMap.get(clip.id);

    // Clip-level cue context
    const clipCueContext = getCueContext(seq.cues, seqTime);

    // Caption word timings for spoken-word foundation
    const captionWordTimings = seq.captions
      .find((cap) => {
        const capStart = toSeconds(cap.startTime);
        const capEnd = toSeconds(cap.endTime);
        return timeSecs >= capStart && timeSecs < capEnd;
      })?.wordTimings;

    return {
      clipId: clip.id,
      kind: clip.kind,
      assetId: clip.assetId,
      runtimeUrl,
      sourceTimeSecs,
      transform,
      effects: clip.effects.filter((e) => e.enabled),
      masks: clip.masks || [],
      graphicParams: clip.graphicParams,
      graphicType: clip.graphicType,
      motionBundleId: clip.motionDocumentId ?? clip.motionBundleId,
      captionText: clip.captionText,
      captionStyle: clip.captionStyle,
      gain: clip.gain,
      pan: clip.pan,
      fadeGain,
      disabled: clip.disabled,
      zOrder: clip.zOrder ?? 0,
      transitionAlpha: transState?.alpha,
      transitionType: transState?.type,
      cueContext: clipCueContext,
      wordTimings: captionWordTimings,
    };
  });

  // Sort by z-order (video tracks first, then graphics)
  layers.sort((a, b) => {
    const kindOrder = { video: 0, audio: 1, caption: 2, graphic: 3, motion: 4 };
    const ka = kindOrder[a.kind as keyof typeof kindOrder] ?? 5;
    const kb = kindOrder[b.kind as keyof typeof kindOrder] ?? 5;
    if (ka !== kb) return ka - kb;
    return (a.zOrder ?? 0) - (b.zOrder ?? 0);
  });

  // Active captions
  const activeCaptions = seq.captions.filter((cap) => {
    const start = toSeconds(cap.startTime);
    const end = toSeconds(cap.endTime);
    return timeSecs >= start && timeSecs < end;
  });

  return {
    frameIndex,
    timeSecs,
    fps,
    width: seq.format.width,
    height: seq.format.height,
    layers,
    activeCaptions,
    cueContext,
    transitions: transitionStates,
  };
}

// ── Transition computation ────────────────────────────────────

function computeTransitionStates(seq: Sequence, timeSecs: number): TransitionState[] {
  const states: TransitionState[] = [];

  for (const transition of seq.transitions) {
    const clipA = seq.clips.find((c) => c.id === transition.clipAId);
    const clipB = seq.clips.find((c) => c.id === transition.clipBId);
    if (!clipA || !clipB) continue;

    const clipAEnd = toSeconds(clipA.startTime) + toSeconds(clipA.duration);
    const transitionDur = toSeconds(transition.duration);
    const transitionStart = clipAEnd - transitionDur / 2;
    const transitionEnd = clipAEnd + transitionDur / 2;

    if (timeSecs >= transitionStart && timeSecs <= transitionEnd) {
      const alpha = (timeSecs - transitionStart) / transitionDur;
      states.push({
        transition,
        alpha: Math.max(0, Math.min(1, alpha)),
        clipAId: transition.clipAId,
        clipBId: transition.clipBId,
      });
    }
  }

  return states;
}

// ── Fade gain computation ─────────────────────────────────────

function computeFadeGain(clip: Clip, timeSecs: number): number {
  const clipStart = toSeconds(clip.startTime);
  const clipEnd = clipStart + toSeconds(clip.duration);
  const fadeInSecs = toSeconds(clip.fadeIn);
  const fadeOutSecs = toSeconds(clip.fadeOut);

  let gain = 1;

  if (fadeInSecs > 0 && timeSecs < clipStart + fadeInSecs) {
    gain *= (timeSecs - clipStart) / fadeInSecs;
  }

  if (fadeOutSecs > 0 && timeSecs > clipEnd - fadeOutSecs) {
    gain *= (clipEnd - timeSecs) / fadeOutSecs;
  }

  return Math.max(0, Math.min(1, gain));
}

// ── Keyframe evaluation (re-exported for use in compositor) ──

export { evaluateClipTransform } from './keyframes';

// ── Motion seam ───────────────────────────────────────────────

/**
 * Motion Integration Seam — Section 20
 * Graphic/Motion item → canonical timeline placement → RationalTime/local time
 * → cue/context input → deterministic evaluator → compositor
 *
 * Motion items are normal Clip objects with kind='motion' or kind='graphic'.
 * They receive cueContext from the render plan.
 * The Motion evaluator (src/motion/) receives:
 *   - localTau: clip-local time [0..1]
 *   - cueContext: semantic cues at this time
 *   - params: clip.graphicParams
 * Motion has NO separate timeline, clock, undo, or playhead.
 */
export interface MotionEvaluatorInput {
  /** Clip-local time normalized [0..1] */
  localTau: number;
  /** Absolute clip-local time in seconds */
  localTimeSecs: number;
  /** Cue context at this frame */
  cueContext: ReturnType<typeof getCueContext>;
  /** Graphic/Motion params */
  params: Record<string, string | number | boolean>;
  /** Asset references */
  assets: Record<string, import('./schema').Asset>;
  /** Sequence format */
  format: import('./schema').SequenceFormat;
}

export function buildMotionEvaluatorInput(
  layer: RenderLayer,
  plan: RenderPlan,
  project: ProjectData
): MotionEvaluatorInput {
  const seq = project.sequences[project.activeSequenceId];
  const clip = seq?.clips.find((c) => c.id === layer.clipId);
  if (!clip || !seq) {
    return {
      localTau: 0,
      localTimeSecs: 0,
      cueContext: layer.cueContext ?? getCueContext([], fromSeconds(0, 30000)),
      params: layer.graphicParams ?? {},
      assets: project.assets,
      format: seq?.format ?? { width: 1920, height: 1080, fps: 29.97, fpsTimescale: 30000, sampleRate: 48000, channels: 2 },
    };
  }

  const clipDurSecs = toSeconds(clip.duration);
  const localTimeSecs = plan.timeSecs - toSeconds(clip.startTime);
  const localTau = clipDurSecs > 0 ? localTimeSecs / clipDurSecs : 0;

  return {
    localTau: Math.max(0, Math.min(1, localTau)),
    localTimeSecs,
    cueContext: layer.cueContext ?? getCueContext(seq.cues, fromSeconds(plan.timeSecs, 30000)),
    params: layer.graphicParams ?? {},
    assets: project.assets,
    format: seq.format,
  };
}

// ── Spoken-word foundation — Section 21 ──────────────────────

/**
 * Spoken-Word Foundation
 * word / phrase + RationalTime + semantic metadata → visual parameters
 * Structured so future renderer can deterministically map to visual params.
 * NO new timeline architecture needed.
 */
export interface SpokenWordVisualContext {
  wordId: string;
  text: string;
  startTime: RationalTime;
  endTime: RationalTime;
  /** Normalized position within caption [0..1] */
  positionInCaption: number;
  /** Whether this word is active at current time */
  isActive: boolean;
  /** Semantic metadata from cues */
  semanticMetadata?: Record<string, string | number | boolean>;
  /** Future visual parameters (populated by renderer) */
  visualParams?: {
    color?: string;
    opacity?: number;
    fontWeight?: number;
    scale?: number;
    positionX?: number;
    positionY?: number;
    emphasisAmount?: number;
    graphicParam?: Record<string, string | number | boolean>;
  };
}

export function buildSpokenWordContext(
  caption: Caption,
  timeSecs: number,
  cues: import('./schema').SemanticCue[]
): SpokenWordVisualContext[] {
  if (!caption.wordTimings) return [];

  const seqTime = fromSeconds(timeSecs, 30000);
  const cueContext = getCueContext(cues, seqTime);

  return caption.wordTimings.map((wt, i) => {
    const isActive = timeSecs >= toSeconds(wt.startTime) && timeSecs < toSeconds(wt.endTime);
    const wordCues = cues.filter((c) =>
      c.transcriptWordId === wt.wordId ||
      (c.transcriptRangeStart && c.transcriptRangeEnd)
    );
    const semanticMetadata = wordCues.reduce((acc, c) => ({ ...acc, ...c.data }), {} as Record<string, string | number | boolean>);

    return {
      wordId: wt.wordId,
      text: wt.text,
      startTime: wt.startTime,
      endTime: wt.endTime,
      positionInCaption: caption.wordTimings ? i / caption.wordTimings.length : 0,
      isActive,
      semanticMetadata,
      // visualParams populated by future renderer based on semanticMetadata
    };
  });
}
