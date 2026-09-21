/**
 * CutLab Cross-Modal Demonstration Compositions
 * Eight integrated examples demonstrating multiple systems together.
 * All remain editable — not baked/flattened.
 * 
 * 1. Spoken Emphasis Depth
 * 2. Audio + Text Pulse
 * 3. Subject Wrap Title
 * 4. Pause Settle
 * 5. Speaker Switch
 * 6. Depth Theater Explainer
 * 7. Frame-Break Emphasis
 * 8. Reactive SVG
 */

import type { MotionDocument, MotionObject, MotionBehavior, MotionSignal } from '@/motion/types';
import {
  MOTION_SCHEMA_VERSION,
  DEFAULT_MOTION_TRANSFORM,
  hexToMotionColor,
  secondsToMotionTime,
} from '@/motion/types';
import { generateMotionId } from '@/motion/utils';

// ── Shared helpers ────────────────────────────────────────────

function makeDoc(name: string, durationSecs: number, templateId: string): MotionDocument {
  const now = Date.now();
  return {
    id: generateMotionId('doc'),
    schemaVersion: MOTION_SCHEMA_VERSION,
    name,
    templateId,
    width: 1920,
    height: 1080,
    fps: 29.97,
    duration: secondsToMotionTime(durationSecs),
    objects: {},
    rootObjectIds: [],
    signals: {},
    rigs: [],
    camera: null,
    createdAt: now,
    updatedAt: now,
  };
}

function addObject(doc: MotionDocument, obj: MotionObject): void {
  doc.objects[obj.id] = obj;
  doc.rootObjectIds.push(obj.id);
}

function addSignal(doc: MotionDocument, kind: MotionSignal['kind'], name: string): string {
  const id = generateMotionId('sig');
  doc.signals[id] = { id, kind, name };
  return id;
}

function makeTextObj(
  text: string,
  opts: {
    x?: number; y?: number; z?: number; depth?: number;
    fontSize?: number; fontWeight?: number; color?: string;
    behaviors?: MotionBehavior[];
    occlusionRole?: MotionObject['occlusionRole'];
  } = {}
): MotionObject {
  return {
    id: generateMotionId('obj'),
    kind: 'text',
    name: text.slice(0, 20),
    depth: opts.depth ?? 0,
    transform: {
      ...DEFAULT_MOTION_TRANSFORM,
      position: { x: opts.x ?? 0, y: opts.y ?? 0, z: opts.z ?? 0 },
    },
    keyframes: [],
    behaviors: opts.behaviors ?? [],
    masks: [],
    material: {
      id: generateMotionId('mat'),
      type: 'flat',
      color: hexToMotionColor(opts.color ?? '#ffffff'),
      opacity: 1,
    },
    textSegments: [{
      id: generateMotionId('seg'),
      text,
      fontFamily: 'Inter, sans-serif',
      fontSize: opts.fontSize ?? 72,
      fontWeight: opts.fontWeight ?? 700,
      textAlign: 'center',
    }],
    visible: true,
    locked: false,
    occlusionRole: opts.occlusionRole ?? 'none',
  };
}

function makeShapeObj(
  name: string,
  opts: {
    x?: number; y?: number; z?: number; depth?: number;
    width?: number; height?: number; color?: string;
    behaviors?: MotionBehavior[];
    occlusionRole?: MotionObject['occlusionRole'];
  } = {}
): MotionObject {
  return {
    id: generateMotionId('obj'),
    kind: 'shape',
    name,
    depth: opts.depth ?? 0,
    transform: {
      ...DEFAULT_MOTION_TRANSFORM,
      position: { x: opts.x ?? 0, y: opts.y ?? 0, z: opts.z ?? 0 },
      scale: { x: opts.width ?? 400, y: opts.height ?? 200, z: 1 },
    },
    keyframes: [],
    behaviors: opts.behaviors ?? [],
    masks: [],
    material: {
      id: generateMotionId('mat'),
      type: 'flat',
      color: hexToMotionColor(opts.color ?? '#333333'),
      opacity: 0.8,
    },
    visible: true,
    locked: false,
    occlusionRole: opts.occlusionRole ?? 'none',
  };
}

