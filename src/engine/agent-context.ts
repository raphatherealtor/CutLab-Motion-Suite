/**
 * CutLab Agent Context Contract — Section 17
 * Constrained context object for AI second pair of hands.
 * NL → command | skill | none routing.
 * Park-before-execute. No raw op invention.
 */

import type { ProjectData, Sequence, Clip } from './schema';

import { toSeconds } from './time';

// ── Agent Context ─────────────────────────────────────────────

export interface AgentContext {
  /** Current playhead frame */
  playheadFrame: number;
  /** Current playhead in seconds */
  playheadSecs: number;
  /** Selected clip IDs */
  selectedClipIds: string[];
  /** Selected clip summaries */
  selectedClips: AgentClipSummary[];
  /** Active sequence ID */
  activeSequenceId: string;
  /** Active sequence name */
  activeSequenceName: string;
  /** Sequence duration in seconds */
  sequenceDurationSecs: number;
  /** Nearby clips (within 5 seconds of playhead) */
  nearbyClips: AgentClipSummary[];
  /** Transcript slice near playhead */
  transcriptSlice: AgentTranscriptSlice | null;
  /** Markers */
  markers: AgentMarkerSummary[];
  /** Supported commands (exhaustive list) */
  supportedCommands: string[];
  /** Supported skills (exhaustive list) */
  supportedSkills: AgentSkillSummary[];
  /** Project name */
  projectName: string;
  /** Project revision */
  revision: number;
}

export interface AgentClipSummary {
  id: string;
  name: string;
  kind: string;
  trackId: string;
  startSecs: number;
  durationSecs: number;
  disabled: boolean;
  hasAudio: boolean;
  hasSpeaker?: string;
}

export interface AgentTranscriptSlice {
  words: Array<{
    id: string;
    text: string;
    startSecs: number;
    endSecs: number;
    speaker?: string;
    isFiller?: boolean;
  }>;
  speakers: string[];
}

export interface AgentMarkerSummary {
  id: string;
  label: string;
  timeSecs: number;
}

export interface AgentSkillSummary {
  id: string;
  name: string;
  description: string;
}

// ── Supported commands ────────────────────────────────────────

export const SUPPORTED_COMMANDS: string[] = [
  'split', 'split at',
  'delete', 'ripple delete',
  'add marker', 'marker',
  'close gap',
  'freeze', 'freeze frame',
  'speed <N>x',
  'move to V2', 'move to V1', 'move to A1', 'move to A2',
  'add lower third',
  'cut fillers', 'remove fillers',
  'tighten', 'tighten cut',
  'normalize',
  'duck music',
  'insert', 'overwrite',
  'cross dissolve',
  'fade audio',
  'precompose selection',
  'add keyframe',
  'next keyframe',
  'blur selection',
  'crop',
  'normalize dialogue',
  'add captions',
  'add lower third',
  'unlink',
  'relink',
];

export const SUPPORTED_SKILLS: AgentSkillSummary[] = [
  { id: 'skill-remove-fillers', name: 'Remove Fillers', description: 'Remove um/uh/filler words from transcript' },
  { id: 'skill-remove-dead-air', name: 'Remove Dead Air', description: 'Remove long silences' },
  { id: 'skill-tighten', name: 'Tighten Cut', description: 'Remove fillers and dead air' },
  { id: 'skill-add-captions', name: 'Add Captions', description: 'Generate captions from transcript' },
  { id: 'skill-normalize', name: 'Normalize Dialogue', description: 'Normalize dialogue audio levels' },
  { id: 'skill-duck-music', name: 'Duck Music', description: 'Reduce music volume under dialogue' },
  { id: 'skill-social', name: 'Social 9:16', description: 'Reformat sequence for vertical social media' },
  { id: 'skill-keep-speaker', name: 'Keep Speaker', description: 'Keep only selected speaker' },
  { id: 'skill-dialogue-cleanup', name: 'Dialogue Cleanup', description: 'Normalize + duck music + remove fillers' },
  { id: 'skill-talking-head', name: 'Talking Head Cleanup', description: 'Full talking head cleanup pass' },
];

// ── Context builder ───────────────────────────────────────────

