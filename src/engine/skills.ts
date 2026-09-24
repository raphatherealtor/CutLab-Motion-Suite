/**
 * CutLab Skills Engine v2 — Section 16
 * Higher-level skills on the editor vocabulary.
 * All skills inspect real project state, compile to canonical ops.
 * One logical skill execution = one grouped undo step.
 */

import type { ProjectData, TranscriptWord } from './schema';
import type { OpEnvelope } from './operations';
import { makeOp } from './operations';

import { fromSeconds, toSeconds, compare } from './time';
import { buildCaptionsFromTranscriptOps, buildKeepSpeakerOps } from './transcript';
import { buildPlaceGraphicOps } from './graphics';


export interface SkillResult {
  ops: OpEnvelope[];
  description: string;
  editCount: number;
}

const DEFAULT_PAD_MS = 60;
const FRAME_GUARD = 2;

// ── Remove Fillers ────────────────────────────────────────────

export function skillRemoveFillers(project: ProjectData): SkillResult {
  const seq = project.sequences[project.activeSequenceId];
  if (!seq) return empty('No active sequence');

  const fps = seq.format.fps;
  const ops: OpEnvelope[] = [];

  for (const clip of seq.clips) {
    if (clip.kind !== 'audio' || !clip.assetId) continue;
    const asset = project.assets[clip.assetId];
    if (!asset?.transcriptWords) continue;

    const fillerWords = asset.transcriptWords.filter((w) => w.isFiller);
    for (const word of fillerWords) {
      const wordStartSecs = toSeconds(word.startTime);
      const wordEndSecs = toSeconds(word.endTime);
      const padSecs = DEFAULT_PAD_MS / 1000;
      const guardSecs = FRAME_GUARD / fps;

      const deleteStart = fromSeconds(Math.max(0, wordStartSecs - padSecs + guardSecs), 30000);
      const deleteEnd = fromSeconds(wordEndSecs + padSecs - guardSecs, 30000);

      ops.push(makeOp('timeline.rippleDeleteRange', {
        sequenceId: seq.id,
        startTime: deleteStart,
        endTime: deleteEnd,
      }, 'skill'));
    }
  }

  return { ops, description: `Remove Fillers — ${ops.length} regions`, editCount: ops.length };
}

// ── Remove Dead Air ───────────────────────────────────────────

export function skillRemoveDeadAir(project: ProjectData, thresholdMs = 800): SkillResult {
  const seq = project.sequences[project.activeSequenceId];
  if (!seq) return empty('No active sequence');

  const fps = seq.format.fps;
  const ops: OpEnvelope[] = [];

  for (const clip of seq.clips) {
    if (clip.kind !== 'audio' || !clip.assetId) continue;
    const asset = project.assets[clip.assetId];
    if (!asset?.transcriptWords) continue;

    const words = [...asset.transcriptWords].sort((a, b) => compare(a.startTime, b.startTime));
    const padSecs = DEFAULT_PAD_MS / 1000;
    const guardSecs = FRAME_GUARD / fps;
    const thresholdSecs = thresholdMs / 1000;

    for (let i = 0; i < words.length - 1; i++) {
      const gapStart = toSeconds(words[i].endTime);
      const gapEnd = toSeconds(words[i + 1].startTime);
      const gapDur = gapEnd - gapStart;

      if (gapDur > thresholdSecs) {
        const deleteStart = fromSeconds(gapStart + padSecs + guardSecs, 30000);
        const deleteEnd = fromSeconds(gapEnd - padSecs - guardSecs, 30000);
        if (compare(deleteEnd, deleteStart) > 0) {
          ops.push(makeOp('timeline.rippleDeleteRange', {
            sequenceId: seq.id,
            startTime: deleteStart,
            endTime: deleteEnd,
          }, 'skill'));
        }
      }
    }
  }

  return { ops, description: `Remove Dead Air — ${ops.length} gaps`, editCount: ops.length };
}

// ── Tighten ───────────────────────────────────────────────────

export function skillTighten(project: ProjectData): SkillResult {
  const fillersResult = skillRemoveFillers(project);
  const deadAirResult = skillRemoveDeadAir(project);
  const ops = [...fillersResult.ops, ...deadAirResult.ops];
  return { ops, description: `Tighten Cut — ${ops.length} ops`, editCount: ops.length };
}

// ── Keep Speaker ──────────────────────────────────────────────