function makeBehavior(
  type: MotionBehavior['type'],
  durationSecs: number,
  params: Record<string, number | string | boolean>,
  opts: { signalBinding?: string; delay?: number; easing?: MotionBehavior['easing'] } = {}
): MotionBehavior {
  return {
    id: generateMotionId('beh'),
    type,
    startTime: secondsToMotionTime(opts.delay ?? 0),
    duration: secondsToMotionTime(durationSecs),
    params,
    signalBinding: opts.signalBinding,
    easing: opts.easing ?? 'ease-out',
  };
}

// ── 1. Spoken Emphasis Depth ──────────────────────────────────
// Transcript phrase → active word → semantic emphasis → depth step → camera micro push → readability guard

export function createSpokenEmphasisDepth(): MotionDocument {
  const doc = makeDoc('Spoken Emphasis Depth', 8, 'demo-spoken-emphasis-depth');

  // Signals
  const activeWordSig = addSignal(doc, 'speech-timing', 'Active Word');
  const emphasisSig = addSignal(doc, 'semantic-emphasis', 'Semantic Emphasis');
  const pauseSig = addSignal(doc, 'speech-timing', 'Speech Pause');

  // Background text (full phrase)
  const bgText = makeTextObj('THIS HOUSE IS DIFFERENT', {
    y: 0, z: -50, depth: -1,
    fontSize: 80, color: '#aaaaaa',
    behaviors: [
      makeBehavior('fade-in', 0.6, { opacity: 1 }),
    ],
  });

  // Foreground emphasis word — steps forward on emphasis
  const emphasisWord = makeTextObj('DIFFERENT', {
    y: 0, z: 0, depth: 0,
    fontSize: 80, fontWeight: 900, color: '#ffffff',
    behaviors: [
      makeBehavior('signal-reactive', 8, { property: 'position.z', min: 0, max: 200 }, { signalBinding: emphasisSig, easing: 'spring' }),
      makeBehavior('signal-reactive', 8, { property: 'scale.uniform', min: 1, max: 1.3 }, { signalBinding: emphasisSig, easing: 'spring' }),
      // Readability guard — opacity floor
      makeBehavior('signal-reactive', 8, { property: 'opacity', min: 0.85, max: 1 }, { signalBinding: activeWordSig }),
    ],
  });

  // Pause settle behavior
  const settleText = makeTextObj('pause settles here', {
    y: 120, z: 0, depth: 0,
    fontSize: 24, color: '#666666',
    behaviors: [
      makeBehavior('signal-reactive', 8, { property: 'opacity', min: 0, max: 0.6 }, { signalBinding: pauseSig }),
    ],
  });

  addObject(doc, bgText);
  addObject(doc, emphasisWord);
  addObject(doc, settleText);

  // Camera micro push on emphasis
  doc.camera = {
    id: generateMotionId('cam'),
    name: 'Camera',
    transform: { ...DEFAULT_MOTION_TRANSFORM, position: { x: 0, y: 0, z: -800 } },
    keyframes: [],
    fov: 60,
    near: 1,
    far: 10000,
  };

  return doc;
}

// ── 2. Audio + Text Pulse ─────────────────────────────────────
// Onset × active word → controlled punch → glow/material modulation

