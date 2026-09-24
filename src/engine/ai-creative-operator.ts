/**
 * CutLab AI Creative Operator
 *
 * The real AI editing loop:
 * USER INTENT
 * → interpret against current workspace/project context
 * → inspect available capabilities
 * → construct canonical MotionOps / Studio Ops
 * → preview transaction (no canonical state mutation)
 * → evaluate result
 * → inspect trace/diagnostics
 * → show proposal
 * → refine if requested
 * → commit or discard
 *
 * The AI has finer fingers, not a private backdoor.
 * All persistent changes use the same canonical operation paths as human edits.
 * Preview uses preview transactions — canonical state is NEVER mutated during exploration.
 */

import type { MotionOp, MotionDocument } from './motion-document';
import { applyMotionTransaction } from './motion-document';
import { evaluateMotionDocument, generateMotionId, type FrameState } from './motion-document-utils';
import type { StudioAnalysisContract } from './analysis-contract';
import type { MotionAgentContext } from './agent-context';

import { findCompatiblePackages } from './motion-package';

// ── Workspace Context for AI ──────────────────────────────────

export type AIWorkspaceKind = 'studio' | 'motion-animator';

export interface AIStudioContext {
  workspace: 'studio';
  /** Sequence clips near playhead */
  nearbyClips: Array<{ id: string; name: string; kind: string; startSecs: number; durationSecs: number }>;
  /** Transcript slice */
  transcriptSlice: Array<{ text: string; startSecs: number; speaker?: string; isFiller?: boolean }>;
  /** Active speakers */
  speakers: string[];
  /** Active cue labels */
  activeCues: string[];
  /** Scene Script region */
  sceneRegion?: { kind: string; label: string; energyLevel: string };
  /** Motion clips in sequence */
  motionClips: Array<{ id: string; name: string; motionDocumentId: string }>;
  /** Selected clip */
  selectedClipId?: string;
  /** Analysis contract */
  analysis: StudioAnalysisContract;
}

export interface AIMotionAnimatorContext {
  workspace: 'motion-animator';
  /** The MotionDocument being authored */
  motionDocument: MotionDocument;
  /** Selected object */
  selectedObjectId?: string;
  selectedObjectKind?: string;
  selectedObjectName?: string;
  /** Object hierarchy summary */
  objectCount: number;
  textObjectCount: number;
  /** Available signals */
  availableSignals: string[];
  /** Active behaviors */
  activeBehaviors: Array<{ objectId: string; behaviorType: string }>;
  /** Renderer tier */
  rendererTier: string;
  /** Analysis contract */
  analysis: StudioAnalysisContract;
  /** Motion agent context */
  motionContext: MotionAgentContext;
}

export type AIWorkspaceContext = AIStudioContext | AIMotionAnimatorContext;

// ── AI Proposal ───────────────────────────────────────────────

export type AIProposalStatus = 'pending' | 'previewing' | 'ready' | 'applied' | 'discarded' | 'refining';

export interface AIProposalWarning {
  kind: 'renderer-unsupported' | 'analysis-unavailable' | 'signal-missing' | 'subject-unavailable' | 'macro-guard' | 'readability' | 'general';
  message: string;
}

export interface AIProposedOp {
  description: string;
  targetObjectId?: string;
  targetObjectName?: string;
  opType: string;
  paramSummary: string;
}

export interface AIProposal {
  id: string;
  /** The original user intent */
  intent: string;
  /** Interpreted intent */
  interpretedIntent: string;
  /** Workspace this proposal targets */
  workspace: AIWorkspaceKind;
  /** Status */
  status: AIProposalStatus;
  /** Affected clips (Studio workspace) */
  affectedClipIds: string[];
  /** Affected Motion objects */
  affectedObjectIds: string[];
  /** Proposed operations summary */
  proposedOps: AIProposedOp[];
  /** Important parameter changes */
  parameterChanges: Array<{ param: string; from: string | number; to: string | number }>;
  /** Signals/bindings involved */
  signalsInvolved: string[];
  /** Renderer requirements */
  rendererRequirements: string[];
  /** Analysis dependencies */
  analysisDependencies: string[];
  /** Warnings */
  warnings: AIProposalWarning[];
  /** Preview FrameState (if Motion proposal) */
  previewFrameState?: FrameState;
  /** Preview evaluation trace */
  previewTrace?: AIEvaluationTrace;
  /** The actual canonical ops to apply */
  canonicalOps: MotionOp[];
  /** Self-correction iterations */
  selfCorrectionCount: number;
  /** Max self-correction iterations */
  maxSelfCorrections: number;
  createdAt: number;
  updatedAt: number;
}