export function buildAgentContext(
  project: ProjectData,
  playheadFrame: number,
  selectedClipIds: string[]
): AgentContext {
  const seq = project.sequences[project.activeSequenceId];
  if (!seq) {
    return {
      playheadFrame,
      playheadSecs: 0,
      selectedClipIds: [],
      selectedClips: [],
      activeSequenceId: project.activeSequenceId,
      activeSequenceName: 'Unknown',
      sequenceDurationSecs: 0,
      nearbyClips: [],
      transcriptSlice: null,
      markers: [],
      supportedCommands: SUPPORTED_COMMANDS,
      supportedSkills: SUPPORTED_SKILLS,
      projectName: project.name,
      revision: project.revision,
    };
  }

  const fps = seq.format.fps;
  const playheadSecs = playheadFrame / fps;

  // Sequence duration
  const sequenceDurationSecs = seq.clips.reduce((max, c) => {
    const end = toSeconds(c.startTime) + toSeconds(c.duration);
    return Math.max(max, end);
  }, 0);

  // Selected clips
  const selectedClips = selectedClipIds
    .map((id) => seq.clips.find((c) => c.id === id))
    .filter(Boolean)
    .map((c) => clipToSummary(c!, project));

  // Nearby clips (within 5 seconds)
  const nearbyClips = seq.clips
    .filter((c) => {
      const start = toSeconds(c.startTime);
      const end = start + toSeconds(c.duration);
      return Math.abs(start - playheadSecs) < 5 || Math.abs(end - playheadSecs) < 5 ||
        (start <= playheadSecs && end >= playheadSecs);
    })
    .slice(0, 10)
    .map((c) => clipToSummary(c, project));

  // Transcript slice
  const transcriptSlice = buildTranscriptSlice(project, seq, playheadSecs, fps);

  // Markers
  const markers: AgentMarkerSummary[] = seq.markers.map((m) => ({
    id: m.id,
    label: m.label,
    timeSecs: toSeconds(m.time),
  }));

  return {
    playheadFrame,
    playheadSecs,
    selectedClipIds,
    selectedClips,
    activeSequenceId: project.activeSequenceId,
    activeSequenceName: seq.name,
    sequenceDurationSecs,
    nearbyClips,
    transcriptSlice,
    markers,
    supportedCommands: SUPPORTED_COMMANDS,
    supportedSkills: SUPPORTED_SKILLS,
    projectName: project.name,
    revision: project.revision,
  };
}

function clipToSummary(clip: Clip, project: ProjectData): AgentClipSummary {
  const asset = clip.assetId ? project.assets[clip.assetId] : null;
  return {
    id: clip.id,
    name: clip.name,
    kind: clip.kind,
    trackId: clip.trackId,
    startSecs: toSeconds(clip.startTime),
    durationSecs: toSeconds(clip.duration),
    disabled: clip.disabled,
    hasAudio: asset?.hasAudio ?? clip.kind === 'audio',
  };
}

function buildTranscriptSlice(
  project: ProjectData,
  seq: Sequence,
  playheadSecs: number,
  fps: number
): AgentTranscriptSlice | null {
  // Find audio clips near playhead with transcript
  const audioClip = seq.clips.find((c) => {
    if (c.kind !== 'audio' || !c.assetId) return false;
    const start = toSeconds(c.startTime);
    const end = start + toSeconds(c.duration);
    return playheadSecs >= start - 5 && playheadSecs <= end + 5;
  });

  if (!audioClip?.assetId) return null;
  const asset = project.assets[audioClip.assetId];
  if (!asset?.transcriptWords?.length) return null;

  const clipStart = toSeconds(audioClip.startTime);
  const clipSourceStart = toSeconds(audioClip.sourceIn);
  const windowSecs = 10;

  const words = asset.transcriptWords
    .filter((w) => {
      const wSeqSecs = clipStart + (toSeconds(w.startTime) - clipSourceStart);
      return Math.abs(wSeqSecs - playheadSecs) < windowSecs;
    })
    .map((w) => ({
      id: w.id,
      text: w.text,
      startSecs: clipStart + (toSeconds(w.startTime) - clipSourceStart),
      endSecs: clipStart + (toSeconds(w.endTime) - clipSourceStart),
      speaker: w.speaker,
      isFiller: w.isFiller,
    }));

  const speakers = Array.from(new Set(words.map((w) => w.speaker).filter(Boolean))) as string[];

  return { words, speakers };
}