export function createAudioTextPulse(): MotionDocument {
  const doc = makeDoc('Audio + Text Pulse', 8, 'demo-audio-text-pulse');

  const onsetSig = addSignal(doc, 'audio-onset', 'Onset');
  const beatSig = addSignal(doc, 'audio-beat', 'Beat');
  const rmsSig = addSignal(doc, 'audio-rms', 'RMS');

  // Main title
  const title = makeTextObj('PULSE', {
    y: 0, z: 0, depth: 0,
    fontSize: 120, fontWeight: 900, color: '#ffffff',
    behaviors: [
      makeBehavior('signal-reactive', 8, { property: 'scale.uniform', min: 1, max: 1.4 }, { signalBinding: onsetSig, easing: 'spring' }),
      makeBehavior('signal-reactive', 8, { property: 'position.z', min: 0, max: 80 }, { signalBinding: beatSig, easing: 'spring' }),
    ],
  });
  // Neon material on title
  title.material = {
    id: generateMotionId('mat'),
    type: 'neon',
    color: hexToMotionColor('#00d4ff'),
    opacity: 1,
    params: { glowRadius: 20, glowIntensity: 0.8 },
  };

  // Subtitle — beat stagger
  const subtitle = makeTextObj('REACTIVE TEXT', {
    y: 100, z: -20, depth: -0.5,
    fontSize: 36, color: '#888888',
    behaviors: [
      makeBehavior('signal-reactive', 8, { property: 'opacity', min: 0.4, max: 1 }, { signalBinding: rmsSig }),
      makeBehavior('signal-reactive', 8, { property: 'letterSpacing', min: 0, max: 12 }, { signalBinding: beatSig }),
    ],
  });

  // Background glow shape
  const glow = makeShapeObj('Glow BG', {
    x: 0, y: 0, z: -100, depth: -2,
    width: 600, height: 300, color: '#001133',
    behaviors: [
      makeBehavior('signal-reactive', 8, { property: 'scale.uniform', min: 0.8, max: 1.5 }, { signalBinding: onsetSig, easing: 'ease-out' }),
    ],
  });
  glow.material = {
    id: generateMotionId('mat'),
    type: 'gradient',
    gradientStops: [
      { color: hexToMotionColor('#0066ff'), position: 0 },
      { color: { r: 0, g: 0, b: 0, a: 0 }, position: 1 },
    ],
    gradientAngle: 0,
    opacity: 0.6,
    blendMode: 'screen',
  };

  addObject(doc, glow);
  addObject(doc, title);
  addObject(doc, subtitle);

  return doc;
}

// ── 3. Subject Wrap Title ─────────────────────────────────────
// Subject bounds → wraparound text → front/back crossing → occlusion

export function createSubjectWrapTitle(): MotionDocument {
  const doc = makeDoc('Subject Wrap Title', 8, 'demo-subject-wrap-title');

  const subjectSig = addSignal(doc, 'subject-bounds', 'Subject Bounds');

  // Background text (behind subject)
  const bgTitle = makeTextObj('BEHIND', {
    x: -300, y: 0, z: -200, depth: -3,
    fontSize: 64, color: '#888888',
    occlusionRole: 'background',
    behaviors: [
      makeBehavior('fade-in', 0.8, { opacity: 1 }),
      makeBehavior('signal-reactive', 8, { property: 'position.x', min: -350, max: -250 }, { signalBinding: subjectSig }),
    ],
  });

  // Foreground text (in front of subject)
  const fgTitle = makeTextObj('IN FRONT', {
    x: 300, y: 0, z: 200, depth: 3,
    fontSize: 64, fontWeight: 900, color: '#ffffff',
    occlusionRole: 'foreground',
    behaviors: [
      makeBehavior('fade-in', 0.6, { opacity: 1 }),
      makeBehavior('signal-reactive', 8, { property: 'position.x', min: 250, max: 350 }, { signalBinding: subjectSig }),
    ],
  });

  // Subject placeholder (would be replaced by real subject matte)
  const subjectPlaceholder = makeShapeObj('Subject (placeholder)', {
    x: 0, y: 0, z: 0, depth: 0,
    width: 300, height: 500, color: '#222222',
    occlusionRole: 'subject',
  });
  subjectPlaceholder.material = {
    id: generateMotionId('mat'),
    type: 'flat',
    color: hexToMotionColor('#334455'),
    opacity: 0.5,
    params: { style: 'subject-placeholder' },
  };

  // Wraparound text arc
  const wrapText = makeTextObj('WRAPAROUND TITLE', {
    x: 0, y: -200, z: 50, depth: 0.5,
    fontSize: 48, color: '#cccccc',
    behaviors: [
      makeBehavior('fade-in', 1.0, { opacity: 1 }),
      makeBehavior('signal-reactive', 8, { property: 'rotation.z', min: -5, max: 5 }, { signalBinding: subjectSig }),
    ],
  });

  addObject(doc, bgTitle);
  addObject(doc, subjectPlaceholder);
  addObject(doc, fgTitle);
  addObject(doc, wrapText);

  return doc;
}

