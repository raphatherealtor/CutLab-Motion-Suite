/**
 * CutLab Compositor v2
 * Shared render truth for preview AND export.
 * Renders a RenderPlan to a Canvas2D context.
 * Resolves asset runtimeUrls, renders real video frames, Motion objects, graphics, captions.
 * ONE implementation used by both ViewerPanel and export pipeline.
 */

'use client';

import type { RenderPlan, RenderLayer } from './render-plan';
import type { ProjectData, Asset, Transform, Effect } from './schema';
import type { MotionDocument, MotionObject } from './motion-document';
import { evaluateMotionTransform, evaluateSignals, migrateDocumentBehaviors } from './motion-document';
import { toSeconds } from './time';

// ── Asset cache ───────────────────────────────────────────────

interface VideoCache {
  element: HTMLVideoElement;
  assetId: string;
  runtimeUrl: string;
  ready: boolean;
}

interface ImageCache {
  element: HTMLImageElement;
  assetId: string;
  runtimeUrl: string;
  ready: boolean;
}

interface SvgImageCache {
  element: HTMLImageElement;
  key: string;
  svgData: string;
  url: string;
  ready: boolean;
}

const videoCache = new Map<string, VideoCache>();
const imageCache = new Map<string, ImageCache>();
const svgImageCache = new Map<string, SvgImageCache>();

export function getOrCreateVideoElement(assetId: string, runtimeUrl: string): HTMLVideoElement {
  const cached = videoCache.get(assetId);
  if (cached && cached.runtimeUrl === runtimeUrl) return cached.element;

  // Revoke old element if URL changed
  if (cached) {
    cached.element.pause();
    cached.element.src = '';
    cached.element.load();
  }

  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true; // muted for compositor — audio handled separately
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.src = runtimeUrl;

  const entry: VideoCache = { element: video, assetId, runtimeUrl, ready: false };
  video.addEventListener('loadeddata', () => { entry.ready = true; }, { once: true });
  video.load();

  videoCache.set(assetId, entry);
  return video;
}

export function getOrCreateImageElement(assetId: string, runtimeUrl: string): HTMLImageElement {
  const cached = imageCache.get(assetId);
  if (cached && cached.runtimeUrl === runtimeUrl) return cached.element;

  const img = new Image();
  img.crossOrigin = 'anonymous';
  const entry: ImageCache = { element: img, assetId, runtimeUrl, ready: false };
  img.onload = () => { entry.ready = true; };
  img.src = runtimeUrl;

  imageCache.set(assetId, entry);
  return img;
}

/**
 * Cache an SVG data string as an Image element (data URL → decoded image).
 * SVG objects are redrawn every frame; previously a new Image + object URL was
 * created per frame (leaking object URLs) and never drawn because `img.complete`
 * is false synchronously. Caching reuses the decoded image and revokes the old
 * URL when the SVG content changes.
 */
