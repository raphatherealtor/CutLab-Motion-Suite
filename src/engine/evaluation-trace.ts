/**
 * CutLab Contribution / Evaluation Trace
 * Makes the evaluation pipeline inspectable.
 * "Why is this moving?" inspector.
 * 
 * For a selected Motion object/property, shows:
 * - TIME: clip local time, choreography mapping, active segment
 * - VALUE: base, track/keyframe, signal modulation, behavior, guard/readability
 * - SPACE: local transform, rig, relation, depth displacement, camera, projection
 * - CONTRIBUTORS: choreography, behavior, signal binding, semantic trigger, macro, camera, subject
 */

import type { MotionObject, FrameState } from '@/motion/types';
import { motionTimeToSeconds } from '@/motion/types';

// ── Contribution Types ────────────────────────────────────────

export type ContributionKind =
  | 'choreography' |'keyframe' |'behavior' |'signal-binding' |'semantic-trigger' |'macro-derived' |'camera-relationship' |'subject-relation' |'readability-guard' |'rig' |'scene-script';

export interface Contribution {
  kind: ContributionKind;
  /** Human-readable label */
  label: string;
  /** The property being affected */
  property: string;
  /** The contribution value */
  value: number | string;
  /** The contribution weight/influence (0..1) */
  influence: number;
  /** Whether this contribution is currently active */
  active: boolean;
  /** Navigation target — where to go to edit this */
  navigationTarget?: {
    panel: 'behaviors' | 'signals' | 'curves' | 'macros' | 'camera' | 'spatial' | 'text';
    itemId?: string;
  };
  /** Additional context */
  context?: string;
}

// ── Time Trace ────────────────────────────────────────────────

export interface TimeTrace {
  /** Studio sequence time in seconds */
  sequenceTimeSecs: number;
  /** Clip-local time in seconds */
  clipLocalTimeSecs: number;
  /** Normalized clip progress (0..1) */
  clipProgress: number;
  /** Active choreography segment label */
  activeSegmentLabel?: string;
  /** Active behavior labels */
  activeBehaviorLabels: string[];
}

// ── Value Trace ───────────────────────────────────────────────

export interface ValueTrace {
  property: string;
  /** Base value (no animation) */
  baseValue: number;
  /** Keyframe contribution */
  keyframeValue?: number;
  /** Signal modulation contribution */
  signalModulation?: number;
  /** Behavior contribution */
  behaviorContribution?: number;
  /** Readability guard applied? */
  readabilityGuardApplied: boolean;
  /** Final computed value */
  finalValue: number;
  /** All contributions in order */
  contributions: Contribution[];
}

// ── Space Trace ───────────────────────────────────────────────

export interface SpaceTrace {
  /** Local transform */
  localTransform: { x: number; y: number; z: number; scaleX: number; scaleY: number; rotation: number };
  /** Rig contribution */
  rigContribution?: { rigId: string; rigType: string; deltaX: number; deltaY: number; deltaZ: number };
  /** Depth displacement */
  depthDisplacement: number;
  /** Camera transform applied */
  cameraTransform?: { z: number; fov: number; parallaxFactor: number };
  /** Subject relation */
  subjectRelation?: { role: string; offset: { x: number; y: number; z: number } };
  /** Final world position */
  worldPosition: { x: number; y: number; z: number };
}

// ── Full Evaluation Trace ─────────────────────────────────────

export interface EvaluationTrace {
  objectId: string;
  objectName: string;
  objectKind: string;
  timeSecs: number;
  timeTrace: TimeTrace;
  valueTraces: ValueTrace[];
  spaceTrace: SpaceTrace;
  /** All active contributions */
  allContributions: Contribution[];
  /** Why is this moving? — top contributors */
  topContributors: Contribution[];
}

// ── Build evaluation trace for an object ─────────────────────

