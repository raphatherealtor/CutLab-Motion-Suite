/**
 * CutLab Motion Evaluator
 * compileMotion + evaluateMotion → FrameState
 * Deterministic. Pure function. No side effects.
 * Driven by Studio time — no internal clock.
 */

import type { MotionDocument, MotionObject, MotionObjectState, MotionTransform, MotionKeyframe, MotionBehavior, MotionMaterial, MotionMask, FrameState, MotionEvalDiagnostics, MotionTextSegment,  } from './types';
import { motionTimeToSeconds, DEFAULT_MOTION_TRANSFORM } from './types';

// ── Compiled Program ──────────────────────────────────────────

export interface CompiledMotionProgram {
  documentId: string;
  documentVersion: number;
  /** Pre-sorted root objects */
  sortedRootIds: string[];
  /** Cached object hierarchy */
  hierarchy: Map<string, string[]>; // parentId → childIds
  /** Compiled at timestamp */
  compiledAt: number;
}

// ── Compile ───────────────────────────────────────────────────

/**
 * Compile a MotionDocument into an optimized program.
 * Call once per document version, cache the result.
 * Re-compile when document changes.
 */
export function compileMotion(doc: MotionDocument): CompiledMotionProgram {
  // Build hierarchy map
  const hierarchy = new Map<string, string[]>();
  for (const obj of Object.values(doc.objects)) {
    if (obj.parentId) {
      const siblings = hierarchy.get(obj.parentId) ?? [];
      siblings.push(obj.id);
      hierarchy.set(obj.parentId, siblings);
    }
  }

  // Sort root objects by depth (back to front)
  const sortedRootIds = [...doc.rootObjectIds].sort((a, b) => {
    const objA = doc.objects[a];
    const objB = doc.objects[b];
    return (objA?.depth ?? 0) - (objB?.depth ?? 0);
  });

  return {
    documentId: doc.id,
    documentVersion: doc.updatedAt,
    sortedRootIds,
    hierarchy,
    compiledAt: Date.now(),
  };
}

// ── Evaluate ──────────────────────────────────────────────────

/**
 * Evaluate a MotionDocument at a given clip-local time.
 * Returns a FrameState describing all object states at that time.
 *
 * @param doc - The MotionDocument to evaluate
 * @param program - Pre-compiled program (from compileMotion)
 * @param localTimeSecs - Clip-local time in seconds (0 = start of clip)
 * @param signalValues - Current signal values from Studio analysis
 */
export function evaluateMotion(
  doc: MotionDocument,
  program: CompiledMotionProgram,
  localTimeSecs: number,
  signalValues: Record<string, number> = {}
): FrameState {
  const startTime = performance.now();
  const durationSecs = motionTimeToSeconds(doc.duration);
  const tau = durationSecs > 0 ? Math.max(0, Math.min(1, localTimeSecs / durationSecs)) : 0;

  const warnings: string[] = [];
  const errors: string[] = [];
  let keyframeCount = 0;
  let behaviorCount = 0;

  // Evaluate all root objects
  const objects: MotionObjectState[] = [];
  for (const rootId of program.sortedRootIds) {
    const obj = doc.objects[rootId];
    if (!obj) {
      warnings.push(`Root object ${rootId} not found in document`);
      continue;
    }
    const state = evaluateObject(obj, doc, program, localTimeSecs, tau, signalValues, null, {
      keyframeCount: 0, behaviorCount: 0, warnings, errors,
    });
    if (state) {
      objects.push(state);
      keyframeCount += obj.keyframes.length;
      behaviorCount += obj.behaviors.length;
    }
  }

  // Evaluate camera
  let camera: FrameState['camera'] | undefined;
  if (doc.camera) {
    const camTransform = evaluateTransform(doc.camera.transform, doc.camera.keyframes, localTimeSecs, signalValues);
    camera = {
      transform: camTransform,
      fov: doc.camera.fov,
      dof: doc.camera.dof,
    };
  }

  const evaluationTimeMs = performance.now() - startTime;

  const diagnostics: MotionEvalDiagnostics = {
    evaluationTimeMs,
    objectCount: objects.length,
    keyframeCount,
    behaviorCount,
    signalCount: Object.keys(signalValues).length,
    warnings,
    errors,
  };

  return {
    localTimeSecs,
    tau,
    objects,
    camera,
    signalValues,
    diagnostics,
  };
}

// ── Object Evaluation ─────────────────────────────────────────

interface EvalContext {
  keyframeCount: number;
  behaviorCount: number;
  warnings: string[];
  errors: string[];
}

