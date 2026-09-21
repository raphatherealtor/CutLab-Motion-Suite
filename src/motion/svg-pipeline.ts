/**
 * CutLab Motion SVG Import/Export Pipeline
 * SVG asset → MotionDocument → editable Studio Motion clip
 */

import type { MotionDocument, MotionObject, MotionMaterial } from './types';
import { MOTION_SCHEMA_VERSION, DEFAULT_MOTION_TRANSFORM, hexToMotionColor, secondsToMotionTime } from './types';
import { generateMotionId } from './utils';

export interface SVGImportResult {
  document: MotionDocument;
  diagnostics: SVGImportDiagnostics;
}

export interface SVGImportDiagnostics {
  elementCount: number;
  supportedElements: number;
  unsupportedElements: string[];
  warnings: string[];
  fidelityScore: number; // 0..1
}

/**
 * Import an SVG string into a MotionDocument.
 * Preserves editable structure where supported.
 */
export function importSVGToMotionDocument(
  svgString: string,
  params: {
    id: string;
    name?: string;
    durationSecs?: number;
    fps?: number;
    width?: number;
    height?: number;
  }
): SVGImportResult {
  const diagnostics: SVGImportDiagnostics = {
    elementCount: 0,
    supportedElements: 0,
    unsupportedElements: [],
    warnings: [],
    fidelityScore: 1,
  };

  const doc: MotionDocument = {
    id: params.id,
    name: params.name ?? 'Imported SVG',
    schemaVersion: MOTION_SCHEMA_VERSION,
    duration: secondsToMotionTime(params.durationSecs ?? 5),
    fps: params.fps ?? 29.97,
    width: params.width ?? 1920,
    height: params.height ?? 1080,
    objects: {},
    rootObjectIds: [],
    signals: {},
    rigs: [],
    svgSource: svgString,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  try {
    // Parse SVG using DOM parser (browser environment)
    if (typeof DOMParser !== 'undefined') {
      const parser = new DOMParser();
      const svgDoc = parser.parseFromString(svgString, 'image/svg+xml');
      const svgEl = svgDoc.documentElement;

      if (svgEl.tagName === 'parsererror') {
        diagnostics.warnings.push('SVG parse error — using raw SVG object');
        diagnostics.fidelityScore = 0.5;
      } else {
        const result = parseSVGElement(svgEl, doc, diagnostics, null);
        if (result) {
          doc.objects[result.id] = result;
          doc.rootObjectIds.push(result.id);
        }
      }
    } else {
      // Server-side: create a single SVG object with raw data
      const svgObjId = generateMotionId('svg');
      const svgObj: MotionObject = {
        id: svgObjId,
        kind: 'svg',
        name: 'SVG Import',
        depth: 0,
        transform: { ...DEFAULT_MOTION_TRANSFORM },
        keyframes: [],
        behaviors: [],
        masks: [],
        svgData: svgString,
        visible: true,
        locked: false,
      };
      doc.objects[svgObjId] = svgObj;
      doc.rootObjectIds.push(svgObjId);
      diagnostics.warnings.push('Server-side import: SVG stored as raw object');
    }
  } catch (e) {
    diagnostics.warnings.push(`Import error: ${e}`);
    diagnostics.fidelityScore = 0;
  }

  return { document: doc, diagnostics };
}

function parseSVGElement(
  el: Element,
  doc: MotionDocument,
  diagnostics: SVGImportDiagnostics,
  parentId: string | null
): MotionObject | null {
  diagnostics.elementCount++;

  const tag = el.tagName.toLowerCase();
  const id = el.getAttribute('id') ?? generateMotionId('svgobj');

  // Parse transform
  const transformStr = el.getAttribute('transform') ?? '';
  const transform = parseSVGTransform(transformStr);

  // Parse fill/stroke
  const fill = el.getAttribute('fill') ?? '#000000';
  const opacity = parseFloat(el.getAttribute('opacity') ?? '1');

  let obj: MotionObject | null = null;

  switch (tag) {
    case 'svg': case'g': {
      // Group — process children
      const groupId = generateMotionId('grp');
      const group: MotionObject = {
        id: groupId,
        kind: 'group',
        name: el.getAttribute('id') ?? 'Group',
        depth: 0,
        transform,
        keyframes: [],
        behaviors: [],
        masks: [],
        children: [],
        visible: true,
        locked: false,
      };

      for (const child of Array.from(el.children)) {
        const childObj = parseSVGElement(child, doc, diagnostics, groupId);
        if (childObj) {
          doc.objects[childObj.id] = childObj;
          group.children = [...(group.children ?? []), childObj.id];
        }
      }

      diagnostics.supportedElements++;
      obj = group;
      break;
    }

    case 'text': case'tspan': {
      const textContent = el.textContent ?? '';
      const fontSize = parseFloat(el.getAttribute('font-size') ?? '16');
      const fontWeight = parseInt(el.getAttribute('font-weight') ?? '400');

      obj = {
        id: generateMotionId('txt'),
        kind: 'text',
        name: textContent.slice(0, 20) || 'Text',
        depth: 0,
        transform,
        keyframes: [],
        behaviors: [],
        masks: [],
        material: { id: generateMotionId('mat'), type: 'flat', color: hexToMotionColor(fill === 'none' ? '#000000' : fill), opacity },
        textSegments: [{
          id: generateMotionId('seg'),
          text: textContent,
          fontSize,
          fontWeight,
          textAlign: 'left',
        }],
        visible: true,
        locked: false,
      };
      diagnostics.supportedElements++;
      break;
    }

    case 'rect': case'circle': case'ellipse': case'path': case'polygon': case'polyline': case'line': {
      const material: MotionMaterial = {
        id: generateMotionId('mat'),
        type: 'flat',
        color: hexToMotionColor(fill === 'none' ? 'transparent' : fill),
        opacity,
      };

      obj = {
        id: generateMotionId('shape'),
        kind: 'shape',
        name: tag,
        depth: 0,
        transform,
        keyframes: [],
        behaviors: [],
        masks: [],
        material,
        visible: true,
        locked: false,
      };
      diagnostics.supportedElements++;
      break;
    }

    default:
      diagnostics.unsupportedElements.push(tag);
      diagnostics.fidelityScore *= 0.95;
      break;
  }

  return obj;
}

function parseSVGTransform(transformStr: string): MotionObject['transform'] {
  const transform = { ...DEFAULT_MOTION_TRANSFORM };

  if (!transformStr) return transform;

  // Parse translate
  const translateMatch = transformStr.match(/translate\(([^)]+)\)/);
  if (translateMatch) {
    const parts = translateMatch[1].split(/[\s,]+/).map(parseFloat);
    transform.position = { x: parts[0] ?? 0, y: parts[1] ?? 0, z: 0 };
  }

  // Parse scale
  const scaleMatch = transformStr.match(/scale\(([^)]+)\)/);
  if (scaleMatch) {
    const parts = scaleMatch[1].split(/[\s,]+/).map(parseFloat);
    transform.scale = { x: parts[0] ?? 1, y: parts[1] ?? parts[0] ?? 1, z: 1 };
  }

  // Parse rotate
  const rotateMatch = transformStr.match(/rotate\(([^)]+)\)/);
  if (rotateMatch) {
    const parts = rotateMatch[1].split(/[\s,]+/).map(parseFloat);
    transform.rotation = { x: 0, y: 0, z: parts[0] ?? 0 };
  }

  return transform;
}

