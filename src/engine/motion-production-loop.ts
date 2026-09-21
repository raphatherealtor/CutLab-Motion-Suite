/**
 * CutLab Motion Production Loop + AI Context Extension
 * Extends Studio AgentContext with Motion capabilities.
 * Unifies Studio AI with Motion's CapabilityToolRegistry.
 */

import type { ProjectData } from './schema';
import type { AgentContext } from './agent-context';
import { buildAgentContext, SUPPORTED_COMMANDS, SUPPORTED_SKILLS } from './agent-context';
import { motionRegistry } from '@/motion/registry';
import { resolveClipMotionDocument } from './motion-bridge';
import { toSeconds } from './time';

// ── Extended Agent Context ────────────────────────────────────

export interface MotionAgentContext extends AgentContext {
  /** Motion-specific context */
  motion: {
    /** Selected Motion clip summary */
    selectedMotionClip: MotionClipSummary | null;
    /** Available Motion template generators */
    availableTemplates: Array<{ id: string; name: string; family: string; tags: string[] }>;
    /** Available capability tools */
    availableTools: Array<{ id: string; name: string; category: string; description: string }>;
    /** Motion document summary for selected clip */
    documentSummary: MotionDocumentSummary | null;
    /** Signal availability */
    availableSignals: Array<{ kind: string; label: string }>;
    /** Nearby cues */
    nearbyCues: Array<{ id: string; type: string; timeSecs: number; label?: string }>;
    /** Speaker identities */
    speakers: string[];
  };
}

export interface MotionClipSummary {
  clipId: string;
  name: string;
  startSecs: number;
  durationSecs: number;
  motionDocumentId: string | null;
  templateId: string | null;
}

export interface MotionDocumentSummary {
  id: string;
  name: string;
  objectCount: number;
  signalCount: number;
  behaviorCount: number;
  keyframeCount: number;
  templateId: string | null;
  durationSecs: number;
}

// ── Build extended context ────────────────────────────────────