// ── AI Evaluation Trace ───────────────────────────────────────

export interface AIEvaluationTrace {
  /** Did the target word/object move as expected? */
  targetMoved: boolean;
  /** Did the camera overwhelm readability? */
  cameraOverwhelmed: boolean;
  /** Were all signals available? */
  signalsAvailable: boolean;
  /** Was renderer tier supported? */
  rendererSupported: boolean;
  /** Was subject matte available? */
  subjectMatteAvailable: boolean;
  /** Did text move behind subject incorrectly? */
  textBehindSubjectIncorrect: boolean;
  /** Was macro guard active? */
  macroGuardActive: boolean;
  /** Self-correction suggestions */
  corrections: Array<{ issue: string; suggestion: string; autoApplicable: boolean }>;
  /** Overall confidence 0..1 */
  confidence: number;
}

// ── Motion Grammar Vocabulary ─────────────────────────────────

export type MotionGrammarCategory =
  | 'OBJECT' | 'STRUCTURE' | 'PROCEDURAL' | 'SIGNAL' |'CHOREOGRAPHY'| 'BEHAVIOR' | 'TRANSFORMATION' |'FORM'| 'SPACE' | 'RELATION' | 'CAMERA' |'MEANING' | 'COMPOSITION';

export interface MotionGrammarTerm {
  category: MotionGrammarCategory;
  term: string;
  description: string;
  /** Canonical op types this term compiles to */
  compilesTo: string[];
  /** Example usage */
  example?: string;
}