// ── 4. Pause Settle ───────────────────────────────────────────
// Speech pause → choreography settles → camera settles → surface softens

export function createPauseSettle(): MotionDocument {
  const doc = makeDoc('Pause Settle', 8, 'demo-pause-settle');

  const pauseSig = addSignal(doc, 'speech-timing', 'Speech Pause');
  const activeWordSig = addSignal(doc, 'speech-timing', 'Active Word');

  // Main text — active during speech
  const mainText = makeTextObj('SPEAKING NOW', {
    y: 0, z: 0, depth: 0,
    fontSize: 72, fontWeight: 700, color: '#ffffff',
    behaviors: [
      makeBehavior('signal-reactive', 8, { property: 'scale.uniform', min: 0.95, max: 1.05 }, { signalBinding: activeWordSig, easing: 'spring' }),
      makeBehavior('signal-reactive', 8, { property: 'position.y', min: -5, max: 5 }, { signalBinding: activeWordSig }),
    ],
  });

  // Settle indicator — appears during pause
  const settleText = makeTextObj('...', {
    y: 80, z: 0, depth: 0,
    fontSize: 48, color: '#666666',
    behaviors: [
      makeBehavior('signal-reactive', 8, { property: 'opacity', min: 0, max: 1 }, { signalBinding: pauseSig, easing: 'ease-in-out' }),
      makeBehavior('signal-reactive', 8, { property: 'scale.uniform', min: 0.8, max: 1 }, { signalBinding: pauseSig, easing: 'ease-out' }),
    ],
  });

  // Background shape — softens during pause
  const bg = makeShapeObj('Background', {
    x: 0, y: 0, z: -200, depth: -3,
    width: 800, height: 400, color: '#111111',
    behaviors: [
      makeBehavior('signal-reactive', 8, { property: 'opacity', min: 0.6, max: 0.9 }, { signalBinding: pauseSig }),
    ],
  });

  addObject(doc, bg);
  addObject(doc, mainText);
  addObject(doc, settleText);

  // Camera settles during pause
  doc.camera = {
    id: generateMotionId('cam'),
    name: 'Camera',
    transform: { ...DEFAULT_MOTION_TRANSFORM, position: { x: 0, y: 0, z: -800 } },
    keyframes: [],
    fov: 60,
    near: 1,
    far: 10000,
  };

  return doc;
}

// ── 5. Speaker Switch ─────────────────────────────────────────
// Speaker change → material/style shift → controlled spatial reposition

export function createSpeakerSwitch(): MotionDocument {
  const doc = makeDoc('Speaker Switch', 8, 'demo-speaker-switch');

  const speakerSig = addSignal(doc, 'speech-timing', 'Speaker Index');

  // Speaker A text
  const speakerAText = makeTextObj('SPEAKER A', {
    x: -200, y: 0, z: 0, depth: 0,
    fontSize: 64, fontWeight: 700, color: '#3B82F6',
    behaviors: [
      makeBehavior('signal-reactive', 8, { property: 'opacity', min: 0.3, max: 1 }, { signalBinding: speakerSig, easing: 'ease-in-out' }),
      makeBehavior('signal-reactive', 8, { property: 'position.z', min: -50, max: 50 }, { signalBinding: speakerSig }),
    ],
  });

  // Speaker B text
  const speakerBText = makeTextObj('SPEAKER B', {
    x: 200, y: 0, z: 0, depth: 0,
    fontSize: 64, fontWeight: 700, color: '#EC4899',
    behaviors: [
      makeBehavior('signal-reactive', 8, { property: 'opacity', min: 1, max: 0.3 }, { signalBinding: speakerSig, easing: 'ease-in-out' }),
      makeBehavior('signal-reactive', 8, { property: 'position.z', min: 50, max: -50 }, { signalBinding: speakerSig }),
    ],
  });

  // Active speaker indicator
  const indicator = makeShapeObj('Speaker Indicator', {
    x: 0, y: 80, z: 10, depth: 0.2,
    width: 60, height: 4, color: '#ffffff',
    behaviors: [
      makeBehavior('signal-reactive', 8, { property: 'position.x', min: -200, max: 200 }, { signalBinding: speakerSig, easing: 'spring' }),
    ],
  });

  addObject(doc, speakerAText);
  addObject(doc, speakerBText);
  addObject(doc, indicator);

  return doc;
}