export function buildMotionAgentContext(
  project: ProjectData,
  playheadFrame: number,
  selectedClipIds: string[]
): MotionAgentContext {
  // Build base context
  const base = buildAgentContext(project, playheadFrame, selectedClipIds);

  const seq = project.sequences[project.activeSequenceId];
  const fps = seq?.format.fps ?? 29.97;
  const playheadSecs = playheadFrame / fps;

  // Find selected Motion clip
  let selectedMotionClip: MotionClipSummary | null = null;
  let documentSummary: MotionDocumentSummary | null = null;

  for (const clipId of selectedClipIds) {
    const clip = seq?.clips.find((c) => c.id === clipId);
    if (clip?.kind === 'motion') {
      selectedMotionClip = {
        clipId: clip.id,
        name: clip.name,
        startSecs: toSeconds(clip.startTime),
        durationSecs: toSeconds(clip.duration),
        motionDocumentId: clip.motionDocumentId ?? null,
        templateId: clip.motionBundleId ?? null,
      };

      // Get document summary
      if (clip.motionDocumentId) {
        const doc = resolveClipMotionDocument(project, clip);
        if (doc) {
          const allBehaviors = Object.values(doc.objects).flatMap((o) => o.behaviors);
          const allKeyframes = Object.values(doc.objects).flatMap((o) => o.keyframes);
          documentSummary = {
            id: doc.id,
            name: doc.name,
            objectCount: Object.keys(doc.objects).length,
            signalCount: Object.keys(doc.signals).length,
            behaviorCount: allBehaviors.length,
            keyframeCount: allKeyframes.length,
            templateId: doc.templateId ?? null,
            durationSecs: doc.duration.value / doc.duration.timescale,
          };
        }
      }
      break;
    }
  }

  // Available templates
  const availableTemplates = motionRegistry.getAllGenerators().map((g) => ({
    id: g.id,
    name: g.name,
    family: g.family,
    tags: g.tags,
  }));

  // Available tools
  const availableTools = motionRegistry.getAllTools().map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    description: t.description,
  }));

  // Available signals
  const availableSignals = [
    { kind: 'audio-rms', label: 'Audio RMS Energy' },
    { kind: 'audio-beat', label: 'Audio Beat' },
    { kind: 'audio-low', label: 'Low Frequency Energy' },
    { kind: 'audio-mid', label: 'Mid Frequency Energy' },
    { kind: 'audio-high', label: 'High Frequency Energy' },
    { kind: 'semantic-emphasis', label: 'Semantic Emphasis' },
    { kind: 'speech-timing', label: 'Speech Timing' },
    { kind: 'subject-bounds', label: 'Subject Bounds' },
    { kind: 'manual', label: 'Manual Control' },
  ];

  // Nearby cues
  const nearbyCues = (seq?.cues ?? [])
    .filter((c) => {
      const cueSecs = toSeconds(c.timeRange.start);
      return Math.abs(cueSecs - playheadSecs) < 5;
    })
    .map((c) => ({
      id: c.id,
      type: c.type,
      timeSecs: toSeconds(c.timeRange.start),
      label: c.label,
    }));

  // Speakers from transcript
  const speakers = new Set<string>();
  for (const asset of Object.values(project.assets)) {
    if (asset.transcriptWords) {
      for (const word of asset.transcriptWords) {
        if (word.speaker) speakers.add(word.speaker);
      }
    }
  }

  return {
    ...base,
    supportedCommands: [
      ...SUPPORTED_COMMANDS,
      'insert motion template',
      'add motion clip',
      'set motion text',
      'add behavior',
      'bind signal',
      'add keyframe',
      'set depth',
      'add camera',
      'import svg',
    ],
    supportedSkills: [
      ...SUPPORTED_SKILLS,
      { id: 'skill-motion-caption-sync', name: 'Caption Sync', description: 'Sync Motion text to Studio captions' },
      { id: 'skill-motion-beat-sync', name: 'Beat Sync', description: 'Sync Motion behaviors to audio beats' },
      { id: 'skill-motion-word-by-word', name: 'Word by Word', description: 'Animate text word by word from transcript' },
    ],
    motion: {
      selectedMotionClip,
      availableTemplates,
      availableTools,
      documentSummary,
      availableSignals,
      nearbyCues,
      speakers: Array.from(speakers),
    },
  };
}

// ── Production Loop ───────────────────────────────────────────

/**
 * Motion Production Loop
 * Orchestrates AI → Motion ops → Studio history.
 * AI uses canonical tools/ops — no arbitrary state mutation.
 */
export class MotionProductionLoop {
  /**
   * Parse an AI command and return Motion ops to apply.
   * Returns null if command is not Motion-related.
   */
  parseCommand(
    command: string,
    context: MotionAgentContext
  ): { ops: import('@/motion/types').MotionOp[]; description: string } | null {
    const lower = command.toLowerCase().trim();

    // Insert motion template
    if (lower.startsWith('insert motion') || lower.startsWith('add motion')) {
      const templateName = command.replace(/^(insert|add)\s+motion\s+/i, '').trim();
      const gen = motionRegistry.getAllGenerators().find(
        (g) => g.name.toLowerCase().includes(templateName.toLowerCase()) ||
          g.id.toLowerCase().includes(templateName.toLowerCase())
      );
      if (gen && context.motion.selectedMotionClip?.motionDocumentId) {
        // Return empty ops — the actual insertion is handled by createMotionClipOps
        return { ops: [], description: `Insert Motion template: ${gen.name}` };
      }
    }

    // Set text content
    if (lower.startsWith('set text') || lower.startsWith('set motion text')) {
      const text = command.replace(/^set\s+(motion\s+)?text\s+/i, '').trim();
      const docId = context.motion.selectedMotionClip?.motionDocumentId;
      if (docId) {
        // Would need to find the text object — return placeholder
        return { ops: [], description: `Set text: ${text}` };
      }
    }

    return null;
  }
}

export const motionProductionLoop = new MotionProductionLoop();
