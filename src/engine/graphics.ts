/**
 * CutLab Graphics Track — Section 13
 * Canonical graphic items: title, lower-third, callout, image/logo, shape, stat-card.
 * Position, size, opacity, timing, z-order, text, params, keyframes, cue refs.
 * Everything is editable project data.
 */

import type { Clip, Track } from './schema';
import type { RationalTime } from './time';
import { fromSeconds } from './time';
import { generateId, DEFAULT_TRANSFORM } from './schema';
import type { OpEnvelope } from './operations';
import { makeOp } from './operations';

// ── Graphic type definitions ──────────────────────────────────

export type GraphicType = 'title' | 'lower-third' | 'callout' | 'image' | 'shape' | 'stat-card' | 'logo';

export interface GraphicTemplate {
  type: GraphicType;
  label: string;
  description: string;
  defaultParams: Record<string, string | number | boolean>;
  paramDefs: GraphicParamDef[];
}

export interface GraphicParamDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'color' | 'boolean' | 'select' | 'asset';
  default: string | number | boolean;
  options?: string[];
  keyframeEligible?: boolean;
}

export const GRAPHIC_TEMPLATES: Record<GraphicType, GraphicTemplate> = {
  title: {
    type: 'title',
    label: 'Title',
    description: 'Full-screen title card',
    defaultParams: {
      text: 'Title Text',
      fontSize: 72,
      fontWeight: 700,
      color: '#F4F7FF',
      backgroundColor: 'transparent',
      textAlign: 'center',
      x: 0.5,
      y: 0.5,
    },
    paramDefs: [
      { key: 'text', label: 'Text', type: 'text', default: 'Title Text' },
      { key: 'fontSize', label: 'Font Size', type: 'number', default: 72, keyframeEligible: true },
      { key: 'fontWeight', label: 'Font Weight', type: 'number', default: 700 },
      { key: 'color', label: 'Color', type: 'color', default: '#F4F7FF' },
      { key: 'backgroundColor', label: 'Background', type: 'color', default: 'transparent' },
      { key: 'textAlign', label: 'Align', type: 'select', default: 'center', options: ['left', 'center', 'right'] },
      { key: 'x', label: 'X', type: 'number', default: 0.5, keyframeEligible: true },
      { key: 'y', label: 'Y', type: 'number', default: 0.5, keyframeEligible: true },
    ],
  },
  'lower-third': {
    type: 'lower-third',
    label: 'Lower Third',
    description: 'Name / title lower third',
    defaultParams: {
      name: 'Speaker Name',
      title: 'Title / Role',
      accentColor: '#3B82FF',
      textColor: '#F4F7FF',
      backgroundColor: 'rgba(11,15,23,0.85)',
      x: 0.1,
      y: 0.82,
    },
    paramDefs: [
      { key: 'name', label: 'Name', type: 'text', default: 'Speaker Name' },
      { key: 'title', label: 'Title', type: 'text', default: 'Title / Role' },
      { key: 'accentColor', label: 'Accent', type: 'color', default: '#3B82FF' },
      { key: 'textColor', label: 'Text Color', type: 'color', default: '#F4F7FF' },
      { key: 'backgroundColor', label: 'Background', type: 'color', default: 'rgba(11,15,23,0.85)' },
      { key: 'x', label: 'X', type: 'number', default: 0.1, keyframeEligible: true },
      { key: 'y', label: 'Y', type: 'number', default: 0.82, keyframeEligible: true },
    ],
  },
  callout: {
    type: 'callout',
    label: 'Callout',
    description: 'Callout box with pointer',
    defaultParams: {
      text: 'Callout text',
      accentColor: '#22D3EE',
      textColor: '#F4F7FF',
      backgroundColor: 'rgba(11,15,23,0.9)',
      x: 0.7,
      y: 0.3,
    },
    paramDefs: [
      { key: 'text', label: 'Text', type: 'text', default: 'Callout text' },
      { key: 'accentColor', label: 'Accent', type: 'color', default: '#22D3EE' },
      { key: 'textColor', label: 'Text Color', type: 'color', default: '#F4F7FF' },
      { key: 'x', label: 'X', type: 'number', default: 0.7, keyframeEligible: true },
      { key: 'y', label: 'Y', type: 'number', default: 0.3, keyframeEligible: true },
    ],
  },
  image: {
    type: 'image',
    label: 'Image / Logo',
    description: 'Image or logo overlay',
    defaultParams: {
      assetId: '',
      x: 0.5,
      y: 0.5,
      width: 0.2,
      height: 0.2,
      opacity: 1,
    },
    paramDefs: [
      { key: 'assetId', label: 'Asset', type: 'asset', default: '' },
      { key: 'x', label: 'X', type: 'number', default: 0.5, keyframeEligible: true },
      { key: 'y', label: 'Y', type: 'number', default: 0.5, keyframeEligible: true },
      { key: 'width', label: 'Width', type: 'number', default: 0.2, keyframeEligible: true },
      { key: 'height', label: 'Height', type: 'number', default: 0.2, keyframeEligible: true },
      { key: 'opacity', label: 'Opacity', type: 'number', default: 1, keyframeEligible: true },
    ],
  },
  shape: {
    type: 'shape',
    label: 'Shape',
    description: 'Rectangle, circle, or line',
    defaultParams: {
      shapeType: 'rectangle',
      fillColor: '#3B82FF',
      strokeColor: 'transparent',
      strokeWidth: 0,
      x: 0.5,
      y: 0.5,
      width: 0.3,
      height: 0.1,
      borderRadius: 8,
      opacity: 1,
    },
    paramDefs: [
      { key: 'shapeType', label: 'Shape', type: 'select', default: 'rectangle', options: ['rectangle', 'ellipse', 'line'] },
      { key: 'fillColor', label: 'Fill', type: 'color', default: '#3B82FF' },
      { key: 'strokeColor', label: 'Stroke', type: 'color', default: 'transparent' },
      { key: 'strokeWidth', label: 'Stroke Width', type: 'number', default: 0 },
      { key: 'x', label: 'X', type: 'number', default: 0.5, keyframeEligible: true },
      { key: 'y', label: 'Y', type: 'number', default: 0.5, keyframeEligible: true },
      { key: 'width', label: 'Width', type: 'number', default: 0.3, keyframeEligible: true },
      { key: 'height', label: 'Height', type: 'number', default: 0.1, keyframeEligible: true },
      { key: 'opacity', label: 'Opacity', type: 'number', default: 1, keyframeEligible: true },
    ],
  },
  'stat-card': {
    type: 'stat-card',
    label: 'Stat Card',
    description: 'Statistic / metric card',
    defaultParams: {
      value: '42%',
      label: 'Metric Label',
      accentColor: '#8B5CF6',
      textColor: '#F4F7FF',
      backgroundColor: 'rgba(18,24,38,0.95)',
      x: 0.5,
      y: 0.5,
    },
    paramDefs: [
      { key: 'value', label: 'Value', type: 'text', default: '42%' },
      { key: 'label', label: 'Label', type: 'text', default: 'Metric Label' },
      { key: 'accentColor', label: 'Accent', type: 'color', default: '#8B5CF6' },
      { key: 'textColor', label: 'Text Color', type: 'color', default: '#F4F7FF' },
      { key: 'x', label: 'X', type: 'number', default: 0.5, keyframeEligible: true },
      { key: 'y', label: 'Y', type: 'number', default: 0.5, keyframeEligible: true },
    ],
  },
  logo: {
    type: 'logo',
    label: 'Logo',
    description: 'Logo placement',
    defaultParams: {
      assetId: '',
      x: 0.9,
      y: 0.1,
      width: 0.12,
      height: 0.06,
      opacity: 1,
    },
    paramDefs: [
      { key: 'assetId', label: 'Asset', type: 'asset', default: '' },
      { key: 'x', label: 'X', type: 'number', default: 0.9, keyframeEligible: true },
      { key: 'y', label: 'Y', type: 'number', default: 0.1, keyframeEligible: true },
      { key: 'width', label: 'Width', type: 'number', default: 0.12, keyframeEligible: true },
      { key: 'height', label: 'Height', type: 'number', default: 0.06, keyframeEligible: true },
      { key: 'opacity', label: 'Opacity', type: 'number', default: 1, keyframeEligible: true },
    ],
  },
};