export function buildEvaluationTrace(
  obj: MotionObject,
  timeSecs: number,
  clipDurationSecs: number,
  frameState?: FrameState,
  signalValues?: Record<string, number>
): EvaluationTrace {
  const contributions: Contribution[] = [];

  // Time trace
  const timeTrace: TimeTrace = {
    sequenceTimeSecs: timeSecs,
    clipLocalTimeSecs: timeSecs,
    clipProgress: clipDurationSecs > 0 ? timeSecs / clipDurationSecs : 0,
    activeBehaviorLabels: [],
  };

  // Check active behaviors
  for (const beh of obj.behaviors) {
    const behStart = motionTimeToSeconds(beh.startTime);
    const behEnd = behStart + motionTimeToSeconds(beh.duration);
    const isActive = timeSecs >= behStart && timeSecs <= behEnd;

    if (isActive) {
      timeTrace.activeBehaviorLabels.push(beh.type);

      const contribution: Contribution = {
        kind: 'behavior',
        label: `Behavior: ${beh.type}`,
        property: (beh.params.property as string) ?? 'transform',
        value: beh.type,
        influence: 1.0,
        active: true,
        navigationTarget: { panel: 'behaviors', itemId: beh.id },
        context: `Active from ${behStart.toFixed(2)}s to ${behEnd.toFixed(2)}s`,
      };

      if (beh.signalBinding) {
        contribution.kind = 'signal-binding';
        contribution.label = `Signal: ${beh.signalBinding}`;
        const sigVal = signalValues?.[beh.signalBinding] ?? 0;
        contribution.value = sigVal;
        contribution.influence = sigVal;
        contribution.navigationTarget = { panel: 'signals', itemId: beh.id };
        contribution.context = `Signal value: ${sigVal.toFixed(3)}`;
      }

      contributions.push(contribution);
    }
  }

  // Check keyframes
  if (obj.keyframes.length > 0) {
    const activeKfs = obj.keyframes.filter((kf) => {
      const kfSecs = motionTimeToSeconds(kf.time);
      return Math.abs(kfSecs - timeSecs) < 0.1;
    });

    if (activeKfs.length > 0) {
      contributions.push({
        kind: 'keyframe',
        label: `Keyframe: ${activeKfs.map((k) => k.property).join(', ')}`,
        property: activeKfs[0].property,
        value: activeKfs[0].value as number,
        influence: 1.0,
        active: true,
        navigationTarget: { panel: 'curves', itemId: activeKfs[0].id },
        context: `${activeKfs.length} keyframe(s) near current time`,
      });
    }
  }

  // Depth contribution
  if (obj.depth !== 0) {
    contributions.push({
      kind: 'camera-relationship',
      label: `Depth: ${obj.depth.toFixed(1)}`,
      property: 'depth',
      value: obj.depth,
      influence: Math.min(1, Math.abs(obj.depth) / 5),
      active: true,
      navigationTarget: { panel: 'spatial' },
      context: `Object is at depth ${obj.depth.toFixed(1)} (${obj.depth > 0 ? 'foreground' : 'background'})`,
    });
  }

  // Occlusion role
  if (obj.occlusionRole && obj.occlusionRole !== 'none') {
    contributions.push({
      kind: 'subject-relation',
      label: `Occlusion: ${obj.occlusionRole}`,
      property: 'occlusionRole',
      value: obj.occlusionRole,
      influence: 0.8,
      active: true,
      navigationTarget: { panel: 'spatial' },
      context: `Object has occlusion role: ${obj.occlusionRole}`,
    });
  }

  // Build value traces for key properties
  const valueTraces: ValueTrace[] = [
    buildValueTrace('position.x', obj.transform.position.x, contributions),
    buildValueTrace('position.y', obj.transform.position.y, contributions),
    buildValueTrace('position.z', obj.transform.position.z, contributions),
    buildValueTrace('opacity', obj.transform.opacity, contributions),
    buildValueTrace('scale', obj.transform.scale.x, contributions),
  ];

  // Space trace
  const spaceTrace: SpaceTrace = {
    localTransform: {
      x: obj.transform.position.x,
      y: obj.transform.position.y,
      z: obj.transform.position.z,
      scaleX: obj.transform.scale.x,
      scaleY: obj.transform.scale.y,
      rotation: obj.transform.rotation.z,
    },
    depthDisplacement: obj.depth * 100,
    worldPosition: {
      x: obj.transform.position.x,
      y: obj.transform.position.y,
      z: obj.transform.position.z + obj.depth * 100,
    },
  };

  // Top contributors — most influential active ones
  const topContributors = [...contributions]
    .filter((c) => c.active)
    .sort((a, b) => b.influence - a.influence)
    .slice(0, 5);

  return {
    objectId: obj.id,
    objectName: obj.name,
    objectKind: obj.kind,
    timeSecs,
    timeTrace,
    valueTraces,
    spaceTrace,
    allContributions: contributions,
    topContributors,
  };
}

function buildValueTrace(
  property: string,
  baseValue: number,
  contributions: Contribution[]
): ValueTrace {
  const propContributions = contributions.filter((c) => c.property === property || c.property === 'transform');
  const totalContribution = propContributions.reduce((sum, c) => sum + (c.influence * (typeof c.value === 'number' ? c.value : 0)), 0);

  return {
    property,
    baseValue,
    finalValue: baseValue + totalContribution * 0.1,
    readabilityGuardApplied: false,
    contributions: propContributions,
  };
}

// ── "Why is this moving?" summary ────────────────────────────

export function getWhyIsThisMoving(trace: EvaluationTrace): string[] {
  const reasons: string[] = [];

  if (trace.topContributors.length === 0) {
    reasons.push('No active contributors — object is at rest');
    return reasons;
  }

  for (const contrib of trace.topContributors) {
    switch (contrib.kind) {
      case 'choreography':
        reasons.push(`Choreography: ${contrib.label} (${(contrib.influence * 100).toFixed(0)}% influence)`);
        break;
      case 'behavior':
        reasons.push(`Behavior "${contrib.label}" is active`);
        break;
      case 'signal-binding':
        reasons.push(`Signal "${contrib.label}" = ${typeof contrib.value === 'number' ? contrib.value.toFixed(2) : contrib.value}`);
        break;
      case 'semantic-trigger':
        reasons.push(`Semantic trigger: ${contrib.context ?? contrib.label}`);
        break;
      case 'macro-derived':
        reasons.push(`Macro "${contrib.label}" is affecting this property`);
        break;
      case 'camera-relationship':
        reasons.push(`Camera/depth: ${contrib.context ?? contrib.label}`);
        break;
      case 'subject-relation':
        reasons.push(`Subject relation: ${contrib.context ?? contrib.label}`);
        break;
      case 'keyframe':
        reasons.push(`Keyframe animation: ${contrib.context ?? contrib.label}`);
        break;
      case 'readability-guard':
        reasons.push(`Readability guard is constraining this property`);
        break;
      default:
        reasons.push(contrib.label);
    }
  }

  return reasons;
}