export function getOrCreateSvgImageElement(key: string, svgData: string): HTMLImageElement {
  const cached = svgImageCache.get(key);
  if (cached && cached.svgData === svgData) return cached.element;

  if (cached) URL.revokeObjectURL(cached.url);

  const blob = new Blob([svgData], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  const entry: SvgImageCache = { element: img, key, svgData, url, ready: false };
  img.onload = () => { entry.ready = true; };
  img.src = url;

  svgImageCache.set(key, entry);
  return img;
}

export function clearCompositorCache(): void {
  for (const [, v] of videoCache) {
    v.element.pause();
    v.element.src = '';
    v.element.load();
  }
  for (const [, s] of svgImageCache) {
    URL.revokeObjectURL(s.url);
  }
  videoCache.clear();
  imageCache.clear();
  svgImageCache.clear();
}

/**
 * Drop cached video/image elements whose assets are no longer referenced by the
 * project. Keeps the element cache from growing unboundedly across a session as
 * assets are removed or relinked. The asset-owned runtimeUrl (blob URL) is NOT
 * revoked here — assets own that lifecycle.
 */
export function pruneCompositorCache(project: ProjectData): void {
  const liveAssetIds = new Set(Object.keys(project.assets ?? {}));
  for (const [assetId, v] of videoCache) {
    if (!liveAssetIds.has(assetId)) {
      v.element.pause();
      v.element.src = '';
      v.element.load();
      videoCache.delete(assetId);
    }
  }
  for (const [assetId] of imageCache) {
    if (!liveAssetIds.has(assetId)) imageCache.delete(assetId);
  }
}

// ── Seek video to exact source time ──────────────────────────

/**
 * Sub-frame seek tolerance. Consecutive frames at 24/30/60fps differ by
 * ≥16ms, so a ~1ms tolerance means every real frame change triggers a seek
 * while redundant re-renders of the SAME frame are skipped. The previous
 * 40ms tolerance was wider than a frame at 30fps, so consecutive export/scrub
 * frames never sought and video froze on its first decoded frame.
 */
const SEEK_EPSILON = 0.001;

export function seekVideoToTime(
  video: HTMLVideoElement,
  sourceTimeSecs: number
): Promise<void> {
  return new Promise((resolve) => {
    const target = Number.isFinite(sourceTimeSecs) ? Math.max(0, sourceTimeSecs) : 0;
    let settled = false;
    let onSeeked: (() => void) | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (onSeeked) video.removeEventListener('seeked', onSeeked);
      clearTimeout(timer);
      resolve();
    };

    // Fallback so a never-firing 'seeked' (same-time set, slow decode, error)
    // cannot stall a scrub or an export frame forever.
    const timer = setTimeout(finish, 300);

    const doSeek = () => {
      if (Math.abs(video.currentTime - target) < SEEK_EPSILON && video.readyState >= 2) {
        finish();
        return;
      }
      onSeeked = () => finish();
      video.addEventListener('seeked', onSeeked);
      try {
        video.currentTime = target;
      } catch {
        finish();
        return;
      }
      // Setting currentTime to its current value does not fire 'seeked'.
      if (Math.abs(video.currentTime - target) < SEEK_EPSILON) finish();
    };

    if (video.readyState < 2) {
      // Wait until the element has decoded at least one frame so the seek and
      // the subsequent drawImage have real pixels to work with (frame-zero start).
      const onReady = () => {
        video.removeEventListener('loadeddata', onReady);
        doSeek();
      };
      video.addEventListener('loadeddata', onReady);
    } else {
      doSeek();
    }
  });
}

// ── Transform application ─────────────────────────────────────

function applyTransform(
  ctx: CanvasRenderingContext2D,
  transform: Transform,
  canvasW: number,
  canvasH: number
): void {
  const cx = canvasW / 2 + transform.x;
  const cy = canvasH / 2 + transform.y;
  ctx.translate(cx, cy);
  ctx.rotate((transform.rotation * Math.PI) / 180);
  ctx.scale(transform.scaleX, transform.scaleY);
}

function applyMotionTransformCtx(
  ctx: CanvasRenderingContext2D,
  mt: import('./motion-document').MotionTransform,
  canvasW: number,
  canvasH: number
): void {
  const cx = canvasW / 2 + mt.x;
  const cy = canvasH / 2 + mt.y;
  ctx.translate(cx, cy);
  ctx.rotate((mt.rotationZ * Math.PI) / 180);
  ctx.scale(mt.scaleX, mt.scaleY);
}

// ── Effect application ────────────────────────────────────────

function applyEffects(
  ctx: CanvasRenderingContext2D,
  effects: Effect[]
): void {
  const filters: string[] = [];
  for (const effect of effects) {
    if (!effect.enabled) continue;
    switch (effect.type) {
      case 'blur':
        filters.push(`blur(${effect.params.radius ?? 0}px)`);
        break;
      case 'brightness':
        filters.push(`brightness(${effect.params.value ?? 1})`);
        break;
      case 'contrast':
        filters.push(`contrast(${effect.params.value ?? 1})`);
        break;
      case 'saturation':
        filters.push(`saturate(${effect.params.value ?? 1})`);
        break;
      case 'opacity':
        ctx.globalAlpha *= (effect.params.value as number ?? 1);
        break;
    }
  }
  if (filters.length > 0) {
    ctx.filter = filters.join(' ');
  }
}

// ── Blend mode mapping ────────────────────────────────────────

