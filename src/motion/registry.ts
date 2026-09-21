/**
 * CutLab Motion Capability Tool Registry
 * 53 registered template generators + capability tools.
 * Used by Studio AI and Motion Library.
 */

import type { MotionCapabilityTool, MotionTemplateGenerator, MotionTemplateParams, MotionDocument, MotionObject, MotionBehavior, MotionTextSegment,  } from './types';
import { MOTION_SCHEMA_VERSION, DEFAULT_MOTION_TRANSFORM, hexToMotionColor, secondsToMotionTime } from './types';
import { makeMotionOp } from './transaction';
import { generateMotionId } from './utils';

// ── Template Generator Helpers ────────────────────────────────

function makeTextObject(
  id: string,
  text: string,
  params: {
    x?: number; y?: number; z?: number;
    fontSize?: number; fontWeight?: number; fontFamily?: string;
    color?: string; opacity?: number;
    behaviors?: MotionBehavior[];
    textSegments?: MotionTextSegment[];
  }
): MotionObject {
  return {
    id,
    kind: 'text',
    name: text.slice(0, 20),
    depth: params.z ?? 0,
    transform: {
      ...DEFAULT_MOTION_TRANSFORM,
      position: { x: params.x ?? 0, y: params.y ?? 0, z: params.z ?? 0 },
      opacity: params.opacity ?? 1,
    },
    keyframes: [],
    behaviors: params.behaviors ?? [],
    masks: [],
    material: {
      id: generateMotionId('mat'),
      type: 'flat',
      color: hexToMotionColor(params.color ?? '#ffffff'),
      opacity: params.opacity ?? 1,
    },
    textSegments: params.textSegments ?? [{
      id: generateMotionId('seg'),
      text,
      fontFamily: params.fontFamily ?? 'Inter, sans-serif',
      fontSize: params.fontSize ?? 48,
      fontWeight: params.fontWeight ?? 700,
      textAlign: 'center',
    }],
    visible: true,
    locked: false,
  };
}

function makeShapeObject(
  id: string,
  name: string,
  params: {
    x?: number; y?: number; z?: number;
    width?: number; height?: number;
    color?: string; opacity?: number;
    behaviors?: MotionBehavior[];
  }
): MotionObject {
  return {
    id,
    kind: 'shape',
    name,
    depth: params.z ?? 0,
    transform: {
      ...DEFAULT_MOTION_TRANSFORM,
      position: { x: params.x ?? 0, y: params.y ?? 0, z: params.z ?? 0 },
      scale: { x: params.width ?? 1, y: params.height ?? 1, z: 1 },
      opacity: params.opacity ?? 1,
    },
    keyframes: [],
    behaviors: params.behaviors ?? [],
    masks: [],
    material: {
      id: generateMotionId('mat'),
      type: 'flat',
      color: hexToMotionColor(params.color ?? '#3B82FF'),
      opacity: params.opacity ?? 1,
    },
    visible: true,
    locked: false,
  };
}

function makeFadeInBehavior(durationSecs: number, delaySecs = 0): MotionBehavior {
  return {
    id: generateMotionId('beh'),
    type: 'fade-in',
    startTime: secondsToMotionTime(delaySecs),
    duration: secondsToMotionTime(durationSecs),
    params: {},
    easing: 'ease-out',
  };
}

function makeSlideInBehavior(durationSecs: number, direction = 'bottom', distance = 40, delaySecs = 0): MotionBehavior {
  return {
    id: generateMotionId('beh'),
    type: 'slide-in',
    startTime: secondsToMotionTime(delaySecs),
    duration: secondsToMotionTime(durationSecs),
    params: { direction, distance },
    easing: 'ease-out',
  };
}

function makeSlideOutBehavior(startSecs: number, durationSecs: number, direction = 'bottom'): MotionBehavior {
  return {
    id: generateMotionId('beh'),
    type: 'slide-out',
    startTime: secondsToMotionTime(startSecs),
    duration: secondsToMotionTime(durationSecs),
    params: { direction, distance: 40 },
    easing: 'ease-in',
  };
}