// ── NL routing ────────────────────────────────────────────────

export type AgentRouteType = 'command' | 'skill' | 'none';

export interface AgentRoute {
  type: AgentRouteType;
  commandText?: string;
  skillId?: string;
  confidence: 'high' | 'medium' | 'low';
  description: string;
}

/**
 * Route natural language to command | skill | none.
 * Does NOT invent raw ops. Fails closed to 'none'.
 */
export function routeNaturalLanguage(input: string): AgentRoute {
  const raw = input.toLowerCase().trim();

  // Skill routing
  const skillRoutes: Array<{ patterns: string[]; skillId: string; name: string }> = [
    { patterns: ['remove filler', 'cut filler', 'remove um', 'remove uh'], skillId: 'skill-remove-fillers', name: 'Remove Fillers' },
    { patterns: ['remove dead air', 'remove silence', 'cut silence'], skillId: 'skill-remove-dead-air', name: 'Remove Dead Air' },
    { patterns: ['tighten', 'tighten cut', 'tighten up'], skillId: 'skill-tighten', name: 'Tighten Cut' },
    { patterns: ['add caption', 'generate caption', 'create caption'], skillId: 'skill-add-captions', name: 'Add Captions' },
    { patterns: ['normalize', 'normalize dialogue', 'fix audio level'], skillId: 'skill-normalize', name: 'Normalize Dialogue' },
    { patterns: ['duck music', 'lower music', 'reduce music'], skillId: 'skill-duck-music', name: 'Duck Music' },
    { patterns: ['social', '9:16', 'vertical', 'reformat for social'], skillId: 'skill-social', name: 'Social 9:16' },
    { patterns: ['keep speaker', 'only speaker', 'keep only'], skillId: 'skill-keep-speaker', name: 'Keep Speaker' },
    { patterns: ['dialogue cleanup', 'clean dialogue', 'clean audio'], skillId: 'skill-dialogue-cleanup', name: 'Dialogue Cleanup' },
    { patterns: ['talking head', 'cleanup talking', 'clean talking head'], skillId: 'skill-talking-head', name: 'Talking Head Cleanup' },
  ];

  for (const route of skillRoutes) {
    if (route.patterns.some((p) => raw.includes(p))) {
      return {
        type: 'skill',
        skillId: route.skillId,
        confidence: 'high',
        description: `Run skill: ${route.name}`,
      };
    }
  }

  // Command routing
  const commandRoutes: Array<{ patterns: string[]; command: string }> = [
    { patterns: ['split', 'cut here', 'cut at'], command: 'split' },
    { patterns: ['delete', 'remove clip', 'delete clip'], command: 'delete' },
    { patterns: ['ripple delete', 'ripple remove'], command: 'ripple delete' },
    { patterns: ['add marker', 'mark here', 'set marker'], command: 'add marker' },
    { patterns: ['close gap', 'fill gap', 'remove gap'], command: 'close gap' },
    { patterns: ['freeze frame', 'freeze'], command: 'freeze' },
    { patterns: ['move to v2', 'put on v2', 'move up'], command: 'move to V2' },
    { patterns: ['lower third', 'add lower third', 'name card'], command: 'add lower third' },
    { patterns: ['duck', 'duck the music'], command: 'duck music' },
  ];

  for (const route of commandRoutes) {
    if (route.patterns.some((p) => raw.includes(p))) {
      return {
        type: 'command',
        commandText: route.command,
        confidence: 'high',
        description: `Execute command: ${route.command}`,
      };
    }
  }

  // Unknown — fail closed
  return {
    type: 'none',
    confidence: 'low',
    description: 'No matching command or skill found',
  };
}

function buildMotionAgentContext(...args: any[]): any {
  // eslint-disable-next-line no-console
  console.warn('Placeholder: buildMotionAgentContext is not implemented yet.', args);
  return null;
}

export { buildMotionAgentContext };
function MotionAgentContext(...args: any[]): any {
  // eslint-disable-next-line no-console
  console.warn('Placeholder: MotionAgentContext is not implemented yet.', args);
  return null;
}

export { MotionAgentContext };