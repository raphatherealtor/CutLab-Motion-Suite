/**
 * CutLab SVG Possibility Preview
 *
 * SVG is a strong creative entry point.
 * Parse SVG structure → create MotionDocument → offer deterministic previewable possibilities.
 *
 * Structure-aware suggestions:
 * - groups → candidate depth planes
 * - repeated shapes → candidate stagger / procedural system
 * - dominant path → path animation candidate
 * - closed shape → mask candidate
 * - text elements → text choreography candidate
 * - nested groups → rig/hierarchy candidate
 *
 * Every accepted result remains editable in Motion Animator and Studio.
 */

import type { MotionDocument, MotionObject } from '@/motion/types';
import { generateMotionId } from '@/motion/utils';
import { MOTION_SCHEMA_VERSION } from '@/motion/types';

// ── SVG Structure Analysis ────────────────────────────────────

export interface SVGElement {
  id: string;
  tag: 'g' | 'path' | 'rect' | 'circle' | 'ellipse' | 'text' | 'use' | 'polygon' | 'polyline' | 'line' | 'image' | 'other';
  svgId?: string;
  label?: string;
  children: SVGElement[];
  /** Bounding box (normalized 0..1) */
  bounds?: { x: number; y: number; width: number; height: number };
  /** Path data for path elements */
  pathData?: string;
  /** Text content for text elements */
  textContent?: string;
  /** Whether this is a closed shape */
  isClosed: boolean;
  /** Whether this is a repeated shape (same tag/size as siblings) */
  isRepeated: boolean;
  /** Depth in SVG tree */
  treeDepth: number;
  /** Fill color */
  fill?: string;
  /** Stroke color */
  stroke?: string;
}

export interface SVGStructureAnalysis {
  /** Total element count */
  elementCount: number;
  /** Group count */
  groupCount: number;
  /** Path count */
  pathCount: number;
  /** Text element count */
  textCount: number;
  /** Repeated shape groups */
  repeatedShapeGroups: SVGElement[][];
  /** Dominant path (longest/most complex) */
  dominantPath: SVGElement | null;
  /** Closed shapes (mask candidates) */
  closedShapes: SVGElement[];
  /** Top-level groups (depth plane candidates) */
  topLevelGroups: SVGElement[];
  /** Nested group hierarchies (rig candidates) */
  nestedHierarchies: SVGElement[];
  /** Text elements */
  textElements: SVGElement[];
  /** Estimated canvas width */
  width: number;
  /** Estimated canvas height */
  height: number;
}

// ── SVG Parser ────────────────────────────────────────────────

export function parseSVGStructure(svgString: string): SVGStructureAnalysis {
  // Parse SVG using DOM parser (client-side only)
  let doc: Document;
  try {
    const parser = new DOMParser();
    doc = parser.parseFromString(svgString, 'image/svg+xml');
  } catch {
    return emptyAnalysis();
  }

  const svgEl = doc.querySelector('svg');
  if (!svgEl) return emptyAnalysis();

  // Get dimensions
  const width = parseFloat(svgEl.getAttribute('width') ?? svgEl.getAttribute('viewBox')?.split(' ')[2] ?? '1920');
  const height = parseFloat(svgEl.getAttribute('height') ?? svgEl.getAttribute('viewBox')?.split(' ')[3] ?? '1080');

  // Parse elements recursively
  const elements = parseElements(svgEl.children, 0, width, height);

  // Analyze structure
  const allElements = flattenElements(elements);
  const groups = allElements.filter((e) => e.tag === 'g');
  const paths = allElements.filter((e) => e.tag === 'path');
  const texts = allElements.filter((e) => e.tag === 'text');
  const closedShapes = allElements.filter((e) => e.isClosed);

  // Find repeated shapes
  const repeatedGroups = findRepeatedShapes(elements);

  // Find dominant path
  const dominantPath = paths.reduce<SVGElement | null>((best, p) => {
    const len = p.pathData?.length ?? 0;
    const bestLen = best?.pathData?.length ?? 0;
    return len > bestLen ? p : best;
  }, null);

  // Top-level groups
  const topLevelGroups = elements.filter((e) => e.tag === 'g');

  // Nested hierarchies
  const nestedHierarchies = groups.filter((g) => g.children.some((c) => c.tag === 'g'));

  return {
    elementCount: allElements.length,
    groupCount: groups.length,
    pathCount: paths.length,
    textCount: texts.length,
    repeatedShapeGroups: repeatedGroups,
    dominantPath,
    closedShapes,
    topLevelGroups,
    nestedHierarchies,
    textElements: texts,
    width,
    height,
  };
}