// ── Graphic clip factory ──────────────────────────────────────

export function createGraphicClip(
  type: GraphicType,
  trackId: string,
  startTime: RationalTime,
  duration: RationalTime,
  zOrder = 0,
  cueId?: string
): Clip {
  const template = GRAPHIC_TEMPLATES[type];
  return {
    id: generateId('graphic'),
    kind: 'graphic',
    trackId,
    name: template.label,
    startTime,
    duration,
    sourceIn: { value: 0, timescale: 30000 },
    sourceOut: duration,
    transform: { ...DEFAULT_TRANSFORM },
    keyframes: [],
    effects: [],
    masks: [],
    gain: 0,
    fadeIn: { value: 0, timescale: 30000 },
    fadeOut: { value: 0, timescale: 30000 },
    speed: 1,
    reverse: false,
    freeze: false,
    disabled: false,
    graphicType: type,
    graphicParams: { ...template.defaultParams },
    zOrder,
    cueIds: cueId ? [cueId] : [],
  };
}

// ── Graphic op builders ───────────────────────────────────────

export function buildPlaceGraphicOps(
  sequenceId: string,
  type: GraphicType,
  trackId: string,
  startTime: RationalTime,
  durationSecs = 5,
  fps = 29.97,
  zOrder = 0
): OpEnvelope[] {
  const duration = fromSeconds(durationSecs, 30000);
  const clip = createGraphicClip(type, trackId, startTime, duration, zOrder);
  return [makeOp('graphic.place', { sequenceId, clip }, 'user')];
}