function blendModeToComposite(mode: string): GlobalCompositeOperation {
  const map: Record<string, GlobalCompositeOperation> = {
    normal: 'source-over',
    multiply: 'multiply',
    screen: 'screen',
    overlay: 'overlay',
    darken: 'darken',
    lighten: 'lighten',
    'color-dodge': 'color-dodge',
    'color-burn': 'color-burn',
    'hard-light': 'hard-light',
    'soft-light': 'soft-light',
    difference: 'difference',
    exclusion: 'exclusion',
    add: 'lighter',
  };
  return map[mode] ?? 'source-over';
}

// ── Render a single video layer ───────────────────────────────

async function renderVideoLayer(
  ctx: CanvasRenderingContext2D,
  layer: RenderLayer,
  asset: Asset,
  canvasW: number,
  canvasH: number,
  playing: boolean
): Promise<void> {
  if (!asset.runtimeUrl) return;

  const video = getOrCreateVideoElement(asset.id, asset.runtimeUrl);

  if (playing) {
    // During playback, video element is driven by the playback clock
    // Just draw current frame
    if (video.readyState >= 2) {
      drawVideoFrame(ctx, video, layer, asset, canvasW, canvasH);
    }
  } else {
    // Scrubbing / static frame — seek to exact source time
    await seekVideoToTime(video, layer.sourceTimeSecs);
    if (video.readyState >= 2) {
      drawVideoFrame(ctx, video, layer, asset, canvasW, canvasH);
    }
  }
}

function drawVideoFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  layer: RenderLayer,
  asset: Asset,
  canvasW: number,
  canvasH: number
): void {
  const t = layer.transform;
  const srcW = asset.width ?? video.videoWidth ?? canvasW;
  const srcH = asset.height ?? video.videoHeight ?? canvasH;

  // Compute crop
  const cropL = t.cropLeft * srcW;
  const cropR = t.cropRight * srcW;
  const cropT = t.cropTop * srcH;
  const cropB = t.cropBottom * srcH;
  const drawW = srcW - cropL - cropR;
  const drawH = srcH - cropT - cropB;

  if (drawW <= 0 || drawH <= 0) return;

  ctx.save();
  ctx.globalAlpha = t.opacity * layer.fadeGain * (layer.transitionAlpha ?? 1);
  applyEffects(ctx, layer.effects);
  applyTransform(ctx, t, canvasW, canvasH);

  // Draw video frame with crop
  ctx.drawImage(
    video,
    cropL, cropT, drawW, drawH,
    -drawW / 2, -drawH / 2, drawW, drawH
  );

  ctx.restore();
}

// ── Render a single image layer ───────────────────────────────

function renderImageLayer(
  ctx: CanvasRenderingContext2D,
  layer: RenderLayer,
  asset: Asset,
  canvasW: number,
  canvasH: number
): void {
  if (!asset.runtimeUrl) return;

  const img = getOrCreateImageElement(asset.id, asset.runtimeUrl);
  if (!img.complete || img.naturalWidth === 0) return;

  const t = layer.transform;
  const imgW = img.naturalWidth;
  const imgH = img.naturalHeight;

  ctx.save();
  ctx.globalAlpha = t.opacity * layer.fadeGain * (layer.transitionAlpha ?? 1);
  applyEffects(ctx, layer.effects);
  applyTransform(ctx, t, canvasW, canvasH);
  ctx.drawImage(img, -imgW / 2, -imgH / 2, imgW, imgH);
  ctx.restore();
}

// ── Render a Motion object ────────────────────────────────────