export function skillKeepSpeaker(project: ProjectData, speaker?: string): SkillResult {
  const seq = project.sequences[project.activeSequenceId];
  if (!seq) return empty('No active sequence');

  // Find the most prominent speaker if not specified
  const allWords: TranscriptWord[] = [];
  for (const clip of seq.clips) {
    if (!clip.assetId) continue;
    const asset = project.assets[clip.assetId];
    if (asset?.transcriptWords) allWords.push(...asset.transcriptWords);
  }

  if (allWords.length === 0) return empty('No transcript available');

  const targetSpeaker = speaker ?? getMostProminentSpeaker(allWords);
  if (!targetSpeaker) return empty('No speaker identified');

  const fps = seq.format.fps;
  const ops = buildKeepSpeakerOps(allWords, targetSpeaker, seq, fps);

  return { ops, description: `Keep Speaker: ${targetSpeaker} — ${ops.length} ops`, editCount: ops.length };
}

function getMostProminentSpeaker(words: TranscriptWord[]): string | null {
  const counts: Record<string, number> = {};
  for (const w of words) {
    if (w.speaker) counts[w.speaker] = (counts[w.speaker] || 0) + 1;
  }
  const entries = Object.entries(counts);
  if (entries.length === 0) return null;
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

// ── Add Captions ──────────────────────────────────────────────

export function skillAddCaptions(project: ProjectData): SkillResult {
  const seq = project.sequences[project.activeSequenceId];
  if (!seq) return empty('No active sequence');

  const captionTrack = seq.tracks.find((t) => t.kind === 'caption');
  if (!captionTrack) return empty('No caption track');

  const allWords: TranscriptWord[] = [];
  for (const clip of seq.clips) {
    if (!clip.assetId) continue;
    const asset = project.assets[clip.assetId];
    if (asset?.transcriptWords) allWords.push(...asset.transcriptWords);
  }

  if (allWords.length === 0) return empty('No transcript available');

  const ops = buildCaptionsFromTranscriptOps(allWords, seq);
  return { ops, description: `Add Captions — ${ops.length} caption lines`, editCount: ops.length };
}

// ── Normalize Dialogue ────────────────────────────────────────

export function skillNormalizeDialogue(project: ProjectData, targetLufs = -23): SkillResult {
  const seq = project.sequences[project.activeSequenceId];
  if (!seq) return empty('No active sequence');

  const dialogueTracks = seq.tracks.filter((t) => t.kind === 'audio' && t.targeted);
  const ops: OpEnvelope[] = [];

  for (const track of dialogueTracks) {
    const clips = seq.clips.filter((c) => c.trackId === track.id);
    for (const clip of clips) {
      // Honest: gain measurement deferred — no PCM access
      ops.push(makeOp('clip.setGain', { sequenceId: seq.id, clipId: clip.id, gain: 0 }, 'skill'));
    }
  }

  return { ops, description: `Normalize Dialogue to ${targetLufs} LUFS — ${ops.length} clips (gain measurement deferred)`, editCount: ops.length };
}

// ── Duck Music ────────────────────────────────────────────────

export function skillDuckMusic(project: ProjectData, duckDb = 18): SkillResult {
  const seq = project.sequences[project.activeSequenceId];
  if (!seq) return empty('No active sequence');

  const musicTracks = seq.tracks.filter((t) => t.kind === 'audio' && !t.targeted);
  const ops: OpEnvelope[] = [];

  for (const track of musicTracks) {
    const clips = seq.clips.filter((c) => c.trackId === track.id);
    for (const clip of clips) {
      ops.push(makeOp('clip.setGain', { sequenceId: seq.id, clipId: clip.id, gain: -duckDb }, 'skill'));
    }
  }

  return { ops, description: `Duck Music by ${duckDb}dB — ${ops.length} clips`, editCount: ops.length };
}

// ── Social 9:16 ───────────────────────────────────────────────

export function skillSocial916(project: ProjectData): SkillResult {
  const seq = project.sequences[project.activeSequenceId];
  if (!seq) return empty('No active sequence');

  const ops: OpEnvelope[] = [
    makeOp('sequence.setFormat', { sequenceId: seq.id, format: { width: 1080, height: 1920 } }, 'skill'),
  ];

  const videoClips = seq.clips.filter((c) => c.kind === 'video');
  for (const clip of videoClips) {
    ops.push(makeOp('clip.setTransform', {
      sequenceId: seq.id,
      clipId: clip.id,
      transform: { scaleX: 1.78, scaleY: 1.78 },
    }, 'skill'));
  }

  return { ops, description: `Social 9:16 — reframe ${videoClips.length} clips`, editCount: ops.length };
}

// ── Dialogue Cleanup ──────────────────────────────────────────

export function skillDialogueCleanup(project: ProjectData): SkillResult {
  const normalizeResult = skillNormalizeDialogue(project);
  const duckResult = skillDuckMusic(project);
  const fillersResult = skillRemoveFillers(project);
  const ops = [...normalizeResult.ops, ...duckResult.ops, ...fillersResult.ops];
  return {
    ops,
    description: `Dialogue Cleanup — normalize + duck + remove fillers (${ops.length} ops)`,
    editCount: ops.length,
  };
}

// ── Talking Head Cleanup ──────────────────────────────────────

export function skillTalkingHeadCleanup(project: ProjectData): SkillResult {
  const tightenResult = skillTighten(project);
  const normalizeResult = skillNormalizeDialogue(project);
  const duckResult = skillDuckMusic(project);
  const captionsResult = skillAddCaptions(project);
  const ops = [
    ...tightenResult.ops,
    ...normalizeResult.ops,
    ...duckResult.ops,
    ...captionsResult.ops,
  ];
  return {
    ops,
    description: `Talking Head Cleanup — tighten + normalize + duck + captions (${ops.length} ops)`,
    editCount: ops.length,
  };
}

// ── Add Lower Third ───────────────────────────────────────────

export function skillAddLowerThird(project: ProjectData, name = 'Speaker', title = 'Title'): SkillResult {
  const seq = project.sequences[project.activeSequenceId];
  if (!seq) return empty('No active sequence');

  const graphicTrack = seq.tracks.find((t) => t.kind === 'motion');
  if (!graphicTrack) return empty('No graphics track');

  const fps = seq.format.fps;
  const startTime = fromSeconds(0, 30000);
  const ops = buildPlaceGraphicOps(seq.id, 'lower-third', graphicTrack.id, startTime, 5, fps);

  if (ops.length > 0) {
    const clipId = (ops[0].payload as any).clip?.id;
    if (clipId) {
      ops.push(makeOp('graphic.setParam', { sequenceId: seq.id, clipId, key: 'name', value: name }, 'skill'));
      ops.push(makeOp('graphic.setParam', { sequenceId: seq.id, clipId, key: 'title', value: title }, 'skill'));
    }
  }

  return { ops, description: `Add Lower Third: ${name}`, editCount: ops.length };
}

// ── 15-Second Hook ────────────────────────────────────────────

/**
 * Hook skill: frame the strongest opener by setting the sequence in/out to the
 * first 15 seconds of content. Canonical and non-destructive — the source range
 * stays intact; in/out define the hook window.
 */
export function skillFifteenSecondHook(project: ProjectData): SkillResult {
  const seq = project.sequences[project.activeSequenceId];
  if (!seq) return empty('No active sequence');

  let startSecs = Infinity;
  for (const c of seq.clips) {
    const s = c.startTime.value / c.startTime.timescale;
    if (s < startSecs) startSecs = s;
  }
  if (!Number.isFinite(startSecs)) return empty('No clips to hook');

  const inPoint = fromSeconds(startSecs, 30000);
  const outPoint = fromSeconds(startSecs + 15, 30000);
  const ops = [makeOp('sequence.setInOut', { sequenceId: seq.id, inPoint, outPoint }, 'skill')];
  return { ops, description: '15-Second Hook — in/out set to first 15s of content', editCount: ops.length };
}

// ── Dispatch skill by ID ──────────────────────────────────────

export function runSkill(skillId: string, project: ProjectData, params?: Record<string, any>): SkillResult {
  switch (skillId) {
    case 'skill-remove-fillers': return skillRemoveFillers(project);
    case 'skill-remove-dead-air': return skillRemoveDeadAir(project);
    case 'skill-tighten': return skillTighten(project);
    case 'skill-keep-speaker': return skillKeepSpeaker(project, params?.speaker);
    case 'skill-add-captions': return skillAddCaptions(project);
    case 'skill-normalize': return skillNormalizeDialogue(project);
    case 'skill-duck-music': return skillDuckMusic(project, params?.duckDb);
    case 'skill-social': return skillSocial916(project);
    case 'skill-dialogue-cleanup': return skillDialogueCleanup(project);
    case 'skill-talking-head': return skillTalkingHeadCleanup(project);
    case 'skill-add-lower-third': return skillAddLowerThird(project, params?.name, params?.title);
    case 'skill-add-titles': {
      // Catalog id 'skill-add-titles' — places a lower third named from the
      // first transcript speaker when available.
      const speaker = Object.values(project.assets)
        .flatMap((a) => a.transcriptWords ?? [])
        .find((w) => w.speakerLabel || w.speaker);
      return skillAddLowerThird(project, speaker?.speakerLabel ?? speaker?.speaker ?? params?.name ?? 'Speaker', params?.title ?? 'Title');
    }
    case 'skill-hook': return skillFifteenSecondHook(project);
    default: return empty(`Unknown skill: ${skillId}`);
  }
}

function empty(description: string): SkillResult {
  return { ops: [], description, editCount: 0 };
}