function emptyAnalysis(): SVGStructureAnalysis {
  return {
    elementCount: 0, groupCount: 0, pathCount: 0, textCount: 0,
    repeatedShapeGroups: [], dominantPath: null, closedShapes: [],
    topLevelGroups: [], nestedHierarchies: [], textElements: [],
    width: 1920, height: 1080,
  };
}

function parseElements(children: HTMLCollection, depth: number, svgWidth: number, svgHeight: number): SVGElement[] {
  const result: SVGElement[] = [];
  for (let i = 0; i < children.length; i++) {
    const el = children[i] as Element;
    const tag = el.tagName.toLowerCase() as SVGElement['tag'];
    const validTags: SVGElement['tag'][] = ['g', 'path', 'rect', 'circle', 'ellipse', 'text', 'use', 'polygon', 'polyline', 'line', 'image'];
    const normalizedTag = validTags.includes(tag) ? tag : 'other';

    const pathData = el.getAttribute('d') ?? undefined;
    const textContent = el.textContent?.trim() ?? undefined;
    const isClosed = pathData ? pathData.toLowerCase().includes('z') : ['rect', 'circle', 'ellipse', 'polygon'].includes(tag);

    const childElements = parseElements(el.children, depth + 1, svgWidth, svgHeight);

    result.push({
      id: generateMotionId(),
      tag: normalizedTag,
      svgId: el.getAttribute('id') ?? undefined,
      label: el.getAttribute('id') ?? el.getAttribute('class') ?? undefined,
      children: childElements,
      pathData,
      textContent: normalizedTag === 'text' ? textContent : undefined,
      isClosed,
      isRepeated: false, // Set in post-processing
      treeDepth: depth,
      fill: el.getAttribute('fill') ?? undefined,
      stroke: el.getAttribute('stroke') ?? undefined,
    });
  }
  return result;
}

function flattenElements(elements: SVGElement[]): SVGElement[] {
  const result: SVGElement[] = [];
  for (const el of elements) {
    result.push(el);
    result.push(...flattenElements(el.children));
  }
  return result;
}

function findRepeatedShapes(elements: SVGElement[]): SVGElement[][] {
  // Group siblings by tag
  const byTag = new Map<string, SVGElement[]>();
  for (const el of elements) {
    const key = el.tag;
    const arr = byTag.get(key) ?? [];
    arr.push(el);
    byTag.set(key, arr);
  }
  return Array.from(byTag.values()).filter((group) => group.length >= 3);
}

// ── SVG Possibility Types ─────────────────────────────────────

export type SVGPossibilityKind =
  | 'layered-parallax' |'group-stagger' |'path-follow' |'mask-reveal' |'depth-stack' |'camera-push' |'material-treatment' |'audio-reactive' |'speech-reactive' |'procedural-repeat' |'text-choreography' |'rig-hierarchy';

export interface SVGPossibility {
  id: string;
  kind: SVGPossibilityKind;
  label: string;
  description: string;
  /** Why this was suggested (structural reason) */
  structuralReason: string;
  /** Confidence based on structure 0..1 */
  confidence: number;
  /** Preview gradient */
  previewGradient: string;
  /** Accent color */
  accentColor: string;
  /** The MotionDocument this possibility would create */
  motionDocument: MotionDocument;
  /** Whether this requires audio analysis */
  requiresAudio: boolean;
  /** Whether this requires speech analysis */
  requiresSpeech: boolean;
  /** Whether this requires subject tracking */
  requiresSubject: boolean;
}

// ── Possibility Generator ─────────────────────────────────────