function renderMotionObject(
  ctx: CanvasRenderingContext2D,
  obj: MotionObject,
  doc: MotionDocument,
  localTimeSecs: number,
  project: ProjectData,
  canvasW: number,
  canvasH: number,
  parentAlpha = 1,
  signalValues: Record<string, number> = {}
): void {
  if (!obj.visible) return;

  // Pass signalValues into evaluateMotionTransform — behaviors + signals now animate
  const mt = evaluateMotionTransform(obj, localTimeSecs, signalValues);
  const alpha = mt.opacity * parentAlpha;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = blendModeToComposite(obj.blendMode);

  // Apply motion transform
  applyMotionTransformCtx(ctx, mt, canvasW, canvasH);

  // Apply masks (clip path)
  if (obj.masks.length > 0) {
    ctx.beginPath();
    for (const mask of obj.masks) {
      if (mask.shape === 'rectangle') {
        ctx.rect(mask.x - mask.width / 2, mask.y - mask.height / 2, mask.width, mask.height);
      } else if (mask.shape === 'ellipse') {
        ctx.ellipse(mask.x, mask.y, mask.width / 2, mask.height / 2, 0, 0, Math.PI * 2);
      } else if (mask.shape === 'path' && mask.pathData) {
        const p = new Path2D(mask.pathData);
        ctx.clip(p);
      }
    }
    ctx.clip();
  }

  switch (obj.kind) {
    case 'text': {
      renderMotionText(ctx, obj, doc, localTimeSecs, canvasW, canvasH);
      break;
    }
    case 'shape': {
      renderMotionShape(ctx, obj, doc);
      break;
    }
    case 'svg': {
      if (obj.svgData) {
        const img = getOrCreateSvgImageElement(obj.id, obj.svgData);
        if (img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
        }
      }
      break;
    }
    case 'image': {
      if (obj.assetRef) {
        const asset = project.assets[obj.assetRef];
        if (asset?.runtimeUrl) {
          const img = getOrCreateImageElement(asset.id, asset.runtimeUrl);
          if (img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
          }
        }
      }
      break;
    }
    case 'video': {
      if (obj.assetRef) {
        const asset = project.assets[obj.assetRef];
        if (asset?.runtimeUrl) {
          const video = getOrCreateVideoElement(asset.id, asset.runtimeUrl);
          // Map motion local time to video source time
          const videoTime = localTimeSecs * (obj.videoSpeed ?? 1) + (obj.videoTimeOffset ?? 0);
          // Sub-frame tolerance: a 0.1s tolerance froze Motion video objects on
          // their first decoded frame for any clip ≤10fps-adjacent time steps.
          if (Math.abs(video.currentTime - videoTime) > SEEK_EPSILON) {
            video.currentTime = Math.max(0, videoTime);
          }
          if (video.readyState >= 2) {
            ctx.drawImage(video, -video.videoWidth / 2, -video.videoHeight / 2);
          }
        }
      }
      break;
    }
    case 'group': {
      // Render children
      const childIds = obj.childIds ?? [];
      for (const childId of childIds) {
        const child = doc.objects[childId];
        if (child) {
          renderMotionObject(ctx, child, doc, localTimeSecs, project, canvasW, canvasH, alpha, signalValues);
        }
      }
      break;
    }
    case 'null-object': {
      // Null objects are invisible but affect children via transform
      const childIds = obj.childIds ?? [];
      for (const childId of childIds) {
        const child = doc.objects[childId];
        if (child) {
          renderMotionObject(ctx, child, doc, localTimeSecs, project, canvasW, canvasH, alpha, signalValues);
        }
      }
      break;
    }
  }

  ctx.restore();
}

function renderMotionText(
  ctx: CanvasRenderingContext2D,
  obj: MotionObject,
  doc: MotionDocument,
  localTimeSecs: number,
  canvasW: number,
  canvasH: number
): void {
  const fontSize = obj.fontSize ?? 48;
  const fontFamily = obj.fontFamily ?? 'sans-serif';
  const fontWeight = obj.fontWeight ?? 400;
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.textAlign = (obj.textAlign as CanvasTextAlign) ?? 'center';
  ctx.textBaseline = 'middle';

  // Determine fill color from material or direct color
  let fillColor = '#ffffff';
  if (obj.materialId && doc.materials[obj.materialId]) {
    const mat = doc.materials[obj.materialId];
    if (mat.type === 'solid' && mat.color) {
      fillColor = mat.color;
    } else if (mat.type === 'neon' && mat.neonColor) {
      fillColor = mat.neonColor;
      ctx.shadowColor = mat.neonColor;
      ctx.shadowBlur = mat.neonBlur ?? 20;
    }
  }

  // Check for active text segment
  if (obj.textSegments && obj.textSegments.length > 0) {
    const activeSegment = obj.textSegments.find((seg) => {
      const start = toSeconds(seg.startTime);
      const end = toSeconds(seg.endTime);
      return localTimeSecs >= start && localTimeSecs < end;
    });
    if (activeSegment) {
      ctx.fillStyle = activeSegment.color ?? fillColor;
      ctx.fillText(activeSegment.text, 0, 0);
      return;
    }
  }

  ctx.fillStyle = fillColor;
  const text = obj.text ?? '';
  // Handle multi-line
  const lines = text.split('\n');
  const lineH = fontSize * (obj.lineHeight ?? 1.2);
  const startY = -((lines.length - 1) * lineH) / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, 0, startY + i * lineH);
  });
}