export function buildSetGraphicParamOps(
  sequenceId: string,
  clipId: string,
  key: string,
  value: string | number | boolean
): OpEnvelope[] {
  return [makeOp('graphic.setParam', { sequenceId, clipId, key, value }, 'user')];
}

// ── Graphic rendering ─────────────────────────────────────────

/**
 * Render a graphic clip to a canvas context.
 * Used by the compositor for preview and export.
 */
export function renderGraphicToCanvas(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  canvasWidth: number,
  canvasHeight: number,
  assets: Record<string, import('./schema').Asset>
): void {
  if (!clip.graphicParams) return;
  const p = clip.graphicParams;
  const type = clip.graphicType;

  ctx.save();

  switch (type) {
    case 'title': {
      const x = Number(p.x ?? 0.5) * canvasWidth;
      const y = Number(p.y ?? 0.5) * canvasHeight;
      const fontSize = Number(p.fontSize ?? 72) * (canvasWidth / 1920);
      ctx.font = `${p.fontWeight ?? 700} ${fontSize}px "IBM Plex Sans", sans-serif`;
      ctx.fillStyle = String(p.color ?? '#F4F7FF');
      ctx.textAlign = (p.textAlign as CanvasTextAlign) ?? 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(p.text ?? ''), x, y);
      break;
    }
    case 'lower-third': {
      const x = Number(p.x ?? 0.1) * canvasWidth;
      const y = Number(p.y ?? 0.82) * canvasHeight;
      const w = canvasWidth * 0.35;
      const h = canvasHeight * 0.08;
      // Background
      ctx.fillStyle = String(p.backgroundColor ?? 'rgba(11,15,23,0.85)');
      ctx.fillRect(x, y, w, h);
      // Accent bar
      ctx.fillStyle = String(p.accentColor ?? '#3B82FF');
      ctx.fillRect(x, y, 4, h);
      // Name
      const nameFontSize = 20 * (canvasWidth / 1920);
      ctx.font = `600 ${nameFontSize}px "IBM Plex Sans", sans-serif`;
      ctx.fillStyle = String(p.textColor ?? '#F4F7FF');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(String(p.name ?? ''), x + 16, y + 8);
      // Title
      const titleFontSize = 14 * (canvasWidth / 1920);
      ctx.font = `400 ${titleFontSize}px "IBM Plex Sans", sans-serif`;
      ctx.fillStyle = 'rgba(244,247,255,0.7)';
      ctx.fillText(String(p.title ?? ''), x + 16, y + 8 + nameFontSize + 4);
      break;
    }
    case 'callout': {
      const x = Number(p.x ?? 0.7) * canvasWidth;
      const y = Number(p.y ?? 0.3) * canvasHeight;
      const w = canvasWidth * 0.25;
      const h = canvasHeight * 0.06;
      ctx.fillStyle = String(p.backgroundColor ?? 'rgba(11,15,23,0.9)');
      roundRect(ctx, x - w / 2, y - h / 2, w, h, 8);
      ctx.fill();
      ctx.strokeStyle = String(p.accentColor ?? '#22D3EE');
      ctx.lineWidth = 2;
      roundRect(ctx, x - w / 2, y - h / 2, w, h, 8);
      ctx.stroke();
      const fontSize = 16 * (canvasWidth / 1920);
      ctx.font = `500 ${fontSize}px "IBM Plex Sans", sans-serif`;
      ctx.fillStyle = String(p.textColor ?? '#F4F7FF');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(p.text ?? ''), x, y);
      break;
    }
    case 'stat-card': {
      const x = Number(p.x ?? 0.5) * canvasWidth;
      const y = Number(p.y ?? 0.5) * canvasHeight;
      const w = canvasWidth * 0.2;
      const h = canvasHeight * 0.12;
      ctx.fillStyle = String(p.backgroundColor ?? 'rgba(18,24,38,0.95)');
      roundRect(ctx, x - w / 2, y - h / 2, w, h, 12);
      ctx.fill();
      ctx.strokeStyle = String(p.accentColor ?? '#8B5CF6');
      ctx.lineWidth = 2;
      roundRect(ctx, x - w / 2, y - h / 2, w, h, 12);
      ctx.stroke();
      const valueFontSize = 36 * (canvasWidth / 1920);
      ctx.font = `700 ${valueFontSize}px "IBM Plex Sans", sans-serif`;
      ctx.fillStyle = String(p.accentColor ?? '#8B5CF6');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(p.value ?? ''), x, y - 10 * (canvasHeight / 1080));
      const labelFontSize = 14 * (canvasWidth / 1920);
      ctx.font = `400 ${labelFontSize}px "IBM Plex Sans", sans-serif`;
      ctx.fillStyle = 'rgba(244,247,255,0.7)';
      ctx.fillText(String(p.label ?? ''), x, y + 20 * (canvasHeight / 1080));
      break;
    }
    case 'shape': {
      const x = Number(p.x ?? 0.5) * canvasWidth;
      const y = Number(p.y ?? 0.5) * canvasHeight;
      const w = Number(p.width ?? 0.3) * canvasWidth;
      const h = Number(p.height ?? 0.1) * canvasHeight;
      ctx.globalAlpha = Number(p.opacity ?? 1);
      ctx.fillStyle = String(p.fillColor ?? '#3B82FF');
      if (p.shapeType === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const r = Number(p.borderRadius ?? 8);
        roundRect(ctx, x - w / 2, y - h / 2, w, h, r);
        ctx.fill();
      }
      break;
    }
    default:
      break;
  }

  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
