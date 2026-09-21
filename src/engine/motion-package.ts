/**
 * CutLab Motion Package System
 * Canonical reusable Motion content with rich portability metadata.
 *
 * Supports: Template, Preset, Module, Recipe, Treatment, BindingKit,
 *           SpatialComposition, TextComposition, MaterialTreatment, CameraTheme
 *
 * All content remains decomposable into canonical Motion state.
 * No baked pixels. No cloud infrastructure. Local/project/repo friendly.
 */

import type { MotionDocument, MotionOp } from '@/motion/types';
import { generateMotionId } from '@/motion/utils';

// ── Package Content Types ─────────────────────────────────────

export type MotionPackageKind =
  | 'template' |'preset' |'module' |'recipe' |'treatment' |'binding-kit' |'spatial-composition' |'text-composition' |'material-treatment' |'camera-theme' |'theme';

// ── Capability Requirements ───────────────────────────────────

export interface CapabilityRequirement {
  /** Renderer tier required */
  rendererTier: 'canvas2d' | 'hybrid' | 'spatial';
  /** Analysis resources required */
  analysisRequired: Array<'audio-rms' | 'audio-beat' | 'audio-onset' | 'speech-timing' | 'subject-matte' | 'subject-tracking'>;
  /** Signal channels required */
  signalsRequired: string[];
  /** Whether subject matte is required */
  requiresSubjectMatte: boolean;
  /** Whether subject tracking is required */
  requiresSubjectTracking: boolean;
  /** Minimum canvas width */
  minWidth?: number;
  /** Minimum canvas height */
  minHeight?: number;
  /** Aspect ratio behavior */
  aspectRatioBehavior: 'fixed' | 'adaptive' | 'any';
}

// ── Editable Parameter Schema ─────────────────────────────────

export interface PackageParam {
  key: string;
  label: string;
  type: 'number' | 'string' | 'boolean' | 'color' | 'select' | 'range';
  defaultValue: number | string | boolean;
  min?: number;
  max?: number;
  options?: string[];
  description?: string;
  /** Macro range this param maps to */
  macroKey?: string;
}

// ── AI-Readable Metadata ──────────────────────────────────────

export interface PackageAIMetadata {
  /** Intended use cases */
  intendedUse: string[];
  /** Compatible target types */
  compatibleTargets: Array<'text' | 'caption' | 'title' | 'graphic' | 'subject' | 'any'>;
  /** Mood/energy descriptors */
  mood: string[];
  /** Energy level 0..1 */
  energyLevel: number;
  /** Text suitability */
  textSuitability: 'none' | 'low' | 'medium' | 'high' | 'primary';
  /** Subject requirements */
  subjectRequirements: 'none' | 'optional' | 'required';
  /** Signal requirements */
  signalRequirements: 'none' | 'optional' | 'required';
  /** Aspect adaptability */
  aspectAdaptability: 'fixed' | 'adaptive' | 'any';
  /** Scene Script contexts where this works well */
  sceneContexts: string[];
  /** Keywords for search */
  keywords: string[];
}

// ── Motion Package ────────────────────────────────────────────

export interface MotionPackage {
  id: string;
  kind: MotionPackageKind;
  name: string;
  description: string;
  /** Category for library display */
  category: string;
  /** Preview gradient for UI */
  previewGradient: string;
  /** Accent color */
  accentColor: string;
  /** Schema version */
  schemaVersion: number;
  /** Capability requirements */
  capabilities: CapabilityRequirement;
  /** Editable parameters */
  params: PackageParam[];
  /** AI-readable metadata */
  aiMetadata: PackageAIMetadata;
  /** Tags */
  tags: string[];
  /** Author */
  author?: string;
  /** Version */
  version: string;
  /** Dependencies (other package IDs) */
  dependencies: string[];
  /** Compatibility status */
  compatibilityStatus: 'compatible' | 'partial' | 'incompatible' | 'unknown';
  /** The canonical Motion ops to apply when placing this package */
  applyOps: (targetDocId: string, params: Record<string, unknown>) => MotionOp[];
  /** Generate a preview MotionDocument for live preview */
  generatePreviewDoc?: (baseDoc: MotionDocument, params: Record<string, unknown>) => MotionDocument;
  createdAt: number;
  updatedAt: number;
}

// ── Package Registry ──────────────────────────────────────────

const packageRegistry = new Map<string, MotionPackage>();

export function registerPackage(pkg: MotionPackage): void {
  packageRegistry.set(pkg.id, pkg);
}