function renderMotionShape(
  ctx: CanvasRenderingContext2D,
  obj: MotionObject,
  doc: MotionDocument
): void {
  let fillColor = obj.shapeFillColor ?? 'rgba(255,255,255,0.8)';
  let strokeColor = obj.shapeStrokeColor ?? 'transparent';

  if (obj.materialId && doc.materials[obj.materialId]) {
    const mat = doc.materials[obj.materialId];
    if (mat.type === 'solid' && mat.color) {
      fillColor = mat.color;
    } else if (mat.type === 'gradient' && mat.gradientStops) {
      // Create gradient
      const grad = ctx.createLinearGradient(-50, 0, 50, 0);
      for (const stop of mat.gradientStops) {
        grad.addColorStop(stop.offset, stop.color);
      }
      fillColor = grad as any;
    } else if (mat.type === 'neon' && mat.neonColor) {
      fillColor = mat.neonColor;
      ctx.shadowColor = mat.neonColor;
      ctx.shadowBlur = mat.neonBlur ?? 20;
    }
  }

  ctx.fillStyle = fillColor;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = obj.shapeStrokeWidth ?? 0;

  switch (obj.shapeType ?? 'rectangle') {
    case 'rectangle': {
      const w = 100, h = 60;
      const r = obj.shapeCornerRadius ?? 0;
      if (r > 0) {
        ctx.beginPath();
        ctx.roundRect(-w / 2, -h / 2, w, h, r);
      } else {
        ctx.beginPath();
        ctx.rect(-w / 2, -h / 2, w, h);
      }
      ctx.fill();
      if (ctx.lineWidth > 0) ctx.stroke();
      break;
    }
    case 'ellipse': {
      ctx.beginPath();
      ctx.ellipse(0, 0, 50, 30, 0, 0, Math.PI * 2);
      ctx.fill();
      if (ctx.lineWidth > 0) ctx.stroke();
      break;
    }
    case 'path': {
      if (obj.shapePath) {
        const p = new Path2D(obj.shapePath);
        ctx.fill(p);
        if (ctx.lineWidth > 0) ctx.stroke(p);
      }
      break;
    }
  }
}

// ── Render caption layer ──────────────────────────────────────

function renderCaptionLayer(
  ctx: CanvasRenderingContext2D,
  layer: RenderLayer,
  canvasW: number,
  canvasH: number
): void {
  if (!layer.captionText) return;

  const style = layer.captionStyle ?? {};
  const fontSize = style.fontSize ?? 32;
  const fontFamily = style.fontFamily ?? 'sans-serif';
  const color = style.color ?? '#ffffff';
  const bgColor = style.backgroundColor ?? 'rgba(0,0,0,0.6)';
  const bgOpacity = style.backgroundOpacity ?? 0.6;

  ctx.save();
  ctx.font = `${style.fontWeight ?? 600} ${fontSize}px ${fontFamily}`;
  ctx.textAlign = (style.textAlign as CanvasTextAlign) ?? 'center';
  ctx.textBaseline = 'bottom';

  const text = layer.captionText;
  const metrics = ctx.measureText(text);
  const textW = metrics.width;
  const textH = fontSize;
  const padding = 12;

  let x = canvasW / 2;
  let y = canvasH - 60;

  if (style.position === 'top') y = 60 + textH;
  else if (style.position === 'middle') y = canvasH / 2 + textH / 2;
  else if (style.position === 'custom' && style.customX !== undefined) {
    x = style.customX;
    y = style.customY ?? y;
  }

  // Background
  ctx.globalAlpha = bgOpacity;
  ctx.fillStyle = bgColor;
  ctx.fillRect(x - textW / 2 - padding, y - textH - padding / 2, textW + padding * 2, textH + padding);

  // Text
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);

  ctx.restore();
}