function evaluateObject(
  obj: MotionObject,
  doc: MotionDocument,
  program: CompiledMotionProgram,
  localTimeSecs: number,
  tau: number,
  signalValues: Record<string, number>,
  parentTransform: MotionTransform | null,
  ctx: EvalContext
): MotionObjectState | null {
  if (!obj.visible) return null;

  // Evaluate transform with keyframes
  const localTransform = evaluateTransform(obj.transform, obj.keyframes, localTimeSecs, signalValues);

  // Apply behaviors
  const behaviorTransform = applyBehaviors(obj.behaviors, localTransform, localTimeSecs, tau, signalValues, ctx);

  // Compute world transform
  const worldTransform = parentTransform
    ? composeTransforms(parentTransform, behaviorTransform)
    : behaviorTransform;

  // Evaluate opacity (behaviors may modify it)
  const opacity = Math.max(0, Math.min(1, worldTransform.opacity));

  // Evaluate material
  const material = obj.material ? evaluateMaterial(obj.material, localTimeSecs, signalValues) : undefined;

  // Evaluate masks
  const masks = obj.masks.map((m) => evaluateMask(m, localTimeSecs));

  // Evaluate text segments
  let textContent: string | undefined;
  let textSegments: MotionObjectState['textSegments'] | undefined;
  if (obj.kind === 'text' && obj.textSegments) {
    textContent = obj.textSegments.map((s) => s.text).join('');
    textSegments = evaluateTextSegments(obj.textSegments, localTimeSecs, tau, signalValues);
  }

  // Evaluate children
  const childIds = program.hierarchy.get(obj.id) ?? obj.children ?? [];
  const children: MotionObjectState[] = [];
  for (const childId of childIds) {
    const child = doc.objects[childId];
    if (child) {
      const childState = evaluateObject(child, doc, program, localTimeSecs, tau, signalValues, worldTransform, ctx);
      if (childState) children.push(childState);
    }
  }

  return {
    objectId: obj.id,
    kind: obj.kind,
    worldTransform,
    opacity,
    material,
    textContent,
    textSegments,
    masks,
    depth: obj.depth,
    blendMode: obj.blendMode,
    occlusionRole: obj.occlusionRole,
    assetRef: obj.assetRef,
    svgData: obj.svgData,
    children: children.length > 0 ? children : undefined,
    visible: true,
  };
}

// ── Transform Evaluation ──────────────────────────────────────

function evaluateTransform(
  baseTransform: MotionTransform,
  keyframes: MotionKeyframe[],
  localTimeSecs: number,
  signalValues: Record<string, number>
): MotionTransform {
  if (keyframes.length === 0) return { ...baseTransform };

  // Group keyframes by property
  const byProp = new Map<string, MotionKeyframe[]>();
  for (const kf of keyframes) {
    const arr = byProp.get(kf.property) ?? [];
    arr.push(kf);
    byProp.set(kf.property, arr);
  }

  const result = { ...baseTransform };

  for (const [prop, kfs] of byProp) {
    const sorted = [...kfs].sort((a, b) => motionTimeToSeconds(a.time) - motionTimeToSeconds(b.time));
    const value = interpolateKeyframes(sorted, localTimeSecs, signalValues);
    if (value !== null) {
      applyKeyframeValue(result, prop, value);
    }
  }

  return result;
}

function interpolateKeyframes(
  sorted: MotionKeyframe[],
  timeSecs: number,
  signalValues: Record<string, number>
): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return toNumber(sorted[0].value);

  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (timeSecs <= motionTimeToSeconds(first.time)) return toNumber(first.value);
  if (timeSecs >= motionTimeToSeconds(last.time)) return toNumber(last.value);

  // Find surrounding keyframes
  let prevKf = first;
  let nextKf = last;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (motionTimeToSeconds(sorted[i].time) <= timeSecs && motionTimeToSeconds(sorted[i + 1].time) >= timeSecs) {
      prevKf = sorted[i];
      nextKf = sorted[i + 1];
      break;
    }
  }

  const prevSecs = motionTimeToSeconds(prevKf.time);
  const nextSecs = motionTimeToSeconds(nextKf.time);
  const span = nextSecs - prevSecs;
  if (span <= 0) return toNumber(prevKf.value);

  const t = (timeSecs - prevSecs) / span;
  const easedT = applyEasing(t, prevKf.easing, prevKf.easingParams);

  const prevVal = toNumber(prevKf.value);
  const nextVal = toNumber(nextKf.value);
  if (prevVal === null || nextVal === null) return prevVal;

  return prevVal + (nextVal - prevVal) * easedT;
}

function toNumber(v: MotionKeyframe['value']): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v) || 0;
  return 0;
}