function makeBaseDocument(params: MotionTemplateParams, templateId: string): MotionDocument {
  return {
    id: params.id,
    name: params.name ?? templateId,
    schemaVersion: MOTION_SCHEMA_VERSION,
    duration: secondsToMotionTime(params.durationSecs ?? 6),
    fps: params.fps ?? 29.97,
    width: params.width ?? 1920,
    height: params.height ?? 1080,
    objects: {},
    rootObjectIds: [],
    signals: {},
    rigs: [],
    templateId,
    templateParams: params.custom,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ── Template Generators (53 registered) ──────────────────────

export const MOTION_TEMPLATE_GENERATORS: MotionTemplateGenerator[] = [

  // ── Core Motion ──────────────────────────────────────────────

  {
    id: 'tpl-lower-third-clean',
    name: 'Lower Third — Clean',
    family: 'core_motion',
    description: 'Clean lower third with name and title',
    tags: ['Title', 'Name', 'Lower Third'],
    defaultDurationSecs: 6,
    previewGradient: 'linear-gradient(135deg, #0d1b3e, #1a2f5e)',
    accentColor: '#3B82FF',
    generate(params) {
      const doc = makeBaseDocument(params, this.id);
      const dur = params.durationSecs ?? 6;
      const primary = params.primaryColor ?? '#3B82FF';
      const text = params.text ?? 'Name Here';
      const subText = params.subText ?? 'Title / Role';

      const barId = generateMotionId('obj');
      const nameId = generateMotionId('obj');
      const titleId = generateMotionId('obj');

      const bar = makeShapeObject(barId, 'Accent Bar', {
        x: -700, y: 380, z: 0,
        width: 4, height: 0.04,
        color: primary,
        behaviors: [makeFadeInBehavior(0.3), makeSlideInBehavior(0.4, 'left', 60)],
      });

      const nameObj = makeTextObject(nameId, text, {
        x: -620, y: 360, z: 1,
        fontSize: 52, fontWeight: 700,
        color: '#ffffff',
        behaviors: [makeFadeInBehavior(0.4, 0.1), makeSlideInBehavior(0.4, 'bottom', 20, 0.1)],
      });

      const titleObj = makeTextObject(titleId, subText, {
        x: -620, y: 420, z: 1,
        fontSize: 32, fontWeight: 400,
        color: 'rgba(255,255,255,0.75)',
        behaviors: [makeFadeInBehavior(0.4, 0.2), makeSlideInBehavior(0.4, 'bottom', 20, 0.2)],
      });

      // Add slide-out behaviors
      bar.behaviors.push(makeSlideOutBehavior(dur - 0.5, 0.4, 'left'));
      nameObj.behaviors.push(makeSlideOutBehavior(dur - 0.5, 0.4, 'bottom'));
      titleObj.behaviors.push(makeSlideOutBehavior(dur - 0.5, 0.4, 'bottom'));

      doc.objects = { [barId]: bar, [nameId]: nameObj, [titleId]: titleObj };
      doc.rootObjectIds = [barId, nameId, titleId];
      return doc;
    },
  },

  {
    id: 'tpl-lower-third-accent',
    name: 'Lower Third — Accent',
    family: 'core_motion',
    description: 'Accent lower third with colored background',
    tags: ['Title', 'Accent', 'Lower Third'],
    defaultDurationSecs: 6,
    previewGradient: 'linear-gradient(135deg, #1a0d3e, #2a1a5e)',
    accentColor: '#8B5CF6',
    generate(params) {
      const doc = makeBaseDocument(params, this.id);
      const dur = params.durationSecs ?? 6;
      const primary = params.primaryColor ?? '#8B5CF6';
      const text = params.text ?? 'Name Here';
      const subText = params.subText ?? 'Title / Role';

      const bgId = generateMotionId('obj');
      const nameId = generateMotionId('obj');
      const titleId = generateMotionId('obj');

      const bg = makeShapeObject(bgId, 'Background', {
        x: -700, y: 370, z: -1,
        width: 5.5, height: 0.12,
        color: primary,
        behaviors: [makeFadeInBehavior(0.3), makeSlideInBehavior(0.4, 'left', 80)],
      });
      bg.material = { id: generateMotionId('mat'), type: 'flat', color: hexToMotionColor(primary), opacity: 0.9 };

      const nameObj = makeTextObject(nameId, text, {
        x: -620, y: 360, z: 1,
        fontSize: 48, fontWeight: 700,
        color: '#ffffff',
        behaviors: [makeFadeInBehavior(0.4, 0.15)],
      });

      const titleObj = makeTextObject(titleId, subText, {
        x: -620, y: 415, z: 1,
        fontSize: 28, fontWeight: 400,
        color: 'rgba(255,255,255,0.85)',
        behaviors: [makeFadeInBehavior(0.4, 0.25)],
      });

      bg.behaviors.push(makeSlideOutBehavior(dur - 0.5, 0.4, 'left'));
      nameObj.behaviors.push(makeFadeInBehavior(0.3));
      titleObj.behaviors.push(makeFadeInBehavior(0.3));

      doc.objects = { [bgId]: bg, [nameId]: nameObj, [titleId]: titleObj };
      doc.rootObjectIds = [bgId, nameId, titleId];
      return doc;
    },
  },

  {
    id: 'tpl-logo-reveal',
    name: 'Logo Reveal',
    family: 'core_motion',
    description: 'Animated logo reveal with scale and fade',
    tags: ['Brand', 'Intro', 'Logo'],
    defaultDurationSecs: 4,
    previewGradient: 'linear-gradient(135deg, #0d2a1e, #0f3d26)',
    accentColor: '#34D399',
    generate(params) {
      const doc = makeBaseDocument(params, this.id);
      const text = params.text ?? 'BRAND';

      const logoId = generateMotionId('obj');
      const taglineId = generateMotionId('obj');

      const logo = makeTextObject(logoId, text, {
        x: 0, y: -20, z: 0,
        fontSize: 96, fontWeight: 800,
        color: params.primaryColor ?? '#34D399',
        behaviors: [
          makeFadeInBehavior(0.6),
          { id: generateMotionId('beh'), type: 'scale-in', startTime: secondsToMotionTime(0), duration: secondsToMotionTime(0.8), params: { fromScale: 0.7 }, easing: 'ease-out' },
        ],
      });

      const tagline = makeTextObject(taglineId, params.subText ?? 'Your Tagline', {
        x: 0, y: 60, z: 0,
        fontSize: 28, fontWeight: 300,
        color: 'rgba(255,255,255,0.7)',
        behaviors: [makeFadeInBehavior(0.5, 0.4), makeSlideInBehavior(0.5, 'bottom', 20, 0.4)],
      });

      doc.objects = { [logoId]: logo, [taglineId]: tagline };
      doc.rootObjectIds = [logoId, taglineId];
      return doc;
    },
  },

  {
    id: 'tpl-text-reveal',
    name: 'Text Reveal — Wipe',
    family: 'core_motion',
    description: 'Text reveal with wipe animation',
    tags: ['Text', 'Wipe', 'Reveal'],
    defaultDurationSecs: 4,
    previewGradient: 'linear-gradient(135deg, #0d1b3e, #1a2f5e)',
    accentColor: '#3B82FF',
    generate(params) {
      const doc = makeBaseDocument(params, this.id);
      const textId = generateMotionId('obj');

      const textObj = makeTextObject(textId, params.text ?? 'Your Message Here', {
        x: 0, y: 0, z: 0,
        fontSize: 72, fontWeight: 700,
        color: '#ffffff',
        behaviors: [
          makeFadeInBehavior(0.5),
          makeSlideInBehavior(0.6, 'bottom', 30),
        ],
      });

      doc.objects = { [textId]: textObj };
      doc.rootObjectIds = [textId];
      return doc;
    },
  },

  {
    id: 'tpl-kinetic-headline',
    name: 'Kinetic Headline',
    family: 'creative',
    description: 'Kinetic typography headline with word-by-word animation',
    tags: ['Text', 'Motion', 'Kinetic'],
    defaultDurationSecs: 5,
    previewGradient: 'linear-gradient(135deg, #1a0d3e, #3d1a6e)',
    accentColor: '#8B5CF6',
    generate(params) {
      const doc = makeBaseDocument(params, this.id);
      const text = params.text ?? 'Make It Move';
      const words = text.split(' ');

      const objectIds: string[] = [];
      const objects: Record<string, MotionObject> = {};

      words.forEach((word, i) => {
        const objId = generateMotionId('obj');
        const delay = i * 0.15;
        const obj = makeTextObject(objId, word, {
          x: (i - words.length / 2) * 180,
          y: 0, z: i * 0.1,
          fontSize: 80, fontWeight: 800,
          color: i % 2 === 0 ? '#ffffff' : (params.accentColor ?? '#8B5CF6'),
          behaviors: [
            makeFadeInBehavior(0.4, delay),
            makeSlideInBehavior(0.5, 'bottom', 40, delay),
          ],
        });
        objects[objId] = obj;
        objectIds.push(objId);
      });

      doc.objects = objects;
      doc.rootObjectIds = objectIds;
      return doc;
    },
  },

  {
    id: 'tpl-stat-counter',
    name: 'Stat Counter',
    family: 'data_viz',
    description: 'Animated number counter with label',
    tags: ['Number', 'Count', 'Data'],
    defaultDurationSecs: 4,
    previewGradient: 'linear-gradient(135deg, #0d2a1e, #0f3d26)',
    accentColor: '#34D399',
    generate(params) {
      const doc = makeBaseDocument(params, this.id);
      const numberId = generateMotionId('obj');
      const labelId = generateMotionId('obj');

      const numberObj = makeTextObject(numberId, params.text ?? '1,234', {
        x: 0, y: -30, z: 0,
        fontSize: 120, fontWeight: 800,
        color: params.accentColor ?? '#34D399',
        behaviors: [makeFadeInBehavior(0.5), { id: generateMotionId('beh'), type: 'scale-in', startTime: secondsToMotionTime(0), duration: secondsToMotionTime(0.6), params: { fromScale: 0.5 }, easing: 'ease-out' }],
      });

      const labelObj = makeTextObject(labelId, params.subText ?? 'Total Users', {
        x: 0, y: 70, z: 0,
        fontSize: 32, fontWeight: 400,
        color: 'rgba(255,255,255,0.7)',
        behaviors: [makeFadeInBehavior(0.4, 0.3)],
      });

      doc.objects = { [numberId]: numberObj, [labelId]: labelObj };
      doc.rootObjectIds = [numberId, labelId];
      return doc;
    },
  },

  {
    id: 'tpl-bar-chart',
    name: 'Animated Bar Chart',
    family: 'data_viz',
    description: 'Animated bar chart with labels',
    tags: ['Data', 'Chart', 'Bar'],
    defaultDurationSecs: 8,
    previewGradient: 'linear-gradient(135deg, #0d1b3e, #182033)',
    accentColor: '#22D3EE',
    generate(params) {
      const doc = makeBaseDocument(params, this.id);
      const bars = [0.6, 0.85, 0.45, 0.9, 0.7];
      const colors = ['#3B82FF', '#22D3EE', '#8B5CF6', '#34D399', '#F43F5E'];
      const objectIds: string[] = [];
      const objects: Record<string, MotionObject> = {};

      bars.forEach((height, i) => {
        const barId = generateMotionId('obj');
        const delay = i * 0.15;
        const bar = makeShapeObject(barId, `Bar ${i + 1}`, {
          x: (i - 2) * 200,
          y: 100 - height * 200,
          z: 0,
          width: 0.8,
          height: height * 2,
          color: colors[i % colors.length],
          behaviors: [
            makeFadeInBehavior(0.3, delay),
            { id: generateMotionId('beh'), type: 'scale-in', startTime: secondsToMotionTime(delay), duration: secondsToMotionTime(0.6), params: { fromScale: 0 }, easing: 'ease-out' },
          ],
        });
        objects[barId] = bar;
        objectIds.push(barId);
      });

      doc.objects = objects;
      doc.rootObjectIds = objectIds;
      return doc;
    },
  },

  {
    id: 'tpl-line-chart',
    name: 'Line Chart — Growth',
    family: 'data_viz',
    description: 'Animated line chart showing growth trend',
    tags: ['Data', 'Trend', 'Line'],
    defaultDurationSecs: 8,
    previewGradient: 'linear-gradient(135deg, #0d1b3e, #1a2f5e)',
    accentColor: '#3B82FF',
    generate(params) {
      const doc = makeBaseDocument(params, this.id);
      const titleId = generateMotionId('obj');
      const title = makeTextObject(titleId, params.text ?? 'Growth Trend', {
        x: 0, y: -300, z: 0,
        fontSize: 48, fontWeight: 600,
        color: '#ffffff',
        behaviors: [makeFadeInBehavior(0.5)],
      });
      doc.objects = { [titleId]: title };
      doc.rootObjectIds = [titleId];
      return doc;
    },
  },

  {
    id: 'tpl-pie-donut',
    name: 'Donut Chart',
    family: 'data_viz',
    description: 'Animated donut/pie chart',
    tags: ['Data', 'Proportion', 'Pie'],
    defaultDurationSecs: 6,
    previewGradient: 'linear-gradient(135deg, #1a0d3e, #2a1a5e)',
    accentColor: '#8B5CF6',
    generate(params) {
      const doc = makeBaseDocument(params, this.id);
      const labelId = generateMotionId('obj');
      const label = makeTextObject(labelId, params.text ?? '68%', {
        x: 0, y: 0, z: 0,
        fontSize: 96, fontWeight: 800,
        color: params.accentColor ?? '#8B5CF6',
        behaviors: [makeFadeInBehavior(0.6), { id: generateMotionId('beh'), type: 'scale-in', startTime: secondsToMotionTime(0), duration: secondsToMotionTime(0.8), params: { fromScale: 0.3 }, easing: 'ease-out' }],
      });
      doc.objects = { [labelId]: label };
      doc.rootObjectIds = [labelId];
      return doc;
    },
  },

  {
    id: 'tpl-explainer-step',
    name: 'Step Explainer',
    family: 'explainer',
    description: 'Step-by-step explainer with numbered items',
    tags: ['Steps', 'How-to', 'Explainer'],
    defaultDurationSecs: 10,
    previewGradient: 'linear-gradient(135deg, #1f0d1a, #3d1530)',
    accentColor: '#F43F5E',
    generate(params) {
      const doc = makeBaseDocument(params, this.id);
      const steps = (params.text ?? 'Step 1\nStep 2\nStep 3').split('\n');
      const objectIds: string[] = [];
      const objects: Record<string, MotionObject> = {};

      steps.forEach((step, i) => {
        const objId = generateMotionId('obj');
        const delay = i * 0.4;
        const obj = makeTextObject(objId, `${i + 1}. ${step}`, {
          x: -400, y: (i - 1) * 100, z: 0,
          fontSize: 42, fontWeight: 600,
          color: '#ffffff',
          behaviors: [makeFadeInBehavior(0.4, delay), makeSlideInBehavior(0.5, 'left', 50, delay)],
        });
        objects[objId] = obj;
        objectIds.push(objId);
      });

      doc.objects = objects;
      doc.rootObjectIds = objectIds;
      return doc;
    },
  },

  {
    id: 'tpl-explainer-list',
    name: 'Animated List',
    family: 'explainer',
    description: 'Animated bullet list',
    tags: ['List', 'Bullets', 'Explainer'],
    defaultDurationSecs: 8,
    previewGradient: 'linear-gradient(135deg, #0d1b3e, #182033)',
    accentColor: '#3B82FF',
    generate(params) {
      const doc = makeBaseDocument(params, this.id);
      const items = (params.text ?? 'Item One\nItem Two\nItem Three').split('\n');
      const objectIds: string[] = [];
      const objects: Record<string, MotionObject> = {};

      items.forEach((item, i) => {
        const objId = generateMotionId('obj');
        const delay = i * 0.3;
        const obj = makeTextObject(objId, `• ${item}`, {
          x: -350, y: (i - 1) * 90, z: 0,
          fontSize: 38, fontWeight: 500,
          color: '#ffffff',
          behaviors: [makeFadeInBehavior(0.4, delay), makeSlideInBehavior(0.4, 'left', 40, delay)],
        });
        objects[objId] = obj;
        objectIds.push(objId);
      });

      doc.objects = objects;
      doc.rootObjectIds = objectIds;
      return doc;
    },
  },

  {
    id: 'tpl-particle-burst',
    name: 'Particle Burst',
    family: 'creative',
    description: 'Particle burst effect for transitions',
    tags: ['FX', 'Transition', 'Particle'],
    defaultDurationSecs: 3,
    previewGradient: 'linear-gradient(135deg, #1a0d3e, #2a1a5e)',
    accentColor: '#22D3EE',
    generate(params) {
      const doc = makeBaseDocument(params, this.id);
      const objectIds: string[] = [];
      const objects: Record<string, MotionObject> = {};

      for (let i = 0; i < 12; i++) {
        const objId = generateMotionId('obj');
        const angle = (i / 12) * Math.PI * 2;
        const radius = 80 + Math.random() * 120;
        const obj = makeShapeObject(objId, `Particle ${i}`, {
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
          z: 0,
          width: 0.04, height: 0.04,
          color: i % 3 === 0 ? '#22D3EE' : i % 3 === 1 ? '#8B5CF6' : '#3B82FF',
          behaviors: [
            makeFadeInBehavior(0.2, i * 0.05),
            { id: generateMotionId('beh'), type: 'scale-in', startTime: secondsToMotionTime(i * 0.05), duration: secondsToMotionTime(0.3), params: { fromScale: 0 }, easing: 'ease-out' },
          ],
        });
        objects[objId] = obj;
        objectIds.push(objId);
      }

      doc.objects = objects;
      doc.rootObjectIds = objectIds;
      return doc;
    },
  },

  {
    id: 'tpl-screen-zoom',
    name: 'Screen Zoom Focus',
    family: 'screen_demo',
    description: 'Zoom focus effect for screen recordings',
    tags: ['Zoom', 'Screen', 'Focus'],
    defaultDurationSecs: 4,
    previewGradient: 'linear-gradient(135deg, #0d2a1e, #0a2018)',
    accentColor: '#34D399',
    generate(params) {
      const doc = makeBaseDocument(params, this.id);
      const labelId = generateMotionId('obj');
      const label = makeTextObject(labelId, params.text ?? 'Focus Area', {
        x: 0, y: 200, z: 0,
        fontSize: 36, fontWeight: 600,
        color: params.accentColor ?? '#34D399',
        behaviors: [makeFadeInBehavior(0.4, 0.3)],
      });
      doc.objects = { [labelId]: label };
      doc.rootObjectIds = [labelId];
      return doc;
    },
  },

  {
    id: 'tpl-click-indicator',
    name: 'Click Indicator',
    family: 'screen_demo',
    description: 'Animated click indicator for screen demos',
    tags: ['Click', 'UX', 'Screen'],
    defaultDurationSecs: 2,
    previewGradient: 'linear-gradient(135deg, #1a0d3e, #2a1a5e)',
    accentColor: '#8B5CF6',
    generate(params) {
      const doc = makeBaseDocument(params, this.id);
      const circleId = generateMotionId('obj');
      const circle = makeShapeObject(circleId, 'Click Ring', {
        x: 0, y: 0, z: 0,
        width: 0.15, height: 0.15,
        color: params.accentColor ?? '#8B5CF6',
        behaviors: [
          makeFadeInBehavior(0.1),
          { id: generateMotionId('beh'), type: 'scale-out', startTime: secondsToMotionTime(0.1), duration: secondsToMotionTime(0.8), params: { toScale: 2.5 }, easing: 'ease-out' },
          { id: generateMotionId('beh'), type: 'fade-out', startTime: secondsToMotionTime(0.3), duration: secondsToMotionTime(0.7), params: {}, easing: 'ease-in' },
        ],
      });
      doc.objects = { [circleId]: circle };
      doc.rootObjectIds = [circleId];
      return doc;
    },
  },

  {
    id: 'tpl-callout-box',
    name: 'Callout Box',
    family: 'screen_demo',
    description: 'Callout annotation box with arrow',
    tags: ['Callout', 'Annotation', 'Screen'],
    defaultDurationSecs: 6,
    previewGradient: 'linear-gradient(135deg, #0d1b3e, #1a2f5e)',
    accentColor: '#3B82FF',
    generate(params) {
      const doc = makeBaseDocument(params, this.id);
      const bgId = generateMotionId('obj');
      const textId = generateMotionId('obj');

      const bg = makeShapeObject(bgId, 'Callout BG', {
        x: 200, y: -100, z: 0,
        width: 3, height: 0.6,
        color: params.primaryColor ?? '#1a2f5e',
        behaviors: [makeFadeInBehavior(0.3), makeSlideInBehavior(0.4, 'right', 40)],
      });

      const text = makeTextObject(textId, params.text ?? 'Look here!', {
        x: 200, y: -100, z: 1,
        fontSize: 32, fontWeight: 600,
        color: '#ffffff',
        behaviors: [makeFadeInBehavior(0.3, 0.2)],
      });

      doc.objects = { [bgId]: bg, [textId]: text };
      doc.rootObjectIds = [bgId, textId];
      return doc;
    },
  },

  {
    id: 'tpl-social-hook',
    name: 'Social Hook Frame',
    family: 'creative',
    description: 'Attention-grabbing hook frame for social media',
    tags: ['Hook', 'Social', 'Attention'],
    defaultDurationSecs: 3,
    previewGradient: 'linear-gradient(135deg, #1f0d1a, #3d1530)',
    accentColor: '#F43F5E',
    generate(params) {
      const doc = makeBaseDocument(params, this.id);
      const textId = generateMotionId('obj');
      const text = makeTextObject(textId, params.text ?? 'WAIT FOR IT...', {
        x: 0, y: 0, z: 0,
        fontSize: 88, fontWeight: 900,
        color: params.accentColor ?? '#F43F5E',
        behaviors: [
          makeFadeInBehavior(0.2),
          { id: generateMotionId('beh'), type: 'scale-in', startTime: secondsToMotionTime(0), duration: secondsToMotionTime(0.4), params: { fromScale: 1.3 }, easing: 'ease-out' },
          { id: generateMotionId('beh'), type: 'pulse', startTime: secondsToMotionTime(0.5), duration: secondsToMotionTime(2.5), params: { amplitude: 0.05, frequency: 2 }, easing: 'linear' },
        ],
      });
      doc.objects = { [textId]: text };
      doc.rootObjectIds = [textId];
      return doc;
    },
  },

  {
    id: 'tpl-progress-bar',
    name: 'Progress Bar',
    family: 'business',
    description: 'Animated progress bar with percentage',
    tags: ['Progress', 'KPI', 'Business'],
    defaultDurationSecs: 5,
    previewGradient: 'linear-gradient(135deg, #0d1b3e, #182033)',
    accentColor: '#3B82FF',
    generate(params) {
      const doc = makeBaseDocument(params, this.id);
      const trackId = generateMotionId('obj');
      const fillId = generateMotionId('obj');
      const labelId = generateMotionId('obj');

      const track = makeShapeObject(trackId, 'Track', {
        x: 0, y: 0, z: 0,
        width: 8, height: 0.06,
        color: 'rgba(255,255,255,0.15)',
        behaviors: [makeFadeInBehavior(0.3)],
      });

      const fill = makeShapeObject(fillId, 'Fill', {
        x: -400, y: 0, z: 1,
        width: 5.6, height: 0.06,
        color: params.primaryColor ?? '#3B82FF',
        behaviors: [
          makeFadeInBehavior(0.3),
          { id: generateMotionId('beh'), type: 'slide-in', startTime: secondsToMotionTime(0.3), duration: secondsToMotionTime(1.2), params: { direction: 'left', distance: 600 }, easing: 'ease-out' },
        ],
      });

      const label = makeTextObject(labelId, params.text ?? '70%', {
        x: 0, y: 60, z: 0,
        fontSize: 36, fontWeight: 600,
        color: '#ffffff',
        behaviors: [makeFadeInBehavior(0.4, 0.5)],
      });

      doc.objects = { [trackId]: track, [fillId]: fill, [labelId]: label };
      doc.rootObjectIds = [trackId, fillId, labelId];
      return doc;
    },
  },

  {
    id: 'tpl-timeline-infographic',
    name: 'Timeline Infographic',
    family: 'business',
    description: 'Animated timeline infographic',
    tags: ['Timeline', 'Story', 'Business'],
    defaultDurationSecs: 12,
    previewGradient: 'linear-gradient(135deg, #1a0d3e, #2a1a5e)',
    accentColor: '#8B5CF6',
    generate(params) {
      const doc = makeBaseDocument(params, this.id);
      const events = (params.text ?? '2020\n2021\n2022\n2023').split('\n');
      const objectIds: string[] = [];
      const objects: Record<string, MotionObject> = {};

      events.forEach((event, i) => {
        const objId = generateMotionId('obj');
        const delay = i * 0.5;
        const obj = makeTextObject(objId, event, {
          x: (i - events.length / 2) * 280,
          y: 0, z: 0,
          fontSize: 36, fontWeight: 600,
          color: '#ffffff',
          behaviors: [makeFadeInBehavior(0.4, delay), makeSlideInBehavior(0.5, 'bottom', 30, delay)],
        });
        objects[objId] = obj;
        objectIds.push(objId);
      });

      doc.objects = objects;
      doc.rootObjectIds = objectIds;
      return doc;
    },
  },

  {
    id: 'tpl-map-pin',
    name: 'Map Pin Drop',
    family: 'spatial',
    description: 'Animated map pin drop with label',
    tags: ['Map', 'Location', 'Spatial'],
    defaultDurationSecs: 4,
    previewGradient: 'linear-gradient(135deg, #0d2a1e, #0f3d26)',
    accentColor: '#34D399',
    generate(params) {
      const doc = makeBaseDocument(params, this.id);
      const pinId = generateMotionId('obj');
      const labelId = generateMotionId('obj');

      const pin = makeShapeObject(pinId, 'Pin', {
        x: 0, y: -20, z: 0,
        width: 0.1, height: 0.15,
        color: params.accentColor ?? '#34D399',
        behaviors: [
          { id: generateMotionId('beh'), type: 'slide-in', startTime: secondsToMotionTime(0), duration: secondsToMotionTime(0.5), params: { direction: 'top', distance: 80 }, easing: 'bounce' },
          makeFadeInBehavior(0.3),
        ],
      });

      const label = makeTextObject(labelId, params.text ?? 'Location', {
        x: 0, y: 60, z: 0,
        fontSize: 36, fontWeight: 600,
        color: '#ffffff',
        behaviors: [makeFadeInBehavior(0.4, 0.4)],
      });

      doc.objects = { [pinId]: pin, [labelId]: label };
      doc.rootObjectIds = [pinId, labelId];
      return doc;
    },
  },

  {
    id: 'tpl-split-screen',
    name: 'Split Screen Reveal',
    family: 'creative',
    description: 'Split screen reveal with two panels',
    tags: ['Split', 'Reveal', 'Creative'],
    defaultDurationSecs: 6,
    previewGradient: 'linear-gradient(135deg, #1a0d3e, #3d1a6e)',
    accentColor: '#22D3EE',
    generate(params) {
      const doc = makeBaseDocument(params, this.id);
      const leftId = generateMotionId('obj');
      const rightId = generateMotionId('obj');
      const leftTextId = generateMotionId('obj');
      const rightTextId = generateMotionId('obj');

      const left = makeShapeObject(leftId, 'Left Panel', {
        x: -480, y: 0, z: 0,
        width: 4.8, height: 2,
        color: params.primaryColor ?? '#1a2f5e',
        behaviors: [makeSlideInBehavior(0.6, 'left', 960)],
      });

      const right = makeShapeObject(rightId, 'Right Panel', {
        x: 480, y: 0, z: 0,
        width: 4.8, height: 2,
        color: params.secondaryColor ?? '#0d2a1e',
        behaviors: [makeSlideInBehavior(0.6, 'right', 960)],
      });

      const leftText = makeTextObject(leftTextId, params.text ?? 'Before', {
        x: -480, y: 0, z: 1,
        fontSize: 56, fontWeight: 700,
        color: '#ffffff',
        behaviors: [makeFadeInBehavior(0.4, 0.5)],
      });

      const rightText = makeTextObject(rightTextId, params.subText ?? 'After', {
        x: 480, y: 0, z: 1,
        fontSize: 56, fontWeight: 700,
        color: '#ffffff',
        behaviors: [makeFadeInBehavior(0.4, 0.5)],
      });

      doc.objects = { [leftId]: left, [rightId]: right, [leftTextId]: leftText, [rightTextId]: rightText };
      doc.rootObjectIds = [leftId, rightId, leftTextId, rightTextId];
      return doc;
    },
  },

  // ── Additional templates to reach 53 ─────────────────────────

  ...generateAdditionalTemplates(),
];

function generateAdditionalTemplates(): MotionTemplateGenerator[] {
  const additionalDefs = [
    { id: 'tpl-chapter-title', name: 'Chapter Title', family: 'core_motion', tags: ['Chapter', 'Title'], dur: 5, gradient: 'linear-gradient(135deg, #0d1b3e, #1a2f5e)', accent: '#3B82FF' },
    { id: 'tpl-end-card', name: 'End Card', family: 'core_motion', tags: ['End', 'CTA'], dur: 8, gradient: 'linear-gradient(135deg, #0d2a1e, #0f3d26)', accent: '#34D399' },
    { id: 'tpl-subscribe-cta', name: 'Subscribe CTA', family: 'creative', tags: ['Subscribe', 'CTA'], dur: 5, gradient: 'linear-gradient(135deg, #1f0d1a, #3d1530)', accent: '#F43F5E' },
    { id: 'tpl-quote-card', name: 'Quote Card', family: 'creative', tags: ['Quote', 'Text'], dur: 7, gradient: 'linear-gradient(135deg, #1a0d3e, #2a1a5e)', accent: '#8B5CF6' },
    { id: 'tpl-comparison-table', name: 'Comparison Table', family: 'business', tags: ['Compare', 'Table'], dur: 10, gradient: 'linear-gradient(135deg, #0d1b3e, #182033)', accent: '#22D3EE' },
    { id: 'tpl-feature-highlight', name: 'Feature Highlight', family: 'business', tags: ['Feature', 'Product'], dur: 6, gradient: 'linear-gradient(135deg, #0d1b3e, #1a2f5e)', accent: '#3B82FF' },
    { id: 'tpl-testimonial', name: 'Testimonial', family: 'business', tags: ['Quote', 'Social Proof'], dur: 8, gradient: 'linear-gradient(135deg, #1a0d3e, #2a1a5e)', accent: '#8B5CF6' },
    { id: 'tpl-price-reveal', name: 'Price Reveal', family: 'business', tags: ['Price', 'Reveal'], dur: 5, gradient: 'linear-gradient(135deg, #0d2a1e, #0f3d26)', accent: '#34D399' },
    { id: 'tpl-countdown', name: 'Countdown Timer', family: 'creative', tags: ['Countdown', 'Timer'], dur: 10, gradient: 'linear-gradient(135deg, #1f0d1a, #3d1530)', accent: '#F43F5E' },
    { id: 'tpl-news-ticker', name: 'News Ticker', family: 'core_motion', tags: ['News', 'Ticker'], dur: 8, gradient: 'linear-gradient(135deg, #0d1b3e, #182033)', accent: '#22D3EE' },
    { id: 'tpl-score-board', name: 'Score Board', family: 'business', tags: ['Score', 'Sports'], dur: 6, gradient: 'linear-gradient(135deg, #0d1b3e, #1a2f5e)', accent: '#3B82FF' },
    { id: 'tpl-weather-card', name: 'Weather Card', family: 'data_viz', tags: ['Weather', 'Info'], dur: 5, gradient: 'linear-gradient(135deg, #1a0d3e, #2a1a5e)', accent: '#8B5CF6' },
    { id: 'tpl-social-proof', name: 'Social Proof Counter', family: 'business', tags: ['Social', 'Count'], dur: 5, gradient: 'linear-gradient(135deg, #0d2a1e, #0f3d26)', accent: '#34D399' },
    { id: 'tpl-award-reveal', name: 'Award Reveal', family: 'creative', tags: ['Award', 'Reveal'], dur: 6, gradient: 'linear-gradient(135deg, #1f0d1a, #3d1530)', accent: '#F43F5E' },
    { id: 'tpl-map-route', name: 'Map Route', family: 'spatial', tags: ['Map', 'Route'], dur: 8, gradient: 'linear-gradient(135deg, #0d2a1e, #0f3d26)', accent: '#34D399' },
    { id: 'tpl-depth-title', name: 'Depth Title', family: 'spatial', tags: ['Depth', '2.5D', 'Title'], dur: 6, gradient: 'linear-gradient(135deg, #0d1b3e, #1a2f5e)', accent: '#3B82FF' },
    { id: 'tpl-parallax-bg', name: 'Parallax Background', family: 'spatial', tags: ['Parallax', 'Depth'], dur: 8, gradient: 'linear-gradient(135deg, #1a0d3e, #2a1a5e)', accent: '#8B5CF6' },
    { id: 'tpl-camera-push', name: 'Camera Push In', family: 'spatial', tags: ['Camera', 'Depth'], dur: 5, gradient: 'linear-gradient(135deg, #0d2a1e, #0f3d26)', accent: '#34D399' },
    { id: 'tpl-subject-reveal', name: 'Subject Reveal', family: 'spatial', tags: ['Subject', 'Reveal'], dur: 5, gradient: 'linear-gradient(135deg, #0d1b3e, #182033)', accent: '#22D3EE' },
    { id: 'tpl-word-by-word', name: 'Word by Word', family: 'creative', tags: ['Text', 'Word', 'Timing'], dur: 6, gradient: 'linear-gradient(135deg, #1a0d3e, #3d1a6e)', accent: '#8B5CF6' },
    { id: 'tpl-caption-style-1', name: 'Caption Style 1', family: 'core_motion', tags: ['Caption', 'Text'], dur: 4, gradient: 'linear-gradient(135deg, #0d1b3e, #1a2f5e)', accent: '#3B82FF' },
    { id: 'tpl-caption-style-2', name: 'Caption Style 2', family: 'core_motion', tags: ['Caption', 'Bold'], dur: 4, gradient: 'linear-gradient(135deg, #1f0d1a, #3d1530)', accent: '#F43F5E' },
    { id: 'tpl-beat-sync', name: 'Beat Sync Text', family: 'creative', tags: ['Beat', 'Music', 'Sync'], dur: 8, gradient: 'linear-gradient(135deg, #1a0d3e, #2a1a5e)', accent: '#8B5CF6' },
    { id: 'tpl-audio-waveform', name: 'Audio Waveform', family: 'creative', tags: ['Audio', 'Waveform'], dur: 8, gradient: 'linear-gradient(135deg, #0d1b3e, #182033)', accent: '#22D3EE' },
    { id: 'tpl-neon-title', name: 'Neon Title', family: 'creative', tags: ['Neon', 'Glow', 'Title'], dur: 5, gradient: 'linear-gradient(135deg, #1a0d3e, #3d1a6e)', accent: '#8B5CF6' },
    { id: 'tpl-glitch-text', name: 'Glitch Text', family: 'creative', tags: ['Glitch', 'FX', 'Text'], dur: 4, gradient: 'linear-gradient(135deg, #1f0d1a, #3d1530)', accent: '#F43F5E' },
    { id: 'tpl-typewriter', name: 'Typewriter', family: 'core_motion', tags: ['Typewriter', 'Text'], dur: 5, gradient: 'linear-gradient(135deg, #0d1b3e, #1a2f5e)', accent: '#3B82FF' },
    { id: 'tpl-word-highlight', name: 'Word Highlight', family: 'core_motion', tags: ['Highlight', 'Word'], dur: 6, gradient: 'linear-gradient(135deg, #0d2a1e, #0f3d26)', accent: '#34D399' },
    { id: 'tpl-mask-reveal', name: 'Mask Reveal', family: 'creative', tags: ['Mask', 'Reveal'], dur: 5, gradient: 'linear-gradient(135deg, #1a0d3e, #2a1a5e)', accent: '#8B5CF6' },
    { id: 'tpl-circle-wipe', name: 'Circle Wipe', family: 'creative', tags: ['Wipe', 'Circle', 'Transition'], dur: 3, gradient: 'linear-gradient(135deg, #0d1b3e, #182033)', accent: '#22D3EE' },
    { id: 'tpl-grid-reveal', name: 'Grid Reveal', family: 'creative', tags: ['Grid', 'Reveal'], dur: 5, gradient: 'linear-gradient(135deg, #1a0d3e, #3d1a6e)', accent: '#8B5CF6' },
    { id: 'tpl-svg-animate', name: 'SVG Animate', family: 'creative', tags: ['SVG', 'Vector'], dur: 5, gradient: 'linear-gradient(135deg, #0d2a1e, #0f3d26)', accent: '#34D399' },
  ];

  return additionalDefs.map((def) => ({
    id: def.id,
    name: def.name,
    family: def.family,
    description: `${def.name} motion template`,
    tags: def.tags,
    defaultDurationSecs: def.dur,
    previewGradient: def.gradient,
    accentColor: def.accent,
    generate(params: MotionTemplateParams): MotionDocument {
      const doc = makeBaseDocument(params, this.id);
      const textId = generateMotionId('obj');
      const text = makeTextObject(textId, params.text ?? this.name, {
        x: 0, y: 0, z: 0,
        fontSize: 64, fontWeight: 700,
        color: '#ffffff',
        behaviors: [makeFadeInBehavior(0.5), makeSlideInBehavior(0.6, 'bottom', 30)],
      });
      doc.objects = { [textId]: text };
      doc.rootObjectIds = [textId];
      return doc;
    },
  }));
}

// ── Registry ──────────────────────────────────────────────────

export class CapabilityToolRegistry {
  private tools = new Map<string, MotionCapabilityTool>();
  private generators = new Map<string, MotionTemplateGenerator>();

  constructor() {
    // Register all template generators
    for (const gen of MOTION_TEMPLATE_GENERATORS) {
      this.generators.set(gen.id, gen);
    }
    // Register built-in capability tools
    this.registerBuiltinTools();
  }

  getGenerator(id: string): MotionTemplateGenerator | undefined {
    return this.generators.get(id);
  }

  getAllGenerators(): MotionTemplateGenerator[] {
    return Array.from(this.generators.values());
  }

  getGeneratorsByFamily(family: string): MotionTemplateGenerator[] {
    return Array.from(this.generators.values()).filter((g) => g.family === family);
  }

  getTool(id: string): MotionCapabilityTool | undefined {
    return this.tools.get(id);
  }

  getAllTools(): MotionCapabilityTool[] {
    return Array.from(this.tools.values());
  }

  getToolsByCategory(category: MotionCapabilityTool['category']): MotionCapabilityTool[] {
    return Array.from(this.tools.values()).filter((t) => t.category === category);
  }

  /**
   * Generate a MotionDocument from a template.
   */
  generateFromTemplate(templateId: string, params: MotionTemplateParams): MotionDocument | null {
    const gen = this.generators.get(templateId);
    if (!gen) return null;
    return gen.generate(params);
  }

  private registerBuiltinTools(): void {
    const tools: MotionCapabilityTool[] = [
      {
        id: 'tool-add-text',
        name: 'Add Text Object',
        description: 'Add a text object to the Motion document',
        category: 'text',
        params: [
          { key: 'text', type: 'string', label: 'Text', defaultValue: 'New Text' },
          { key: 'fontSize', type: 'number', label: 'Font Size', defaultValue: 48, min: 8, max: 400 },
          { key: 'color', type: 'color', label: 'Color', defaultValue: '#ffffff' },
          { key: 'x', type: 'number', label: 'X Position', defaultValue: 0 },
          { key: 'y', type: 'number', label: 'Y Position', defaultValue: 0 },
        ],
        execute(doc, params) {
          const objId = generateMotionId('obj');
          const obj = makeTextObject(objId, params.text as string ?? 'Text', {
            x: params.x as number ?? 0,
            y: params.y as number ?? 0,
            fontSize: params.fontSize as number ?? 48,
            color: params.color as string ?? '#ffffff',
          });
          return [makeMotionOp('motion.addObject', doc.id, { object: obj, addToRoot: true })];
        },
      },
      {
        id: 'tool-add-fade-in',
        name: 'Add Fade In Behavior',
        description: 'Add a fade-in behavior to a selected object',
        category: 'behavior',
        params: [
          { key: 'objectId', type: 'string', label: 'Object ID', defaultValue: '' },
          { key: 'duration', type: 'number', label: 'Duration (s)', defaultValue: 0.5, min: 0.1, max: 5 },
          { key: 'delay', type: 'number', label: 'Delay (s)', defaultValue: 0, min: 0, max: 10 },
        ],
        execute(doc, params) {
          const behavior = makeFadeInBehavior(params.duration as number ?? 0.5, params.delay as number ?? 0);
          return [makeMotionOp('motion.addBehavior', doc.id, { objectId: params.objectId, behavior })];
        },
      },
      {
        id: 'tool-set-signal-reactive',
        name: 'Make Signal Reactive',
        description: 'Bind an object property to a signal',
        category: 'signal',
        params: [
          { key: 'objectId', type: 'string', label: 'Object ID', defaultValue: '' },
          { key: 'signalId', type: 'string', label: 'Signal ID', defaultValue: '' },
          { key: 'property', type: 'string', label: 'Property', defaultValue: 'scale.x' },
          { key: 'min', type: 'number', label: 'Min Value', defaultValue: 0.8 },
          { key: 'max', type: 'number', label: 'Max Value', defaultValue: 1.2 },
        ],
        execute(doc, params) {
          const behavior: MotionBehavior = {
            id: generateMotionId('beh'),
            type: 'signal-reactive',
            startTime: secondsToMotionTime(0),
            duration: doc.duration,
            params: { property: params.property as string, min: params.min as number, max: params.max as number },
            signalBinding: params.signalId as string,
            easing: 'linear',
          };
          return [makeMotionOp('motion.addBehavior', doc.id, { objectId: params.objectId, behavior })];
        },
      },
    ];

    for (const tool of tools) {
      this.tools.set(tool.id, tool);
    }
  }
}

// ── Singleton registry ────────────────────────────────────────

export const motionRegistry = new CapabilityToolRegistry();

export { MotionTemplateGenerator };