// ── 6. Depth Theater Explainer ────────────────────────────────
// Scene Script section → spatial panel arrangement → focus object forward → background recedes

export function createDepthTheaterExplainer(): MotionDocument {
  const doc = makeDoc('Depth Theater Explainer', 10, 'demo-depth-theater-explainer');

  const clipProgressSig = addSignal(doc, 'manual', 'Clip Progress');

  // Background panel
  const bgPanel = makeShapeObj('Background Panel', {
    x: 0, y: 0, z: -400, depth: -4,
    width: 1200, height: 600, color: '#0a0a1a',
    behaviors: [
      makeBehavior('fade-in', 1.0, { opacity: 1 }),
    ],
  });

  // Mid panel — explainer content
  const midPanel = makeShapeObj('Mid Panel', {
    x: 0, y: 0, z: -150, depth: -1.5,
    width: 800, height: 400, color: '#111122',
    behaviors: [
      makeBehavior('slide-in', 0.8, { direction: 'bottom', distance: 60 }),
    ],
  });

  // Focus text — steps forward
  const focusText = makeTextObj('FOCUS POINT', {
    x: 0, y: -50, z: 100, depth: 1,
    fontSize: 72, fontWeight: 900, color: '#ffffff',
    behaviors: [
      makeBehavior('scale-in', 0.6, { scale: 1.2 }),
      makeBehavior('signal-reactive', 10, { property: 'position.z', min: 50, max: 200 }, { signalBinding: clipProgressSig, easing: 'ease-in-out' }),
    ],
  });

  // Supporting text — recedes
  const supportText = makeTextObj('supporting context', {
    x: 0, y: 80, z: -100, depth: -1,
    fontSize: 32, color: '#888888',
    behaviors: [
      makeBehavior('fade-in', 0.8, { opacity: 1 }, { delay: 0.3 }),
      makeBehavior('signal-reactive', 10, { property: 'position.z', min: -50, max: -200 }, { signalBinding: clipProgressSig }),
    ],
  });

  // Side panels
  const leftPanel = makeShapeObj('Left Panel', {
    x: -500, y: 0, z: -200, depth: -2,
    width: 200, height: 500, color: '#0d1117',
    behaviors: [
      makeBehavior('slide-in', 0.7, { direction: 'left', distance: 100 }, { delay: 0.2 }),
    ],
  });
  const rightPanel = makeShapeObj('Right Panel', {
    x: 500, y: 0, z: -200, depth: -2,
    width: 200, height: 500, color: '#0d1117',
    behaviors: [
      makeBehavior('slide-in', 0.7, { direction: 'right', distance: 100 }, { delay: 0.2 }),
    ],
  });

  addObject(doc, bgPanel);
  addObject(doc, leftPanel);
  addObject(doc, rightPanel);
  addObject(doc, midPanel);
  addObject(doc, supportText);
  addObject(doc, focusText);

  // Camera adjusts
  doc.camera = {
    id: generateMotionId('cam'),
    name: 'Camera',
    transform: { ...DEFAULT_MOTION_TRANSFORM, position: { x: 0, y: 0, z: -900 } },
    keyframes: [
      {
        id: generateMotionId('kf'),
        time: secondsToMotionTime(0),
        property: 'position.z',
        value: -900,
        easing: 'ease-in-out',
      },
      {
        id: generateMotionId('kf'),
        time: secondsToMotionTime(10),
        property: 'position.z',
        value: -750,
        easing: 'ease-in-out',
      },
    ],
    fov: 60,
    near: 1,
    far: 10000,
  };

  return doc;
}

// ── 7. Frame-Break Emphasis ───────────────────────────────────
// Semantic emphasis → word breaks foreground frame → returns to composition

