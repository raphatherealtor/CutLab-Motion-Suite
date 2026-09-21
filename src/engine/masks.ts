/**
 * CutLab Mask / Region Foundation — Section 8
 * Rectangle and ellipse masks with position, size, feather, invert, stable ID.
 * Masks can be targeted by effects (e.g., blur).
 */

import type { Mask, MaskShape } from './schema';
import { generateId } from './schema';
import type { OpEnvelope } from './operations';
import { makeOp } from './operations';

// ── Mask factory ──────────────────────────────────────────────

export function createMask(
  shape: MaskShape,
  x = 0.5,
  y = 0.5,
  width = 0.3,
  height = 0.3
): Mask {
  return {
    id: generateId('mask'),
    shape,
    x,
    y,
    width,
    height,
    feather: 0,
    invert: false,
    rotation: 0,
  };
}

// ── Mask op builders ──────────────────────────────────────────

export function buildAddMaskOps(
  sequenceId: string,
  clipId: string,
  shape: MaskShape
): OpEnvelope[] {
  const mask = createMask(shape);
  return [makeOp('clip.addMask', { sequenceId, clipId, mask }, 'user')];
}

export function buildSetMaskOps(
  sequenceId: string,
  clipId: string,
  maskId: string,
  props: Partial<Mask>
): OpEnvelope[] {
  return [makeOp('clip.setMask', { sequenceId, clipId, maskId, props }, 'user')];
}

export function buildRemoveMaskOps(
  sequenceId: string,
  clipId: string,
  maskId: string
): OpEnvelope[] {
  return [makeOp('clip.removeMask', { sequenceId, clipId, maskId }, 'user')];
}

// ── Mask rendering helpers ────────────────────────────────────

/**
 * Apply a mask to a canvas context.
 * Used by the compositor to clip effect regions.
 */
export function applyMaskToCanvas(
  ctx: CanvasRenderingContext2D,
  mask: Mask,
  canvasWidth: number,
  canvasHeight: number
): void {
  const px = mask.x * canvasWidth;
  const py = mask.y * canvasHeight;
  const pw = mask.width * canvasWidth;
  const ph = mask.height * canvasHeight;

  ctx.save();
  ctx.beginPath();

  if (mask.shape === 'rectangle') {
    if (mask.rotation) {
      ctx.translate(px, py);
      ctx.rotate((mask.rotation * Math.PI) / 180);
      ctx.rect(-pw / 2, -ph / 2, pw, ph);
    } else {
      ctx.rect(px - pw / 2, py - ph / 2, pw, ph);
    }
  } else if (mask.shape === 'ellipse') {
    ctx.ellipse(px, py, pw / 2, ph / 2, (mask.rotation ?? 0) * Math.PI / 180, 0, Math.PI * 2);
  }

  if (mask.invert) {
    // Invert: clip everything OUTSIDE the shape
    ctx.rect(0, 0, canvasWidth, canvasHeight);
    ctx.clip('evenodd');
  } else {
    ctx.clip();
  }
}

/**
 * Get mask bounds in canvas pixels.
 */
export function getMaskBounds(
  mask: Mask,
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number; width: number; height: number } {
  return {
    x: (mask.x - mask.width / 2) * canvasWidth,
    y: (mask.y - mask.height / 2) * canvasHeight,
    width: mask.width * canvasWidth,
    height: mask.height * canvasHeight,
  };
}

/**
 * Hit test: is a point inside a mask?
 */
export function pointInMask(
  mask: Mask,
  px: number,
  py: number,
  canvasWidth: number,
  canvasHeight: number
): boolean {
  const mx = mask.x * canvasWidth;
  const my = mask.y * canvasHeight;
  const mw = mask.width * canvasWidth / 2;
  const mh = mask.height * canvasHeight / 2;

  if (mask.shape === 'rectangle') {
    return px >= mx - mw && px <= mx + mw && py >= my - mh && py <= my + mh;
  } else {
    // Ellipse
    const dx = (px - mx) / mw;
    const dy = (py - my) / mh;
    return dx * dx + dy * dy <= 1;
  }
}