/**
 * Export a MotionDocument back to SVG.
 * Best-effort — preserves structure where possible.
 */
export function exportMotionDocumentToSVG(doc: MotionDocument): string {
  if (doc.svgSource) {
    // Return original SVG if available
    return doc.svgSource;
  }

  // Generate SVG from objects
  const width = doc.width;
  const height = doc.height;
  let svgContent = '';

  for (const objId of doc.rootObjectIds) {
    let obj = doc.objects[objId];
    if (obj) {
      svgContent += objectToSVG(obj, doc);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${svgContent}</svg>`;
}

function objectToSVG(obj: MotionObject, doc: MotionDocument): string {
  const { position, rotation, scale } = obj.transform;
  const transform = `translate(${position.x}, ${position.y}) rotate(${rotation.z}) scale(${scale.x}, ${scale.y})`;

  switch (obj.kind) {
    case 'text': {
      const text = obj.textSegments?.[0]?.text ?? '';
      const fontSize = obj.textSegments?.[0]?.fontSize ?? 16;
      const color = obj.material?.color ? `rgb(${Math.round(obj.material.color.r * 255)},${Math.round(obj.material.color.g * 255)},${Math.round(obj.material.color.b * 255)})` : '#000';
      return `<text transform="${transform}" font-size="${fontSize}" fill="${color}">${text}</text>`;
    }
    case 'group': {
      const children = (obj.children ?? []).map((id) => {
        const child = doc.objects[id];
        return child ? objectToSVG(child, doc) : '';
      }).join('');
      return `<g transform="${transform}">${children}</g>`;
    }
    case 'svg': {
      return obj.svgData ?? '';
    }
    default: {
      const color = obj.material?.color ? `rgb(${Math.round(obj.material.color.r * 255)},${Math.round(obj.material.color.g * 255)},${Math.round(obj.material.color.b * 255)})` : '#000';
      return `<rect transform="${transform}" width="100" height="100" fill="${color}" />`;
    }
  }
}