function applyEasing(t: number, easing: MotionKeyframe['easing'], params?: MotionKeyframe['easingParams']): number {
  switch (easing) {
    case 'linear': return t;
    case 'ease-in': return t * t;
    case 'ease-out': return t * (2 - t);
    case 'ease-in-out': return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    case 'hold': return 0;
    case 'spring': {
      const tension = params?.tension ?? 170;
      const friction = params?.friction ?? 26;
      // Simplified spring approximation
      const omega = Math.sqrt(tension);
      const zeta = friction / (2 * Math.sqrt(tension));
      if (zeta < 1) {
        const omegaD = omega * Math.sqrt(1 - zeta * zeta);
        return 1 - Math.exp(-zeta * omega * t) * (Math.cos(omegaD * t) + (zeta * omega / omegaD) * Math.sin(omegaD * t));
      }
      return t;
    }
    case 'bounce': {
      if (t < 1 / 2.75) return 7.5625 * t * t;
      if (t < 2 / 2.75) { const tt = t - 1.5 / 2.75; return 7.5625 * tt * tt + 0.75; }
      if (t < 2.5 / 2.75) { const tt = t - 2.25 / 2.75; return 7.5625 * tt * tt + 0.9375; }
      const tt = t - 2.625 / 2.75; return 7.5625 * tt * tt + 0.984375;
    }
    case 'elastic': {
      const amplitude = params?.amplitude ?? 1;
      if (t === 0 || t === 1) return t;
      const p = 0.3;
      const s = p / 4;
      return amplitude * Math.pow(2, -10 * t) * Math.sin((t - s) * (2 * Math.PI) / p) + 1;
    }
    default: return t;
  }
}

function applyKeyframeValue(transform: MotionTransform, prop: string, value: number): void {
  switch (prop) {
    case 'position.x': transform.position = { ...transform.position, x: value }; break;
    case 'position.y': transform.position = { ...transform.position, y: value }; break;
    case 'position.z': transform.position = { ...transform.position, z: value }; break;
    case 'rotation.x': transform.rotation = { ...transform.rotation, x: value }; break;
    case 'rotation.y': transform.rotation = { ...transform.rotation, y: value }; break;
    case 'rotation.z': transform.rotation = { ...transform.rotation, z: value }; break;
    case 'scale.x': transform.scale = { ...transform.scale, x: value }; break;
    case 'scale.y': transform.scale = { ...transform.scale, y: value }; break;
    case 'scale.z': transform.scale = { ...transform.scale, z: value }; break;
    case 'opacity': transform.opacity = value; break;
    case 'anchor.x': transform.anchor = { ...transform.anchor, x: value }; break;
    case 'anchor.y': transform.anchor = { ...transform.anchor, y: value }; break;
    case 'anchor.z': transform.anchor = { ...transform.anchor, z: value }; break;
  }
}

function composeTransforms(parent: MotionTransform, child: MotionTransform): MotionTransform {
  return {
    position: {
      x: parent.position.x + child.position.x * parent.scale.x,
      y: parent.position.y + child.position.y * parent.scale.y,
      z: parent.position.z + child.position.z * parent.scale.z,
    },
    rotation: {
      x: parent.rotation.x + child.rotation.x,
      y: parent.rotation.y + child.rotation.y,
      z: parent.rotation.z + child.rotation.z,
    },
    scale: {
      x: parent.scale.x * child.scale.x,
      y: parent.scale.y * child.scale.y,
      z: parent.scale.z * child.scale.z,
    },
    anchor: child.anchor,
    opacity: parent.opacity * child.opacity,
  };
}

// ── Behavior Application ──────────────────────────────────────