export function createFrameBreakEmphasis(): MotionDocument {
  const doc = makeDoc('Frame-Break Emphasis', 6, 'demo-frame-break-emphasis');

  const emphasisSig = addSignal(doc, 'semantic-emphasis', 'Semantic Emphasis');
  const onsetSig = addSignal(doc, 'audio-onset', 'Onset');

  // Frame border (foreground)
  const frameBorder = makeShapeObj('Frame Border', {
    x: 0, y: 0, z: 300, depth: 3,
    width: 1800, height: 1000, color: '#000000',
    occlusionRole: 'foreground',
  });
  frameBorder.masks = [{
    id: generateMotionId('mask'),
    shape: 'rectangle',
    inverted: true,
    feather: 0,
    opacity: 1,
    bounds: { x: -880, y: -490, width: 1760, height: 980 },
  }];

  // Main text — inside frame
  const mainText = makeTextObj('BREAK FREE', {
    x: 0, y: 0, z: 0, depth: 0,
    fontSize: 96, fontWeight: 900, color: '#ffffff',
    behaviors: [
      makeBehavior('fade-in', 0.5, { opacity: 1 }),
    ],
  });

  // Emphasis word — breaks frame
  const emphasisText = makeTextObj('FREE', {
    x: 0, y: 0, z: 0, depth: 0,
    fontSize: 96, fontWeight: 900, color: '#EF4444',
    behaviors: [
      makeBehavior('signal-reactive', 6, { property: 'position.z', min: 0, max: 400 }, { signalBinding: emphasisSig, easing: 'spring' }),
      makeBehavior('signal-reactive', 6, { property: 'scale.uniform', min: 1, max: 1.5 }, { signalBinding: emphasisSig, easing: 'spring' }),
      makeBehavior('signal-reactive', 6, { property: 'position.y', min: 0, max: -30 }, { signalBinding: onsetSig, easing: 'spring' }),
    ],
    occlusionRole: 'foreground',
  });

  addObject(doc, mainText);
  addObject(doc, frameBorder);
  addObject(doc, emphasisText);

  return doc;
}

// ── 8. Reactive SVG ───────────────────────────────────────────
// SVG layers → structural depth → audio/speech signal → parallax/camera response

export function createReactiveSVG(): MotionDocument {
  const doc = makeDoc('Reactive SVG', 8, 'demo-reactive-svg');

  const rmsSig = addSignal(doc, 'audio-rms', 'Audio RMS');
  const beatSig = addSignal(doc, 'audio-beat', 'Beat');
  const lowSig = addSignal(doc, 'audio-low', 'Bass');

  // SVG layer 1 — background (deepest)
  const svgBg: MotionObject = {
    id: generateMotionId('obj'),
    kind: 'svg',
    name: 'SVG Layer: Background',
    depth: -3,
    transform: { ...DEFAULT_MOTION_TRANSFORM, position: { x: 0, y: 0, z: -300 } },
    keyframes: [],
    behaviors: [
      makeBehavior('signal-reactive', 8, { property: 'scale.uniform', min: 0.95, max: 1.05 }, { signalBinding: rmsSig }),
    ],
    masks: [],
    svgData: '<svg viewBox="0 0 400 300"><circle cx="200" cy="150" r="120" fill="#1a1a2e" stroke="#3B82F6" stroke-width="2"/></svg>',
    visible: true,
    locked: false,
    occlusionRole: 'background',
  };

  // SVG layer 2 — mid
  const svgMid: MotionObject = {
    id: generateMotionId('obj'),
    kind: 'svg',
    name: 'SVG Layer: Mid',
    depth: -1,
    transform: { ...DEFAULT_MOTION_TRANSFORM, position: { x: 0, y: 0, z: -100 } },
    keyframes: [],
    behaviors: [
      makeBehavior('signal-reactive', 8, { property: 'rotation.z', min: -10, max: 10 }, { signalBinding: beatSig, easing: 'spring' }),
      makeBehavior('signal-reactive', 8, { property: 'scale.uniform', min: 0.9, max: 1.2 }, { signalBinding: lowSig }),
    ],
    masks: [],
    svgData: '<svg viewBox="0 0 200 200"><polygon points="100,20 180,180 20,180" fill="none" stroke="#8B5CF6" stroke-width="3"/></svg>',
    visible: true,
    locked: false,
    occlusionRole: 'none',
  };

  // SVG layer 3 — foreground
  const svgFg: MotionObject = {
    id: generateMotionId('obj'),
    kind: 'svg',
    name: 'SVG Layer: Foreground',
    depth: 2,
    transform: { ...DEFAULT_MOTION_TRANSFORM, position: { x: 0, y: 0, z: 200 } },
    keyframes: [],
    behaviors: [
      makeBehavior('signal-reactive', 8, { property: 'position.x', min: -20, max: 20 }, { signalBinding: rmsSig }),
      makeBehavior('signal-reactive', 8, { property: 'position.y', min: -10, max: 10 }, { signalBinding: beatSig }),
    ],
    masks: [],
    svgData: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="20" fill="#EC4899"/></svg>',
    visible: true,
    locked: false,
    occlusionRole: 'foreground',
  };

  // Label
  const label = makeTextObj('REACTIVE SVG', {
    y: 200, z: 50, depth: 0.5,
    fontSize: 36, color: '#ffffff',
    behaviors: [
      makeBehavior('signal-reactive', 8, { property: 'opacity', min: 0.5, max: 1 }, { signalBinding: rmsSig }),
    ],
  });

  addObject(doc, svgBg);
  addObject(doc, svgMid);
  addObject(doc, svgFg);
  addObject(doc, label);

  // Camera parallax response
  doc.camera = {
    id: generateMotionId('cam'),
    name: 'Camera',
    transform: { ...DEFAULT_MOTION_TRANSFORM, position: { x: 0, y: 0, z: -800 } },
    keyframes: [],
    fov: 60,
    near: 1,
    far: 10000,
  };

  return doc;
}