export const MOTION_GRAMMAR: MotionGrammarTerm[] = [
  // OBJECT
  { category: 'OBJECT', term: 'text-object', description: 'A text element with word-level timing', compilesTo: ['motion.addObject', 'motion.setTextSegment'] },
  { category: 'OBJECT', term: 'shape-object', description: 'A geometric shape', compilesTo: ['motion.addObject'] },
  { category: 'OBJECT', term: 'group-object', description: 'A container for child objects', compilesTo: ['motion.addObject'] },
  { category: 'OBJECT', term: 'camera-object', description: 'The scene camera', compilesTo: ['motion.setCamera'] },
  // STRUCTURE
  { category: 'STRUCTURE', term: 'depth-plane', description: 'Z-depth layer assignment', compilesTo: ['motion.setObjectProp'] },
  { category: 'STRUCTURE', term: 'parent-child', description: 'Hierarchical object relationship', compilesTo: ['motion.setObjectProp'] },
  { category: 'STRUCTURE', term: 'rig', description: 'Constraint-based relationship', compilesTo: ['motion.addRig'] },
  // PROCEDURAL
  { category: 'PROCEDURAL', term: 'stagger', description: 'Time-offset repetition across elements', compilesTo: ['motion.addBehavior', 'motion.setBehaviorParam'] },
  { category: 'PROCEDURAL', term: 'wave', description: 'Sinusoidal variation across elements', compilesTo: ['motion.addBehavior'] },
  { category: 'PROCEDURAL', term: 'cascade', description: 'Sequential reveal with overlap', compilesTo: ['motion.addBehavior'] },
  // SIGNAL
  { category: 'SIGNAL', term: 'audio-rms', description: 'Audio loudness signal', compilesTo: ['motion.upsertSignal'] },
  { category: 'SIGNAL', term: 'audio-beat', description: 'Beat detection signal', compilesTo: ['motion.upsertSignal'] },
  { category: 'SIGNAL', term: 'speech-active-word', description: 'Currently spoken word signal', compilesTo: ['motion.upsertSignal'] },
  { category: 'SIGNAL', term: 'speech-emphasis', description: 'Semantic emphasis signal', compilesTo: ['motion.upsertSignal'] },
  // CHOREOGRAPHY
  { category: 'CHOREOGRAPHY', term: 'word-by-word', description: 'Animate each word in sequence', compilesTo: ['motion.addBehavior'] },
  { category: 'CHOREOGRAPHY', term: 'depth-step', description: 'Word steps forward in Z', compilesTo: ['motion.addBehavior', 'motion.upsertKeyframe'] },
  { category: 'CHOREOGRAPHY', term: 'punch', description: 'Scale impulse on emphasis', compilesTo: ['motion.addBehavior'] },
  { category: 'CHOREOGRAPHY', term: 'settle', description: 'Return to rest position', compilesTo: ['motion.addBehavior'] },
  // BEHAVIOR
  { category: 'BEHAVIOR', term: 'signal-reactive', description: 'Property driven by signal', compilesTo: ['motion.addBehavior', 'motion.upsertSignal'] },
  { category: 'BEHAVIOR', term: 'spring', description: 'Spring physics behavior', compilesTo: ['motion.addBehavior'] },
  { category: 'BEHAVIOR', term: 'orbit', description: 'Circular motion behavior', compilesTo: ['motion.addBehavior'] },
  // TRANSFORMATION
  { category: 'TRANSFORMATION', term: 'scale', description: 'Size change', compilesTo: ['motion.setObjectTransform', 'motion.upsertKeyframe'] },
  { category: 'TRANSFORMATION', term: 'translate', description: 'Position change', compilesTo: ['motion.setObjectTransform', 'motion.upsertKeyframe'] },
  { category: 'TRANSFORMATION', term: 'rotate', description: 'Rotation change', compilesTo: ['motion.setObjectTransform', 'motion.upsertKeyframe'] },
  // FORM
  { category: 'FORM', term: 'material', description: 'Surface appearance', compilesTo: ['motion.setMaterial'] },
  { category: 'FORM', term: 'chrome', description: 'Metallic chrome material', compilesTo: ['motion.setMaterial'] },
  { category: 'FORM', term: 'glass', description: 'Glass/transparent material', compilesTo: ['motion.setMaterial'] },
  { category: 'FORM', term: 'neon', description: 'Neon glow material', compilesTo: ['motion.setMaterial'] },
  // SPACE
  { category: 'SPACE', term: 'parallax', description: 'Depth-based parallax motion', compilesTo: ['motion.setObjectProp', 'motion.addBehavior'] },
  { category: 'SPACE', term: 'camera-push', description: 'Camera moves toward scene', compilesTo: ['motion.setCamera', 'motion.upsertKeyframe'] },
  { category: 'SPACE', term: 'depth-crossing', description: 'Object crosses depth planes', compilesTo: ['motion.upsertKeyframe'] },
  // RELATION
  { category: 'RELATION', term: 'behind-subject', description: 'Object placed behind subject', compilesTo: ['motion.setObjectProp'] },
  { category: 'RELATION', term: 'in-front-of-subject', description: 'Object placed in front of subject', compilesTo: ['motion.setObjectProp'] },
  { category: 'RELATION', term: 'occlusion', description: 'Partial visibility from depth', compilesTo: ['motion.setObjectProp', 'motion.addMask'] },
  // CAMERA
  { category: 'CAMERA', term: 'camera-drift', description: 'Slow ambient camera movement', compilesTo: ['motion.setCamera', 'motion.addBehavior'] },
  { category: 'CAMERA', term: 'camera-pull', description: 'Camera moves away from scene', compilesTo: ['motion.setCamera', 'motion.upsertKeyframe'] },
  { category: 'CAMERA', term: 'dof', description: 'Depth of field blur', compilesTo: ['motion.setCamera'] },
  // MEANING
  { category: 'MEANING', term: 'semantic-emphasis', description: 'Emphasis derived from transcript', compilesTo: ['motion.upsertSignal', 'motion.addBehavior'] },
  { category: 'MEANING', term: 'scene-script-region', description: 'Scene Script context drives behavior', compilesTo: ['motion.addBehavior'] },
  { category: 'MEANING', term: 'speaker-identity', description: 'Speaker-specific styling', compilesTo: ['motion.setMaterial', 'motion.addBehavior'] },
  // COMPOSITION
  { category: 'COMPOSITION', term: 'readability-guard', description: 'Constrains motion to preserve readability', compilesTo: ['motion.setBehaviorParam'] },
  { category: 'COMPOSITION', term: 'depth-theater', description: 'Multi-plane spatial arrangement', compilesTo: ['motion.setObjectProp', 'motion.setCamera'] },
  { category: 'COMPOSITION', term: 'frame-break', description: 'Element intentionally crosses frame boundary', compilesTo: ['motion.upsertKeyframe'] },
];