export function generateSVGPossibilities(
  svgString: string,
  analysis: SVGStructureAnalysis
): SVGPossibility[] {
  const possibilities: SVGPossibility[] = [];

  // Layered Parallax — from top-level groups
  if (analysis.topLevelGroups.length >= 2) {
    possibilities.push({
      id: generateMotionId(),
      kind: 'layered-parallax',
      label: 'Layered Parallax',
      description: `${analysis.topLevelGroups.length} groups become depth planes with parallax motion`,
      structuralReason: `${analysis.topLevelGroups.length} top-level groups detected → candidate depth planes`,
      confidence: Math.min(1, 0.5 + analysis.topLevelGroups.length * 0.1),
      previewGradient: 'linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #0a1a2e 100%)',
      accentColor: '#3b82ff',
      motionDocument: buildParallaxDocument(svgString, analysis),
      requiresAudio: false,
      requiresSpeech: false,
      requiresSubject: false,
    });
  }

  // Group Stagger — from repeated shapes
  if (analysis.repeatedShapeGroups.length > 0) {
    const group = analysis.repeatedShapeGroups[0];
    possibilities.push({
      id: generateMotionId(),
      kind: 'group-stagger',
      label: 'Group Stagger',
      description: `${group.length} repeated shapes animate with staggered timing`,
      structuralReason: `${group.length} repeated ${group[0].tag} elements → candidate stagger/procedural system`,
      confidence: Math.min(1, 0.6 + group.length * 0.05),
      previewGradient: 'linear-gradient(135deg, #0a1a0a 0%, #1a3e1a 50%, #0a1a0a 100%)',
      accentColor: '#10b981',
      motionDocument: buildStaggerDocument(svgString, analysis, group),
      requiresAudio: false,
      requiresSpeech: false,
      requiresSubject: false,
    });
  }

  // Path Follow — from dominant path
  if (analysis.dominantPath) {
    possibilities.push({
      id: generateMotionId(),
      kind: 'path-follow',
      label: 'Path Follow',
      description: 'Object follows the dominant path through the composition',
      structuralReason: `Dominant path detected (${analysis.dominantPath.pathData?.length ?? 0} chars) → path animation candidate`,
      confidence: 0.75,
      previewGradient: 'linear-gradient(135deg, #1a0a1a 0%, #3e1a3e 50%, #1a0a1a 100%)',
      accentColor: '#8b5cf6',
      motionDocument: buildPathFollowDocument(svgString, analysis),
      requiresAudio: false,
      requiresSpeech: false,
      requiresSubject: false,
    });
  }

  // Mask Reveal — from closed shapes
  if (analysis.closedShapes.length > 0) {
    possibilities.push({
      id: generateMotionId(),
      kind: 'mask-reveal',
      label: 'Mask Reveal',
      description: 'Closed shapes become animated reveal masks',
      structuralReason: `${analysis.closedShapes.length} closed shapes detected → mask candidates`,
      confidence: 0.7,
      previewGradient: 'linear-gradient(135deg, #1a1a0a 0%, #3e3e1a 50%, #1a1a0a 100%)',
      accentColor: '#f59e0b',
      motionDocument: buildMaskRevealDocument(svgString, analysis),
      requiresAudio: false,
      requiresSpeech: false,
      requiresSubject: false,
    });
  }

  // Depth Stack — from groups
  if (analysis.groupCount >= 2) {
    possibilities.push({
      id: generateMotionId(),
      kind: 'depth-stack',
      label: 'Depth Stack',
      description: 'Groups arranged as depth planes with camera push',
      structuralReason: `${analysis.groupCount} groups → candidate depth stack`,
      confidence: 0.65,
      previewGradient: 'linear-gradient(135deg, #0a1a1a 0%, #1a3e3e 50%, #0a1a1a 100%)',
      accentColor: '#06b6d4',
      motionDocument: buildDepthStackDocument(svgString, analysis),
      requiresAudio: false,
      requiresSpeech: false,
      requiresSubject: false,
    });
  }

  // Text Choreography — from text elements
  if (analysis.textElements.length > 0) {
    possibilities.push({
      id: generateMotionId(),
      kind: 'text-choreography',
      label: 'Text Choreography',
      description: `${analysis.textElements.length} text elements animate with word-level choreography`,
      structuralReason: `${analysis.textElements.length} text elements → text choreography candidate`,
      confidence: 0.8,
      previewGradient: 'linear-gradient(135deg, #1a0a0a 0%, #3e1a1a 50%, #1a0a0a 100%)',
      accentColor: '#ef4444',
      motionDocument: buildTextChoreographyDocument(svgString, analysis),
      requiresAudio: false,
      requiresSpeech: true,
      requiresSubject: false,
    });
  }

  // Audio Reactive — always available as option
  possibilities.push({
    id: generateMotionId(),
    kind: 'audio-reactive',
    label: 'Audio Reactive',
    description: 'SVG layers respond to audio RMS, beat, and onset signals',
    structuralReason: 'Audio reactive treatment available for any SVG structure',
    confidence: 0.6,
    previewGradient: 'linear-gradient(135deg, #0a1a0a 0%, #1a2e1a 50%, #0a1a0a 100%)',
    accentColor: '#22c55e',
    motionDocument: buildAudioReactiveDocument(svgString, analysis),
    requiresAudio: true,
    requiresSpeech: false,
    requiresSubject: false,
  });

  // Rig Hierarchy — from nested groups
  if (analysis.nestedHierarchies.length > 0) {
    possibilities.push({
      id: generateMotionId(),
      kind: 'rig-hierarchy',
      label: 'Rig Hierarchy',
      description: 'Nested groups become a parent-child rig system',
      structuralReason: `${analysis.nestedHierarchies.length} nested group hierarchies → rig/hierarchy candidate`,
      confidence: 0.65,
      previewGradient: 'linear-gradient(135deg, #1a1a1a 0%, #2e2e2e 50%, #1a1a1a 100%)',
      accentColor: '#94a3b8',
      motionDocument: buildRigHierarchyDocument(svgString, analysis),
      requiresAudio: false,
      requiresSpeech: false,
      requiresSubject: false,
    });
  }

  // Sort by confidence
  return possibilities.sort((a, b) => b.confidence - a.confidence);
}