export function getPackage(id: string): MotionPackage | null {
  return packageRegistry.get(id) ?? null;
}

export function getAllPackages(): MotionPackage[] {
  return Array.from(packageRegistry.values());
}

export function getPackagesByKind(kind: MotionPackageKind): MotionPackage[] {
  return getAllPackages().filter((p) => p.kind === kind);
}

export function getPackagesByCategory(category: string): MotionPackage[] {
  return getAllPackages().filter((p) => p.category === category);
}

export function searchPackages(query: string): MotionPackage[] {
  const q = query.toLowerCase();
  return getAllPackages().filter((p) =>
    p.name.toLowerCase().includes(q) ||
    p.description.toLowerCase().includes(q) ||
    p.tags.some((t) => t.toLowerCase().includes(q)) ||
    p.aiMetadata.keywords.some((k) => k.toLowerCase().includes(q))
  );
}

/** Find packages compatible with AI context */
export function findCompatiblePackages(
  intendedUse: string,
  sceneContext?: string,
  hasSubject?: boolean,
  hasAudio?: boolean
): MotionPackage[] {
  return getAllPackages().filter((p) => {
    const meta = p.aiMetadata;
    if (meta.intendedUse.some((u) => u.toLowerCase().includes(intendedUse.toLowerCase()))) return true;
    if (sceneContext && meta.sceneContexts.includes(sceneContext)) return true;
    if (hasSubject && meta.subjectRequirements === 'required') return true;
    if (hasAudio && meta.signalRequirements === 'required') return true;
    return false;
  });
}

// ── Built-in Packages ─────────────────────────────────────────

function makeDefaultCapabilities(tier: 'canvas2d' | 'hybrid' | 'spatial' = 'hybrid'): CapabilityRequirement {
  return {
    rendererTier: tier,
    analysisRequired: [],
    signalsRequired: [],
    requiresSubjectMatte: false,
    requiresSubjectTracking: false,
    aspectRatioBehavior: 'adaptive',
  };
}

function makeDefaultAIMeta(overrides: Partial<PackageAIMetadata> = {}): PackageAIMetadata {
  return {
    intendedUse: [],
    compatibleTargets: ['any'],
    mood: [],
    energyLevel: 0.5,
    textSuitability: 'medium',
    subjectRequirements: 'none',
    signalRequirements: 'none',
    aspectAdaptability: 'adaptive',
    sceneContexts: [],
    keywords: [],
    ...overrides,
  };
}