// ── Intent Parser ─────────────────────────────────────────────

export interface ParsedIntent {
  /** Primary action */
  action: string;
  /** Target description */
  target: string;
  /** Grammar terms identified */
  grammarTerms: MotionGrammarTerm[];
  /** Parameters extracted */
  params: Record<string, string | number | boolean>;
  /** Confidence 0..1 */
  confidence: number;
  /** Workspace this intent targets */
  targetWorkspace: AIWorkspaceKind;
}

export function parseIntent(
  input: string,
  workspaceContext: AIWorkspaceContext
): ParsedIntent {
  const lower = input.toLowerCase();

  // Find matching grammar terms
  const matchedTerms: MotionGrammarTerm[] = [];
  for (const term of MOTION_GRAMMAR) {
    if (lower.includes(term.term.replace(/-/g, ' ')) || lower.includes(term.term)) {
      matchedTerms.push(term);
    }
  }

  // Extract common patterns
  const params: Record<string, string | number | boolean> = {};

  // Look for quoted text targets
  const quotedMatch = input.match(/"([^"]+)"/);
  if (quotedMatch) params.targetText = quotedMatch[1];

  // Look for numeric values
  const numMatch = input.match(/\b(\d+(?:\.\d+)?)\b/);
  if (numMatch) params.numericValue = parseFloat(numMatch[1]);

  // Determine action
  let action = 'modify';
  if (lower.includes('add') || lower.includes('create')) action = 'add';
  if (lower.includes('remove') || lower.includes('delete')) action = 'remove';
  if (lower.includes('make') || lower.includes('set')) action = 'set';
  if (lower.includes('animate') || lower.includes('move')) action = 'animate';
  if (lower.includes('bind') || lower.includes('connect')) action = 'bind';
  if (lower.includes('apply') || lower.includes('use')) action = 'apply';

  // Determine target
  let target = 'selection';
  if (lower.includes('word') || lower.includes('text')) target = 'text';
  if (lower.includes('camera')) target = 'camera';
  if (lower.includes('material') || lower.includes('chrome') || lower.includes('glass')) target = 'material';
  if (lower.includes('signal') || lower.includes('audio') || lower.includes('beat')) target = 'signal';
  if (params.targetText) target = `"${params.targetText}"`;

  const targetWorkspace = workspaceContext.workspace;

  return {
    action,
    target,
    grammarTerms: matchedTerms,
    params,
    confidence: matchedTerms.length > 0 ? 0.7 + Math.min(0.3, matchedTerms.length * 0.05) : 0.4,
    targetWorkspace,
  };
}

// ── Proposal Builder ──────────────────────────────────────────