// ── Document Builders ─────────────────────────────────────────

function makeBaseDocument(name: string, analysis: SVGStructureAnalysis): MotionDocument {
  return {
    id: generateMotionId(),
    name,
    schemaVersion: MOTION_SCHEMA_VERSION,
    duration: { value: 150000, timescale: 30000 }, // 5 seconds
    fps: 30,
    width: analysis.width,
    height: analysis.height,
    objects: {},
    rootObjectIds: [],
    signals: {},
    rigs: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function addSVGObject(doc: MotionDocument, name: string, svgData: string, depth: number, x = 0, y = 0): MotionDocument {
  const id = generateMotionId();
  const obj: MotionObject = {
    id,
    kind: 'svg',
    name,
    depth,
    transform: {
      position: { x, y, z: depth * 100 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      anchor: { x: 0, y: 0, z: 0 },
      opacity: 1,
    },
    keyframes: [],
    behaviors: [],
    masks: [],
    svgData,
    visible: true,
    locked: false,
  };
  return {
    ...doc,
    objects: { ...doc.objects, [id]: obj },
    rootObjectIds: [...doc.rootObjectIds, id],
  };
}

function buildParallaxDocument(svgString: string, analysis: SVGStructureAnalysis): MotionDocument {
  let doc = makeBaseDocument('SVG Layered Parallax', analysis);
  analysis.topLevelGroups.forEach((group, i) => {
    const depth = i / Math.max(1, analysis.topLevelGroups.length - 1);
    doc = addSVGObject(doc, group.label ?? `Layer ${i + 1}`, svgString, depth);
  });
  if (doc.rootObjectIds.length === 0) {
    doc = addSVGObject(doc, 'SVG Layer', svgString, 0.5);
  }
  return doc;
}

function buildStaggerDocument(svgString: string, analysis: SVGStructureAnalysis, group: SVGElement[]): MotionDocument {
  let doc = makeBaseDocument('SVG Group Stagger', analysis);
  group.slice(0, 8).forEach((el, i) => {
    const id = generateMotionId();
    const obj: MotionObject = {
      id,
      kind: 'shape',
      name: el.label ?? `Shape ${i + 1}`,
      depth: 0.5,
      transform: {
        position: { x: (i - group.length / 2) * 80, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        anchor: { x: 0, y: 0, z: 0 },
        opacity: 1,
      },
      keyframes: [],
      behaviors: [{
        id: generateMotionId(),
        type: 'fade-in',
        startTime: { value: i * 3000, timescale: 30000 },
        duration: { value: 9000, timescale: 30000 },
        params: { staggerIndex: i, staggerAmount: 0.1 },
        easing: 'spring',
      }],
      masks: [],
      visible: true,
      locked: false,
    };
    doc = { ...doc, objects: { ...doc.objects, [id]: obj }, rootObjectIds: [...doc.rootObjectIds, id] };
  });
  return doc;
}

function buildPathFollowDocument(svgString: string, analysis: SVGStructureAnalysis): MotionDocument {
  let doc = makeBaseDocument('SVG Path Follow', analysis);
  doc = addSVGObject(doc, 'Path Background', svgString, 0.2);
  // Add a follower object
  const followerId = generateMotionId();
  const follower: MotionObject = {
    id: followerId,
    kind: 'shape',
    name: 'Path Follower',
    depth: 0.8,
    transform: {
      position: { x: 0, y: 0, z: 80 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      anchor: { x: 0, y: 0, z: 0 },
      opacity: 1,
    },
    keyframes: [],
    behaviors: [{
      id: generateMotionId(),
      type: 'custom',
      startTime: { value: 0, timescale: 30000 },
      duration: { value: 150000, timescale: 30000 },
      params: { pathData: analysis.dominantPath?.pathData ?? '', followPath: true },
      easing: 'ease-in-out',
    }],
    masks: [],
    visible: true,
    locked: false,
  };
  doc = { ...doc, objects: { ...doc.objects, [followerId]: follower }, rootObjectIds: [...doc.rootObjectIds, followerId] };
  return doc;
}

function buildMaskRevealDocument(svgString: string, analysis: SVGStructureAnalysis): MotionDocument {
  let doc = makeBaseDocument('SVG Mask Reveal', analysis);
  doc = addSVGObject(doc, 'SVG Content', svgString, 0.5);
  // Add mask object
  const maskObjId = generateMotionId();
  const maskObj: MotionObject = {
    id: maskObjId,
    kind: 'mask',
    name: 'Reveal Mask',
    depth: 0.9,
    transform: {
      position: { x: 0, y: 0, z: 90 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 0, y: 1, z: 1 },
      anchor: { x: -0.5, y: 0, z: 0 },
      opacity: 1,
    },
    keyframes: [
      { id: generateMotionId(), time: { value: 0, timescale: 30000 }, property: 'scale.x', value: 0, easing: 'ease-in-out' },
      { id: generateMotionId(), time: { value: 90000, timescale: 30000 }, property: 'scale.x', value: 1, easing: 'ease-in-out' },
    ],
    behaviors: [],
    masks: [],
    visible: true,
    locked: false,
  };
  doc = { ...doc, objects: { ...doc.objects, [maskObjId]: maskObj }, rootObjectIds: [...doc.rootObjectIds, maskObjId] };
  return doc;
}

function buildDepthStackDocument(svgString: string, analysis: SVGStructureAnalysis): MotionDocument {
  let doc = makeBaseDocument('SVG Depth Stack', analysis);
  const layerCount = Math.min(analysis.groupCount, 4);
  for (let i = 0; i < layerCount; i++) {
    const depth = i / Math.max(1, layerCount - 1);
    doc = addSVGObject(doc, `Depth Layer ${i + 1}`, svgString, depth, 0, (i - layerCount / 2) * 20);
  }
  return doc;
}

function buildTextChoreographyDocument(svgString: string, analysis: SVGStructureAnalysis): MotionDocument {
  let doc = makeBaseDocument('SVG Text Choreography', analysis);
  analysis.textElements.slice(0, 6).forEach((el, i) => {
    const id = generateMotionId();
    const obj: MotionObject = {
      id,
      kind: 'text',
      name: el.textContent ?? `Text ${i + 1}`,
      depth: 0.5 + i * 0.05,
      transform: {
        position: { x: 0, y: (i - analysis.textElements.length / 2) * 60, z: 50 + i * 5 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        anchor: { x: 0, y: 0, z: 0 },
        opacity: 1,
      },
      keyframes: [],
      behaviors: [{
        id: generateMotionId(),
        type: 'word-by-word',
        startTime: { value: i * 6000, timescale: 30000 },
        duration: { value: 30000, timescale: 30000 },
        params: { stagger: 0.1, easing: 'spring' },
        easing: 'spring',
      }],
      masks: [],
      textSegments: [{ id: generateMotionId(), text: el.textContent ?? `Text ${i + 1}` }],
      visible: true,
      locked: false,
    };
    doc = { ...doc, objects: { ...doc.objects, [id]: obj }, rootObjectIds: [...doc.rootObjectIds, id] };
  });
  return doc;
}

function buildAudioReactiveDocument(svgString: string, analysis: SVGStructureAnalysis): MotionDocument {
  let doc = makeBaseDocument('SVG Audio Reactive', analysis);
  doc = {
    ...doc,
    signals: {
      'audio-rms': { id: 'audio-rms', kind: 'audio-rms', name: 'Audio RMS', range: { min: 0, max: 1 } },
      'audio-beat': { id: 'audio-beat', kind: 'audio-beat', name: 'Beat', range: { min: 0, max: 1 } },
      'audio-onset': { id: 'audio-onset', kind: 'audio-onset', name: 'Onset', range: { min: 0, max: 1 } },
    },
  };
  const layerCount = Math.min(Math.max(analysis.groupCount, 1), 4);
  for (let i = 0; i < layerCount; i++) {
    const id = generateMotionId();
    const obj: MotionObject = {
      id,
      kind: 'svg',
      name: `Audio Layer ${i + 1}`,
      depth: i / Math.max(1, layerCount - 1),
      transform: {
        position: { x: 0, y: 0, z: i * 50 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        anchor: { x: 0, y: 0, z: 0 },
        opacity: 1,
      },
      keyframes: [],
      behaviors: [{
        id: generateMotionId(),
        type: 'signal-reactive',
        startTime: { value: 0, timescale: 30000 },
        duration: { value: 150000, timescale: 30000 },
        params: { signalId: i === 0 ? 'audio-rms' : i === 1 ? 'audio-beat' : 'audio-onset', property: 'scale', gain: 0.2 + i * 0.05 },
        signalBinding: i === 0 ? 'audio-rms' : i === 1 ? 'audio-beat' : 'audio-onset',
        easing: 'linear',
      }],
      masks: [],
      svgData: svgString,
      visible: true,
      locked: false,
    };
    doc = { ...doc, objects: { ...doc.objects, [id]: obj }, rootObjectIds: [...doc.rootObjectIds, id] };
  }
  return doc;
}

function buildRigHierarchyDocument(svgString: string, analysis: SVGStructureAnalysis): MotionDocument {
  let doc = makeBaseDocument('SVG Rig Hierarchy', analysis);
  // Create parent object
  const parentId = generateMotionId();
  const parent: MotionObject = {
    id: parentId,
    kind: 'group',
    name: 'Rig Root',
    depth: 0.5,
    transform: {
      position: { x: 0, y: 0, z: 50 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      anchor: { x: 0, y: 0, z: 0 },
      opacity: 1,
    },
    keyframes: [
      { id: generateMotionId(), time: { value: 0, timescale: 30000 }, property: 'rotation.z', value: 0, easing: 'ease-in-out' },
      { id: generateMotionId(), time: { value: 150000, timescale: 30000 }, property: 'rotation.z', value: 15, easing: 'ease-in-out' },
    ],
    behaviors: [],
    masks: [],
    visible: true,
    locked: false,
  };
  doc = { ...doc, objects: { ...doc.objects, [parentId]: parent }, rootObjectIds: [...doc.rootObjectIds, parentId] };

  // Add child objects
  analysis.nestedHierarchies.slice(0, 3).forEach((group, i) => {
    const childId = generateMotionId();
    const child: MotionObject = {
      id: childId,
      kind: 'svg',
      name: group.label ?? `Child ${i + 1}`,
      depth: 0.5 + i * 0.1,
      parentId,
      transform: {
        position: { x: (i - 1) * 100, y: 0, z: i * 20 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        anchor: { x: 0, y: 0, z: 0 },
        opacity: 1,
      },
      keyframes: [],
      behaviors: [],
      masks: [],
      svgData: svgString,
      visible: true,
      locked: false,
    };
    doc = { ...doc, objects: { ...doc.objects, [childId]: child } };
  });

  return doc;
}