// Register built-in packages
const BUILTIN_PACKAGES: Omit<MotionPackage, 'applyOps' | 'generatePreviewDoc'>[] = [
  {
    id: 'pkg-semantic-depth-caption',
    kind: 'treatment',
    name: 'Semantic Depth Caption',
    description: 'Transcript-bound caption with active word depth response and emphasis scaling. Readability protected.',
    category: 'Captions',
    previewGradient: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    accentColor: '#3b82ff',
    schemaVersion: 1,
    capabilities: { ...makeDefaultCapabilities('hybrid'), analysisRequired: ['speech-timing'], signalsRequired: ['speech-active-word', 'speech-emphasis'] },
    params: [
      { key: 'depthAmount', label: 'Depth Amount', type: 'range', defaultValue: 0.4, min: 0, max: 1 },
      { key: 'emphasisScale', label: 'Emphasis Scale', type: 'range', defaultValue: 1.15, min: 1, max: 1.5 },
      { key: 'readabilityGuard', label: 'Readability Guard', type: 'boolean', defaultValue: true },
    ],
    tags: ['caption', 'semantic', 'depth', 'transcript', 'speech'],
    version: '1.0.0',
    dependencies: [],
    compatibilityStatus: 'compatible',
    aiMetadata: makeDefaultAIMeta({
      intendedUse: ['caption', 'subtitle', 'transcript display'],
      compatibleTargets: ['caption', 'text'],
      mood: ['editorial', 'clean', 'professional'],
      energyLevel: 0.4,
      textSuitability: 'primary',
      signalRequirements: 'required',
      sceneContexts: ['explanation', 'interview', 'dialogue'],
      keywords: ['caption', 'word', 'depth', 'speech', 'semantic'],
    }),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'pkg-behind-subject-caption',
    kind: 'treatment',
    name: 'Behind-Subject Editorial Caption',
    description: 'Caption with subject relation, partial occlusion, and depth separation. Subject-aware placement.',
    category: 'Captions',
    previewGradient: 'linear-gradient(135deg, #0d0d14 0%, #1a0a2e 50%, #2d1b69 100%)',
    accentColor: '#8b5cf6',
    schemaVersion: 1,
    capabilities: { ...makeDefaultCapabilities('hybrid'), requiresSubjectMatte: true, analysisRequired: ['subject-matte'] },
    params: [
      { key: 'occlusionAmount', label: 'Occlusion Amount', type: 'range', defaultValue: 0.6, min: 0, max: 1 },
      { key: 'depthSeparation', label: 'Depth Separation', type: 'range', defaultValue: 0.5, min: 0, max: 1 },
    ],
    tags: ['caption', 'subject', 'occlusion', 'depth', 'editorial'],
    version: '1.0.0',
    dependencies: [],
    compatibilityStatus: 'partial',
    aiMetadata: makeDefaultAIMeta({
      intendedUse: ['caption', 'editorial caption', 'subject-aware text'],
      compatibleTargets: ['caption', 'text'],
      mood: ['cinematic', 'editorial', 'dramatic'],
      energyLevel: 0.5,
      textSuitability: 'high',
      subjectRequirements: 'required',
      sceneContexts: ['interview', 'talking-head', 'documentary'],
      keywords: ['behind', 'subject', 'occlusion', 'editorial'],
    }),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'pkg-projector-typography',
    kind: 'treatment',
    name: 'Projector Typography',
    description: 'Layered text with cast-shadow/projector feel and camera response. Cinematic depth illusion.',
    category: 'Typography',
    previewGradient: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 50%, #1a1a1a 100%)',
    accentColor: '#f59e0b',
    schemaVersion: 1,
    capabilities: makeDefaultCapabilities('hybrid'),
    params: [
      { key: 'shadowIntensity', label: 'Shadow Intensity', type: 'range', defaultValue: 0.7, min: 0, max: 1 },
      { key: 'cameraResponse', label: 'Camera Response', type: 'range', defaultValue: 0.3, min: 0, max: 1 },
      { key: 'projectorColor', label: 'Projector Color', type: 'color', defaultValue: '#ffffff' },
    ],
    tags: ['typography', 'projector', 'shadow', 'cinematic', 'depth'],
    version: '1.0.0',
    dependencies: [],
    compatibilityStatus: 'compatible',
    aiMetadata: makeDefaultAIMeta({
      intendedUse: ['title', 'headline', 'cinematic text'],
      compatibleTargets: ['title', 'text'],
      mood: ['cinematic', 'dramatic', 'moody'],
      energyLevel: 0.6,
      textSuitability: 'primary',
      sceneContexts: ['intro', 'climax', 'emphasis-moment'],
      keywords: ['projector', 'shadow', 'cinematic', 'typography'],
    }),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'pkg-plane-stack-headline',
    kind: 'spatial-composition',
    name: 'Plane-Stack Headline',
    description: 'Multiple words/phrases across shallow depth with camera push and parallax.',
    category: 'Spatial',
    previewGradient: 'linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #0a1a2e 100%)',
    accentColor: '#06b6d4',
    schemaVersion: 1,
    capabilities: makeDefaultCapabilities('hybrid'),
    params: [
      { key: 'planeCount', label: 'Plane Count', type: 'select', defaultValue: '3', options: ['2', '3', '4', '5'] },
      { key: 'depthSpread', label: 'Depth Spread', type: 'range', defaultValue: 0.5, min: 0.1, max: 1 },
      { key: 'parallaxAmount', label: 'Parallax Amount', type: 'range', defaultValue: 0.3, min: 0, max: 1 },
      { key: 'cameraPush', label: 'Camera Push', type: 'range', defaultValue: 0.2, min: 0, max: 1 },
    ],
    tags: ['spatial', 'depth', 'parallax', 'headline', 'planes'],
    version: '1.0.0',
    dependencies: [],
    compatibilityStatus: 'compatible',
    aiMetadata: makeDefaultAIMeta({
      intendedUse: ['title', 'headline', 'spatial composition'],
      compatibleTargets: ['title', 'text', 'graphic'],
      mood: ['dynamic', 'modern', 'spatial'],
      energyLevel: 0.6,
      textSuitability: 'high',
      sceneContexts: ['intro', 'section-header', 'transition'],
      keywords: ['planes', 'depth', 'parallax', 'headline', 'spatial'],
    }),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'pkg-beat-reactive-card',
    kind: 'binding-kit',
    name: 'Beat-Reactive Card System',
    description: 'Visible audio bindings with subtle depth/scale response on beat and onset.',
    category: 'Signal Reactive',
    previewGradient: 'linear-gradient(135deg, #0a1a0a 0%, #1a2e1a 50%, #0a1a0a 100%)',
    accentColor: '#10b981',
    schemaVersion: 1,
    capabilities: { ...makeDefaultCapabilities('hybrid'), analysisRequired: ['audio-beat', 'audio-onset'], signalsRequired: ['audio-beat', 'audio-onset'] },
    params: [
      { key: 'beatScale', label: 'Beat Scale', type: 'range', defaultValue: 1.05, min: 1, max: 1.3 },
      { key: 'onsetDepth', label: 'Onset Depth', type: 'range', defaultValue: 0.15, min: 0, max: 0.5 },
      { key: 'smoothing', label: 'Smoothing', type: 'range', defaultValue: 0.3, min: 0, max: 1 },
    ],
    tags: ['audio', 'reactive', 'beat', 'onset', 'signal'],
    version: '1.0.0',
    dependencies: [],
    compatibilityStatus: 'compatible',
    aiMetadata: makeDefaultAIMeta({
      intendedUse: ['music video', 'audio reactive', 'beat sync'],
      compatibleTargets: ['graphic', 'text', 'any'],
      mood: ['energetic', 'musical', 'dynamic'],
      energyLevel: 0.7,
      textSuitability: 'medium',
      signalRequirements: 'required',
      sceneContexts: ['climax', 'high-energy', 'music'],
      keywords: ['beat', 'audio', 'reactive', 'signal', 'music'],
    }),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'pkg-corridor-stage-title',
    kind: 'spatial-composition',
    name: 'Corridor / Stage Title',
    description: 'Structured spatial environment with title moving through corridor rather than across screen.',
    category: 'Spatial',
    previewGradient: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #0a0a1a 100%)',
    accentColor: '#a78bfa',
    schemaVersion: 1,
    capabilities: makeDefaultCapabilities('hybrid'),
    params: [
      { key: 'corridorDepth', label: 'Corridor Depth', type: 'range', defaultValue: 0.7, min: 0.2, max: 1 },
      { key: 'perspectiveAmount', label: 'Perspective', type: 'range', defaultValue: 0.5, min: 0, max: 1 },
      { key: 'titlePosition', label: 'Title Position', type: 'select', defaultValue: 'center', options: ['near', 'center', 'far'] },
    ],
    tags: ['spatial', 'corridor', 'stage', 'title', 'perspective'],
    version: '1.0.0',
    dependencies: [],
    compatibilityStatus: 'compatible',
    aiMetadata: makeDefaultAIMeta({
      intendedUse: ['title', 'intro', 'cinematic opening'],
      compatibleTargets: ['title', 'text'],
      mood: ['cinematic', 'dramatic', 'architectural'],
      energyLevel: 0.65,
      textSuitability: 'high',
      sceneContexts: ['intro', 'climax', 'transition'],
      keywords: ['corridor', 'stage', 'perspective', 'spatial', 'title'],
    }),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'pkg-frame-break-emphasis',
    kind: 'treatment',
    name: 'Frame-Break Emphasis',
    description: 'Semantic emphasis causes word to break foreground frame, then return to composition.',
    category: 'Typography',
    previewGradient: 'linear-gradient(135deg, #1a0a0a 0%, #2e1a1a 50%, #1a0a0a 100%)',
    accentColor: '#ef4444',
    schemaVersion: 1,
    capabilities: { ...makeDefaultCapabilities('hybrid'), analysisRequired: ['speech-timing'], signalsRequired: ['speech-emphasis'] },
    params: [
      { key: 'breakAmount', label: 'Break Amount', type: 'range', defaultValue: 0.3, min: 0.1, max: 0.8 },
      { key: 'returnEasing', label: 'Return Easing', type: 'select', defaultValue: 'spring', options: ['spring', 'ease-out', 'bounce'] },
    ],
    tags: ['emphasis', 'frame-break', 'semantic', 'typography', 'dramatic'],
    version: '1.0.0',
    dependencies: [],
    compatibilityStatus: 'compatible',
    aiMetadata: makeDefaultAIMeta({
      intendedUse: ['emphasis', 'highlight', 'dramatic moment'],
      compatibleTargets: ['text', 'title'],
      mood: ['dramatic', 'energetic', 'bold'],
      energyLevel: 0.8,
      textSuitability: 'primary',
      signalRequirements: 'optional',
      sceneContexts: ['emphasis-moment', 'climax'],
      keywords: ['frame-break', 'emphasis', 'dramatic', 'bold'],
    }),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'pkg-wraparound-editorial',
    kind: 'spatial-composition',
    name: 'Wraparound Editorial',
    description: 'Curved/spatial text arrangement with foreground/background transition and readable central zone.',
    category: 'Spatial',
    previewGradient: 'linear-gradient(135deg, #0a1a1a 0%, #1a2e2e 50%, #0a1a1a 100%)',
    accentColor: '#14b8a6',
    schemaVersion: 1,
    capabilities: makeDefaultCapabilities('hybrid'),
    params: [
      { key: 'curvatureAmount', label: 'Curvature', type: 'range', defaultValue: 0.4, min: 0, max: 1 },
      { key: 'angularSpread', label: 'Angular Spread', type: 'range', defaultValue: 0.6, min: 0.1, max: 1 },
      { key: 'depthSpread', label: 'Depth Spread', type: 'range', defaultValue: 0.4, min: 0, max: 1 },
      { key: 'centerFocus', label: 'Center Focus', type: 'range', defaultValue: 0.7, min: 0, max: 1 },
    ],
    tags: ['wraparound', 'curved', 'spatial', 'editorial', 'typography'],
    version: '1.0.0',
    dependencies: [],
    compatibilityStatus: 'compatible',
    aiMetadata: makeDefaultAIMeta({
      intendedUse: ['editorial', 'artistic', 'spatial typography'],
      compatibleTargets: ['text', 'title', 'caption'],
      mood: ['artistic', 'editorial', 'immersive'],
      energyLevel: 0.55,
      textSuitability: 'high',
      sceneContexts: ['intro', 'artistic', 'transition'],
      keywords: ['wraparound', 'curved', 'spatial', 'editorial'],
    }),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'pkg-speaker-switch',
    kind: 'treatment',
    name: 'Speaker Switch Treatment',
    description: 'Speaker change triggers material/style shift and controlled spatial reposition.',
    category: 'Captions',
    previewGradient: 'linear-gradient(135deg, #1a0a1a 0%, #2e1a2e 50%, #1a0a1a 100%)',
    accentColor: '#ec4899',
    schemaVersion: 1,
    capabilities: { ...makeDefaultCapabilities('hybrid'), analysisRequired: ['speech-timing'], signalsRequired: ['speech-speaker'] },
    params: [
      { key: 'speaker1Color', label: 'Speaker 1 Color', type: 'color', defaultValue: '#3b82ff' },
      { key: 'speaker2Color', label: 'Speaker 2 Color', type: 'color', defaultValue: '#ec4899' },
      { key: 'transitionDuration', label: 'Transition Duration', type: 'range', defaultValue: 0.3, min: 0.1, max: 1 },
    ],
    tags: ['speaker', 'caption', 'style', 'transition', 'dialogue'],
    version: '1.0.0',
    dependencies: [],
    compatibilityStatus: 'compatible',
    aiMetadata: makeDefaultAIMeta({
      intendedUse: ['dialogue', 'interview', 'multi-speaker'],
      compatibleTargets: ['caption', 'text'],
      mood: ['conversational', 'editorial', 'clean'],
      energyLevel: 0.4,
      textSuitability: 'primary',
      signalRequirements: 'required',
      sceneContexts: ['dialogue', 'interview', 'conversation'],
      keywords: ['speaker', 'dialogue', 'switch', 'style'],
    }),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'pkg-depth-theater-explainer',
    kind: 'spatial-composition',
    name: 'Depth Theater Explainer',
    description: 'Scene Script section drives spatial panel arrangement with focus object forward and background receding.',
    category: 'Spatial',
    previewGradient: 'linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #0a1a2e 100%)',
    accentColor: '#6366f1',
    schemaVersion: 1,
    capabilities: makeDefaultCapabilities('hybrid'),
    params: [
      { key: 'panelCount', label: 'Panel Count', type: 'select', defaultValue: '3', options: ['2', '3', '4'] },
      { key: 'focusDepth', label: 'Focus Depth', type: 'range', defaultValue: 0.8, min: 0.3, max: 1 },
      { key: 'backgroundRecession', label: 'Background Recession', type: 'range', defaultValue: 0.6, min: 0, max: 1 },
    ],
    tags: ['explainer', 'depth', 'theater', 'panels', 'spatial'],
    version: '1.0.0',
    dependencies: [],
    compatibilityStatus: 'compatible',
    aiMetadata: makeDefaultAIMeta({
      intendedUse: ['explainer', 'tutorial', 'presentation'],
      compatibleTargets: ['graphic', 'text', 'any'],
      mood: ['educational', 'clean', 'structured'],
      energyLevel: 0.45,
      textSuitability: 'medium',
      sceneContexts: ['explanation', 'tutorial', 'presentation'],
      keywords: ['explainer', 'depth', 'panels', 'theater', 'spatial'],
    }),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

// Register all built-in packages
for (const pkg of BUILTIN_PACKAGES) {
  registerPackage({
    ...pkg,
    applyOps: (targetDocId: string, params: Record<string, unknown>): MotionOp[] => {
      // Return canonical ops for applying this package
      // In production these would be fully specified; here we return a document-level tag op
      return [{
        opId: generateMotionId(),
        type: 'motion.setDocumentProp',
        documentId: targetDocId,
        payload: { props: { [`package_${pkg.id}`]: JSON.stringify(params) } },
        actor: 'system',
        createdAt: Date.now(),
      }];
    },
  });
}

// ── Recipe Capture ────────────────────────────────────────────

export interface CapturedRecipe {
  id: string;
  name: string;
  description: string;
  /** The canonical ops that define this recipe */
  ops: MotionOp[];
  /** Parameters extracted from ops */
  params: PackageParam[];
  /** Compatible target types */
  compatibleTargets: string[];
  createdAt: number;
}

const capturedRecipes: CapturedRecipe[] = [];

export function captureRecipeFromOps(
  ops: MotionOp[],
  name: string,
  description: string
): CapturedRecipe {
  const recipe: CapturedRecipe = {
    id: generateMotionId(),
    name,
    description,
    ops,
    params: [],
    compatibleTargets: ['any'],
    createdAt: Date.now(),
  };
  capturedRecipes.push(recipe);
  return recipe;
}

export function getCapturedRecipes(): CapturedRecipe[] {
  return [...capturedRecipes];
}

// ── Variant System ────────────────────────────────────────────

export type VariantConstraint = {
  keep: Array<'timing' | 'text' | 'layout' | 'material' | 'motion' | 'camera'>;
  change: Array<'energy' | 'depth' | 'material' | 'choreography' | 'camera' | 'spatial'>;
};

export interface MotionVariant {
  id: string;
  label: string;
  description: string;
  /** Canonical diff ops relative to base */
  diffOps: MotionOp[];
  /** Constraint that generated this variant */
  constraint: VariantConstraint;
  /** Preview gradient */
  previewGradient: string;
}

export function generateVariants(
  baseDoc: MotionDocument,
  constraint: VariantConstraint,
  count = 3
): MotionVariant[] {
  const variants: MotionVariant[] = [];

  const energyLevels = [0.3, 0.6, 0.9];
  const depthLevels = [0.2, 0.5, 0.8];
  const gradients = [
    'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
    'linear-gradient(135deg, #0a1a0a 0%, #1a3e1a 100%)',
    'linear-gradient(135deg, #1a0a1a 0%, #3e1a3e 100%)',
  ];

  for (let i = 0; i < Math.min(count, 3); i++) {
    const ops: MotionOp[] = [];

    if (constraint.change.includes('energy')) {
      const energy = energyLevels[i];
      // Apply energy as behavior param changes
      for (const obj of Object.values(baseDoc.objects)) {
        for (const behavior of obj.behaviors) {
          ops.push({
            opId: generateMotionId(),
            type: 'motion.setBehaviorParam',
            documentId: baseDoc.id,
            payload: { objectId: obj.id, behaviorId: behavior.id, key: 'amplitude', value: energy },
            actor: 'system',
            createdAt: Date.now(),
          });
        }
      }
    }

    if (constraint.change.includes('depth')) {
      const depth = depthLevels[i];
      for (const obj of Object.values(baseDoc.objects)) {
        ops.push({
          opId: generateMotionId(),
          type: 'motion.setObjectProp',
          documentId: baseDoc.id,
          payload: { objectId: obj.id, props: { depth: obj.depth * (1 + depth) } },
          actor: 'system',
          createdAt: Date.now(),
        });
      }
    }

    variants.push({
      id: generateMotionId(),
      label: `Variant ${i + 1}`,
      description: `${constraint.change.join(', ')} variation ${i + 1}`,
      diffOps: ops,
      constraint,
      previewGradient: gradients[i],
    });
  }

  return variants;
}