// ── Render graphic layer ──────────────────────────────────────

function renderGraphicLayer(
  ctx: CanvasRenderingContext2D,
  layer: RenderLayer,
  canvasW: number,
  canvasH: number
): void {
  const params = layer.graphicParams ?? {};
  const t = layer.transform;

  ctx.save();
  ctx.globalAlpha = t.opacity * layer.fadeGain * (layer.transitionAlpha ?? 1);
  applyTransform(ctx, t, canvasW, canvasH);

  switch (layer.graphicType) {
    case 'title': {
      const text = (params.text as string) ?? 'Title';
      const fontSize = (params.fontSize as number) ?? 48;
      ctx.font = `700 ${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = (params.color as string) ?? '#ffffff';
      ctx.fillText(text, 0, 0);
      break;
    }
    case 'lower-third': {
      const name = (params.name as string) ?? 'Name';
      const title = (params.title as string) ?? 'Title';
      const accentColor = (params.accentColor as string) ?? '#3B82FF';
      // Bar
      ctx.fillStyle = accentColor;
      ctx.fillRect(-200, -30, 400, 4);
      // Name
      ctx.font = '700 28px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(name, -200, -10);
      // Title
      ctx.font = '400 18px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(title, -200, 20);
      break;
    }
    case 'shape': {
      const color = (params.color as string) ?? '#3B82FF';
      const w = (params.width as number) ?? 100;
      const h = (params.height as number) ?? 60;
      ctx.fillStyle = color;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      break;
    }
    default: {
      // Generic graphic placeholder
      ctx.fillStyle = 'rgba(59,130,255,0.3)';
      ctx.strokeStyle = 'rgba(59,130,255,0.6)';
      ctx.lineWidth = 1;
      ctx.fillRect(-50, -25, 100, 50);
      ctx.strokeRect(-50, -25, 100, 50);
    }
  }

  ctx.restore();
}

// ── Transition rendering ──────────────────────────────────────

function applyTransitionEffect(
  ctx: CanvasRenderingContext2D,
  layer: RenderLayer,
  canvasW: number,
  canvasH: number
): void {
  if (layer.transitionAlpha === undefined || layer.transitionAlpha === 1) return;

  const alpha = layer.transitionAlpha;
  switch (layer.transitionType) {
    case 'dip-to-black': case'fade-to-black': case'fade-from-black': {
      ctx.save();
      ctx.globalAlpha = 1 - alpha;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.restore();
      break;
    }
    case 'dip-to-white': {
      ctx.save();
      ctx.globalAlpha = 1 - alpha;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.restore();
      break;
    }
    case 'wipe': {
      // Horizontal wipe
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = '#000000';
      ctx.fillRect(alpha * canvasW, 0, canvasW, canvasH);
      ctx.restore();
      break;
    }
  }
}

// ── Main compositor function ──────────────────────────────────

export interface CompositorOptions {
  playing?: boolean;
}

/**
 * Render a RenderPlan to a Canvas2D context.
 * This is the ONE render truth for both preview and export.
 * Returns a Promise that resolves when the frame is drawn.
 */
export async function renderFrame(
  ctx: CanvasRenderingContext2D,
  plan: RenderPlan,
  project: ProjectData,
  options: CompositorOptions = {}
): Promise<void> {
  const { width, height } = plan;
  const { playing = false } = options;

  // Clear
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  // Render layers in order
  for (const layer of plan.layers) {
    if (layer.disabled) continue;

    const asset = layer.assetId ? project.assets[layer.assetId] : null;

    switch (layer.kind) {
      case 'video': {
        if (asset && asset.runtimeUrl) {
          // Image assets are placed on the timeline as 'video' clips (MediaBin);
          // an <video> element cannot decode an image blob URL, so route them
          // through the image renderer instead of drawing a permanent black frame.
          if (asset.kind === 'image') {
            renderImageLayer(ctx, layer, asset, width, height);
          } else {
            await renderVideoLayer(ctx, layer, asset, width, height, playing);
          }
        }
        break;
      }
      case 'audio': {
        // Audio layers don't render visually
        break;
      }
      case 'motion': {
        // Render MotionDocument
        if (layer.motionBundleId) {
          const motionDoc = project.motionDocuments?.[layer.motionBundleId];
          if (motionDoc) {
            renderMotionDocument(ctx, motionDoc, layer, project, width, height);
          }
        }
        break;
      }
      case 'graphic': {
        renderGraphicLayer(ctx, layer, width, height);
        break;
      }
      case 'caption': {
        renderCaptionLayer(ctx, layer, width, height);
        break;
      }
    }

    // Apply transition effect overlay
    applyTransitionEffect(ctx, layer, width, height);
  }

  // Render active captions (from sequence captions, not clip captions)
  for (const caption of plan.activeCaptions) {
    const captionLayer: RenderLayer = {
      clipId: caption.id,
      kind: 'caption',
      sourceTimeSecs: 0,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0 },
      effects: [],
      masks: [],
      gain: 0,
      fadeGain: 1,
      disabled: false,
      zOrder: 100,
      captionText: caption.text,
      captionStyle: caption.style,
    };
    renderCaptionLayer(ctx, captionLayer, width, height);
  }
}

function renderMotionDocument(
  ctx: CanvasRenderingContext2D,
  doc: MotionDocument,
  layer: RenderLayer,
  project: ProjectData,
  canvasW: number,
  canvasH: number
): void {
  const localTimeSecs = layer.sourceTimeSecs;

  // Migrate legacy behaviors on-the-fly (no-op if already canonical)
  const migratedDoc = migrateDocumentBehaviors(doc);

  // Evaluate signals for this frame
  const signalValues = evaluateSignals(migratedDoc, localTimeSecs);

  ctx.save();
  ctx.globalAlpha = layer.transform.opacity * layer.fadeGain * (layer.transitionAlpha ?? 1);

  // Render root objects in depth order
  const rootObjects = migratedDoc.rootObjectIds
    .map((id) => migratedDoc.objects[id])
    .filter(Boolean)
    .sort((a, b) => a.depth - b.depth);

  for (const obj of rootObjects) {
    renderMotionObject(ctx, obj, migratedDoc, localTimeSecs, project, canvasW, canvasH, 1, signalValues);
  }

  ctx.restore();
}

// ── Video playback sync ───────────────────────────────────────

/**
 * Sync all video elements in the cache to the current playhead time.
 * Called when scrubbing (not playing).
 */
export async function syncVideosToTime(
  plan: RenderPlan,
  project: ProjectData
): Promise<void> {
  const videoLayers = plan.layers.filter((l) => l.kind === 'video' && l.assetId);
  const promises = videoLayers.map(async (layer) => {
    const asset = layer.assetId ? project.assets[layer.assetId] : null;
    if (!asset?.runtimeUrl) return;
    if (asset.kind === 'image') return; // images are static, not seeked video elements
    const video = getOrCreateVideoElement(asset.id, asset.runtimeUrl);
    await seekVideoToTime(video, layer.sourceTimeSecs);
  });
  await Promise.all(promises);
}

/**
 * Start playing all video elements from the current source time.
 * Called when playback begins.
 */
export function startVideoPlayback(plan: RenderPlan, project: ProjectData): void {
  for (const layer of plan.layers) {
    if (layer.kind !== 'video' || !layer.assetId) continue;
    const asset = project.assets[layer.assetId];
    if (!asset?.runtimeUrl) continue;
    if (asset.kind === 'image') continue; // images don't play — they are static layers
    const video = getOrCreateVideoElement(asset.id, asset.runtimeUrl);
    video.currentTime = layer.sourceTimeSecs;
    video.play().catch(() => {}); // ignore autoplay policy errors
  }
}

/**
 * Pause all video elements.
 */
export function pauseVideoPlayback(): void {
  for (const [, entry] of videoCache) {
    entry.element.pause();
  }
}