function applyBehaviors(
  behaviors: MotionBehavior[],
  transform: MotionTransform,
  localTimeSecs: number,
  tau: number,
  signalValues: Record<string, number>,
  ctx: EvalContext
): MotionTransform {
  let result = { ...transform };

  for (const behavior of behaviors) {
    const bStart = motionTimeToSeconds(behavior.startTime);
    const bDur = motionTimeToSeconds(behavior.duration);
    const bEnd = bStart + bDur;

    if (localTimeSecs < bStart || localTimeSecs > bEnd) continue;

    const bTau = bDur > 0 ? (localTimeSecs - bStart) / bDur : 0;
    const easedTau = applyEasing(Math.max(0, Math.min(1, bTau)), behavior.easing ?? 'ease-out');

    ctx.behaviorCount++;

    // Get signal value if bound
    const signalValue = behavior.signalBinding ? (signalValues[behavior.signalBinding] ?? 0) : 1;

    switch (behavior.type) {
      case 'fade-in':
        result.opacity *= easedTau * signalValue;
        break;
      case 'fade-out':
        result.opacity *= (1 - easedTau) * signalValue;
        break;
      case 'slide-in': {
        const dir = (behavior.params.direction as string) ?? 'bottom';
        const dist = (behavior.params.distance as number) ?? 60;
        const progress = 1 - easedTau;
        if (dir === 'bottom') result.position = { ...result.position, y: result.position.y + dist * progress };
        else if (dir === 'top') result.position = { ...result.position, y: result.position.y - dist * progress };
        else if (dir === 'left') result.position = { ...result.position, x: result.position.x - dist * progress };
        else if (dir === 'right') result.position = { ...result.position, x: result.position.x + dist * progress };
        break;
      }
      case 'slide-out': {
        const dir = (behavior.params.direction as string) ?? 'bottom';
        const dist = (behavior.params.distance as number) ?? 60;
        if (dir === 'bottom') result.position = { ...result.position, y: result.position.y + dist * easedTau };
        else if (dir === 'top') result.position = { ...result.position, y: result.position.y - dist * easedTau };
        else if (dir === 'left') result.position = { ...result.position, x: result.position.x - dist * easedTau };
        else if (dir === 'right') result.position = { ...result.position, x: result.position.x + dist * easedTau };
        break;
      }
      case 'scale-in': {
        const fromScale = (behavior.params.fromScale as number) ?? 0;
        const scaleVal = fromScale + (1 - fromScale) * easedTau;
        result.scale = { x: result.scale.x * scaleVal, y: result.scale.y * scaleVal, z: result.scale.z };
        break;
      }
      case 'scale-out': {
        const toScale = (behavior.params.toScale as number) ?? 0;
        const scaleVal = 1 - (1 - toScale) * easedTau;
        result.scale = { x: result.scale.x * scaleVal, y: result.scale.y * scaleVal, z: result.scale.z };
        break;
      }
      case 'pulse': {
        const amplitude = (behavior.params.amplitude as number) ?? 0.1;
        const freq = (behavior.params.frequency as number) ?? 2;
        const pulse = 1 + amplitude * Math.sin(localTimeSecs * freq * Math.PI * 2) * signalValue;
        result.scale = { x: result.scale.x * pulse, y: result.scale.y * pulse, z: result.scale.z };
        break;
      }
      case 'shake': {
        const amplitude = (behavior.params.amplitude as number) ?? 5;
        const freq = (behavior.params.frequency as number) ?? 10;
        const shakeX = amplitude * Math.sin(localTimeSecs * freq * Math.PI * 2) * signalValue;
        const shakeY = amplitude * Math.cos(localTimeSecs * freq * Math.PI * 2 * 1.3) * signalValue;
        result.position = { ...result.position, x: result.position.x + shakeX, y: result.position.y + shakeY };
        break;
      }
      case 'spin': {
        const speed = (behavior.params.speed as number) ?? 360;
        result.rotation = { ...result.rotation, z: result.rotation.z + speed * localTimeSecs };
        break;
      }
      case 'signal-reactive': {
        const prop = (behavior.params.property as string) ?? 'scale.x';
        const min = (behavior.params.min as number) ?? 0.8;
        const max = (behavior.params.max as number) ?? 1.2;
        const reactiveVal = min + (max - min) * signalValue;
        applyKeyframeValue(result, prop, reactiveVal);
        break;
      }
    }
  }

  return result;
}

// ── Material Evaluation ───────────────────────────────────────

function evaluateMaterial(
  material: MotionMaterial,
  localTimeSecs: number,
  signalValues: Record<string, number>
): MotionMaterial {
  // For now, return material as-is (keyframed materials would be evaluated here)
  return { ...material };
}

// ── Mask Evaluation ───────────────────────────────────────────

function evaluateMask(mask: MotionMask, localTimeSecs: number): MotionMask {
  if (!mask.keyframes || mask.keyframes.length === 0) return mask;
  // Evaluate mask keyframes (bounds animation)
  return { ...mask };
}

// ── Text Segment Evaluation ───────────────────────────────────

function evaluateTextSegments(
  segments: MotionTextSegment[],
  localTimeSecs: number,
  tau: number,
  signalValues: Record<string, number>
): MotionObjectState['textSegments'] {
  return segments.map((seg) => {
    // Evaluate word-level timing
    if (seg.wordTimings) {
      // Word-by-word reveal
      const activeWords = seg.wordTimings.filter((w) => {
        const wStart = motionTimeToSeconds(w.startTime);
        return localTimeSecs >= wStart;
      });
      const text = activeWords.map((w) => w.text).join(' ');
      return {
        text,
        opacity: 1,
        transform: { ...DEFAULT_MOTION_TRANSFORM },
        material: seg.material,
      };
    }

    return {
      text: seg.text,
      opacity: 1,
      transform: { ...DEFAULT_MOTION_TRANSFORM },
      material: seg.material,
    };
  });
}