export function buildProposal(
  intent: string,
  parsedIntent: ParsedIntent,
  workspaceContext: AIWorkspaceContext,
  doc: MotionDocument | null
): AIProposal {
  const proposalId = generateMotionId();
  const warnings: AIProposalWarning[] = [];
  const proposedOps: AIProposedOp[] = [];
  const canonicalOps: MotionOp[] = [];
  const affectedObjectIds: string[] = [];
  const signalsInvolved: string[] = [];
  const analysisDependencies: string[] = [];
  const rendererRequirements: string[] = ['hybrid'];

  // Check analysis availability
  const analysis = workspaceContext.analysis;
  if (!analysis.availability.hasTranscript && parsedIntent.grammarTerms.some((t) => t.category === 'MEANING')) {
    warnings.push({ kind: 'analysis-unavailable', message: 'Transcript not available — semantic targeting will use fixture data' });
  }
  if (!analysis.availability.hasSubjectTracking && parsedIntent.grammarTerms.some((t) => t.term === 'behind-subject' || t.term === 'in-front-of-subject')) {
    warnings.push({ kind: 'subject-unavailable', message: 'Subject tracking unavailable — subject-relative placement will use fallback' });
  }

  // Build ops based on grammar terms
  if (doc) {
    const targetObjectIds = workspaceContext.workspace === 'motion-animator'
      ? [(workspaceContext as AIMotionAnimatorContext).selectedObjectId].filter(Boolean) as string[]
      : Object.keys(doc.objects).slice(0, 3);

    for (const term of parsedIntent.grammarTerms) {
      for (const objId of targetObjectIds) {
        const obj = doc.objects[objId];
        if (!obj) continue;

        affectedObjectIds.push(objId);

        if (term.category === 'FORM' && (term.term === 'chrome' || term.term === 'glass' || term.term === 'neon')) {
          const materialType = term.term === 'chrome' ? 'metal' : term.term === 'glass' ? 'glass' : 'neon';
          const op: MotionOp = {
            opId: generateMotionId(),
            type: 'motion.setMaterial',
            documentId: doc.id,
            payload: { objectId: objId, material: { id: generateMotionId(), name: term.term, type: materialType } },
            actor: 'ai',
            createdAt: Date.now(),
          };
          canonicalOps.push(op);
          proposedOps.push({
            description: `Apply ${term.term} material to "${obj.name}"`,
            targetObjectId: objId,
            targetObjectName: obj.name,
            opType: 'motion.setMaterial',
            paramSummary: `type: ${materialType}`,
          });
        }

        if (term.term === 'depth-step' && (term.category === 'CHOREOGRAPHY' || term.category === 'SPACE')) {
          const op: MotionOp = {
            opId: generateMotionId(),
            type: 'motion.setObjectProp',
            documentId: doc.id,
            payload: { objectId: objId, props: { depth: (obj.depth ?? 0) + 0.3 } },
            actor: 'ai',
            createdAt: Date.now(),
          };
          canonicalOps.push(op);
          proposedOps.push({
            description: `Step "${obj.name}" forward in depth`,
            targetObjectId: objId,
            targetObjectName: obj.name,
            opType: 'motion.setObjectProp',
            paramSummary: `depth: ${((obj.depth ?? 0) + 0.3).toFixed(2)}`,
          });
        }

        if (term.category === 'CHOREOGRAPHY' && term.term === 'punch') {
          const op: MotionOp = {
            opId: generateMotionId(),
            type: 'motion.addBehavior',
            documentId: doc.id,
            payload: {
              objectId: objId,
              behavior: {
                id: generateMotionId(),
                type: 'pulse',
                startTime: { value: 0, timescale: 30000 },
                duration: { value: 9000, timescale: 30000 },
                params: { amplitude: 0.15, frequency: 1, easing: 'spring' },
                easing: 'spring',
              },
            },
            actor: 'ai',
            createdAt: Date.now(),
          };
          canonicalOps.push(op);
          proposedOps.push({
            description: `Add punch behavior to "${obj.name}"`,
            targetObjectId: objId,
            targetObjectName: obj.name,
            opType: 'motion.addBehavior',
            paramSummary: 'type: pulse, amplitude: 0.15',
          });
        }

        if (term.category === 'SIGNAL') {
          signalsInvolved.push(term.term);
          analysisDependencies.push(term.term.startsWith('audio') ? 'audio-analysis' : 'speech-timing');
          // Canonical signal contract: kind carries the channel id so the
          // engine channel resolver evaluates it live (audio-rms / audio-beat /
          // speech-active-word / speech-emphasis all resolve).
          const signalOp: MotionOp = {
            opId: generateMotionId(),
            type: 'motion.upsertSignal',
            documentId: doc.id,
            payload: {
              signal: {
                id: term.term,
                type: 'number',
                name: term.term,
                kind: term.term,
                defaultValue: 0,
              },
            },
            actor: 'ai',
            createdAt: Date.now(),
          };
          canonicalOps.push(signalOp);
          // The signal only matters if something is driven by it — bind a
          // signal-reactive behavior on the target object in the same proposal.
          const behaviorOp: MotionOp = {
            opId: generateMotionId(),
            type: 'motion.addBehavior',
            documentId: doc.id,
            payload: {
              objectId: objId,
              behavior: {
                id: generateMotionId(),
                type: 'signal-reactive',
                startTime: { value: 0, timescale: 30000 },
                duration: doc.duration,
                params: { property: 'scaleX', min: 0.9, max: 1.15 },
                signalBinding: term.term,
                easing: 'ease-out',
              },
            },
            actor: 'ai',
            createdAt: Date.now(),
          };
          canonicalOps.push(behaviorOp);
          proposedOps.push({
            description: `Bind signal "${term.term}" and drive "${obj.name}" scale`,
            targetObjectId: objId,
            targetObjectName: obj.name,
            opType: 'motion.upsertSignal',
            paramSummary: `channel: ${term.term} → signal-reactive scaleX`,
          });
        }
      }
    }

    // Check for compatible library packages
    const compatiblePkgs = findCompatiblePackages(parsedIntent.target, undefined, false, analysis.availability.hasAudioAnalysis);
    if (compatiblePkgs.length > 0 && canonicalOps.length === 0) {
      const pkg = compatiblePkgs[0];
      proposedOps.push({
        description: `Apply library package: "${pkg.name}"`,
        opType: 'package.apply',
        paramSummary: `id: ${pkg.id}`,
      });
    }
  }

  // If no ops were built, add a general note
  if (proposedOps.length === 0) {
    warnings.push({ kind: 'general', message: 'Could not map intent to specific canonical operations — please refine the request' });
  }

  return {
    id: proposalId,
    intent,
    interpretedIntent: `${parsedIntent.action} ${parsedIntent.target} using ${parsedIntent.grammarTerms.map((t) => t.term).join(', ') || 'general motion'}`,
    workspace: parsedIntent.targetWorkspace,
    status: 'ready',
    affectedClipIds: [],
    affectedObjectIds: Array.from(new Set(affectedObjectIds)),
    proposedOps,
    parameterChanges: [],
    signalsInvolved: Array.from(new Set(signalsInvolved)),
    rendererRequirements,
    analysisDependencies: Array.from(new Set(analysisDependencies)),
    warnings,
    canonicalOps,
    selfCorrectionCount: 0,
    maxSelfCorrections: 3,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ── Preview Transaction ───────────────────────────────────────

/**
 * Preview a proposal against a MotionDocument WITHOUT mutating canonical state.
 * Returns a preview FrameState and evaluation trace.
 * The canonical document is NEVER modified.
 */
export function previewProposal(
  proposal: AIProposal,
  doc: MotionDocument,
  localTimeSecs: number,
  signalValues: Record<string, number>
): { frameState: FrameState; trace: AIEvaluationTrace } {
  // Apply ops to a temporary copy — canonical state untouched
  const previewDoc = applyMotionTransaction(doc, { ops: proposal.canonicalOps, description: `preview: ${proposal.intent}` });
  const frameState = evaluateMotionDocument(previewDoc, localTimeSecs, signalValues);

  // Build evaluation trace
  const trace = evaluateProposalTrace(proposal, doc, previewDoc, frameState);

  return { frameState, trace };
}

function evaluateProposalTrace(
  proposal: AIProposal,
  originalDoc: MotionDocument,
  previewDoc: MotionDocument,
  _frameState: FrameState
): AIEvaluationTrace {
  const corrections: AIEvaluationTrace['corrections'] = [];

  // Check if target objects moved
  let targetMoved = false;
  for (const objId of proposal.affectedObjectIds) {
    const original = originalDoc.objects[objId];
    const preview = previewDoc.objects[objId];
    if (original && preview) {
      const depthChanged = Math.abs((preview.depth ?? 0) - (original.depth ?? 0)) > 0.01;
      const behaviorAdded = preview.behaviors.length > original.behaviors.length;
      const materialChanged = preview.materialId !== original.materialId;
      if (depthChanged || behaviorAdded || materialChanged) {
        targetMoved = true;
      }
    }
  }

  if (!targetMoved && proposal.canonicalOps.length > 0) {
    corrections.push({
      issue: 'Target objects may not have changed visibly',
      suggestion: 'Increase depth amount or behavior amplitude',
      autoApplicable: true,
    });
  }

  // Check camera
  const cameraOverwhelmed = false; // Would check camera keyframe amplitude vs readability threshold

  // Check signals
  const signalsAvailable = proposal.signalsInvolved.length === 0 ||
    proposal.signalsInvolved.every((s) => Object.keys(previewDoc.signals).includes(s));

  if (!signalsAvailable) {
    corrections.push({
      issue: 'Some required signals are not bound',
      suggestion: 'Add signal bindings for: ' + proposal.signalsInvolved.filter((s) => !Object.keys(previewDoc.signals).includes(s)).join(', '),
      autoApplicable: true,
    });
  }

  const confidence = (targetMoved ? 0.4 : 0) + (signalsAvailable ? 0.3 : 0) + (proposal.warnings.length === 0 ? 0.3 : 0.1);

  return {
    targetMoved,
    cameraOverwhelmed,
    signalsAvailable,
    rendererSupported: true,
    subjectMatteAvailable: false,
    textBehindSubjectIncorrect: false,
    macroGuardActive: false,
    corrections,
    confidence,
  };
}

// ── Self-Correction ───────────────────────────────────────────

/**
 * Apply bounded self-correction based on trace results.
 * Uses preview transactions — canonical state is NEVER mutated.
 * Max corrections enforced to prevent infinite loops.
 */
export function selfCorrectProposal(
  proposal: AIProposal,
  trace: AIEvaluationTrace,
  doc: MotionDocument
): AIProposal {
  if (proposal.selfCorrectionCount >= proposal.maxSelfCorrections) {
    return proposal; // Max corrections reached
  }
  if (trace.confidence >= 0.7) {
    return proposal; // Good enough, no correction needed
  }

  const correctedOps = [...proposal.canonicalOps];

  for (const correction of trace.corrections) {
    if (!correction.autoApplicable) continue;

    if (correction.issue.includes('depth amount')) {
      // Increase depth on existing depth ops
      for (let i = 0; i < correctedOps.length; i++) {
        const op = correctedOps[i];
        if (op.type === 'motion.setObjectProp') {
          const props = op.payload.props as Record<string, unknown>;
          if (typeof props.depth === 'number') {
            correctedOps[i] = {
              ...op,
              payload: { ...op.payload, props: { ...props, depth: props.depth * 1.5 } },
            };
          }
        }
      }
    }

    if (correction.issue.includes('signals are not bound')) {
      // Add missing signal bindings
      for (const signalId of proposal.signalsInvolved) {
        if (!Object.keys(doc.signals).includes(signalId)) {
          correctedOps.push({
            opId: generateMotionId(),
            type: 'motion.upsertSignal',
            documentId: doc.id,
            payload: {
              signal: {
                id: signalId,
                type: 'number',
                name: signalId,
                defaultValue: 0,
              },
            },
            actor: 'ai',
            createdAt: Date.now(),
          });
        }
      }
    }
  }

  return {
    ...proposal,
    canonicalOps: correctedOps,
    selfCorrectionCount: proposal.selfCorrectionCount + 1,
    updatedAt: Date.now(),
  };
}

// ── Proposal Store ────────────────────────────────────────────

const proposalStore = new Map<string, AIProposal>();

export function storeProposal(proposal: AIProposal): void {
  proposalStore.set(proposal.id, proposal);
}

export function getProposal(id: string): AIProposal | null {
  return proposalStore.get(id) ?? null;
}

export function updateProposal(id: string, updates: Partial<AIProposal>): AIProposal | null {
  const existing = proposalStore.get(id);
  if (!existing) return null;
  const updated = { ...existing, ...updates, updatedAt: Date.now() };
  proposalStore.set(id, updated);
  return updated;
}

export function discardProposal(id: string): void {
  const proposal = proposalStore.get(id);
  if (proposal) {
    proposalStore.set(id, { ...proposal, status: 'discarded', updatedAt: Date.now() });
  }
}