// ── Demo composition registry ─────────────────────────────────

export interface DemoComposition {
  id: string;
  label: string;
  description: string;
  systems: string[];
  create: () => MotionDocument;
}

export const DEMO_COMPOSITIONS: DemoComposition[] = [
  {
    id: 'spoken-emphasis-depth',
    label: 'Spoken Emphasis Depth',
    description: 'Transcript phrase → active word → semantic emphasis → depth step → camera micro push → readability guard',
    systems: ['transcript', 'speech', 'semantic', 'depth', 'camera', 'readability'],
    create: createSpokenEmphasisDepth,
  },
  {
    id: 'audio-text-pulse',
    label: 'Audio + Text Pulse',
    description: 'Onset × active word → controlled punch → glow/material modulation',
    systems: ['audio', 'onset', 'signal', 'material', 'neon'],
    create: createAudioTextPulse,
  },
  {
    id: 'subject-wrap-title',
    label: 'Subject Wrap Title',
    description: 'Subject bounds → wraparound text → front/back crossing → occlusion',
    systems: ['subject', 'occlusion', 'depth', 'spatial'],
    create: createSubjectWrapTitle,
  },
  {
    id: 'pause-settle',
    label: 'Pause Settle',
    description: 'Speech pause → choreography settles → camera stabilizes → surface softens',
    systems: ['speech', 'pause', 'camera', 'material'],
    create: createPauseSettle,
  },
  {
    id: 'speaker-switch',
    label: 'Speaker Switch',
    description: 'Speaker change → material/style shift → controlled spatial reposition',
    systems: ['speech', 'speaker', 'material', 'spatial'],
    create: createSpeakerSwitch,
  },
  {
    id: 'depth-theater-explainer',
    label: 'Depth Theater Explainer',
    description: 'Scene Script section → spatial panel arrangement → focus object forward → background recedes → camera adjusts',
    systems: ['scene-script', 'depth', 'camera', 'spatial', 'panels'],
    create: createDepthTheaterExplainer,
  },
  {
    id: 'frame-break-emphasis',
    label: 'Frame-Break Emphasis',
    description: 'Semantic emphasis → word breaks foreground frame → returns to composition',
    systems: ['semantic', 'emphasis', 'occlusion', 'foreground', 'frame-break'],
    create: createFrameBreakEmphasis,
  },
  {
    id: 'reactive-svg',
    label: 'Reactive SVG',
    description: 'SVG layers → structural depth → audio/speech signal → parallax/camera response',
    systems: ['svg', 'audio', 'signal', 'depth', 'camera', 'parallax'],
    create: createReactiveSVG,
  },
];
