/**
 * CutLab Command System v2 — Section 15
 * Typed text → command resolver → canonical op/skill
 * Unknown command = zero ops. Fail closed.
 * Expanded vocabulary for all new NLE features.
 */

import type { ProjectData, Sequence, Clip } from './schema';
import type { OpEnvelope } from './operations';
import { makeOp } from './operations';
import { generateId } from './schema';
import { fromSeconds } from './time';
import { createEffect } from './effects';
import { buildPlaceGraphicOps } from './graphics';

export interface CommandResult {
  ops: OpEnvelope[];
  description: string;
  requiresConfirm: boolean;
  recognized: boolean;
}

const ZERO_RESULT: CommandResult = {
  ops: [],
  description: '',
  requiresConfirm: false,
  recognized: false,
};

/**
 * Resolve a typed command string to canonical ops.
 * Returns zero ops for unknown commands (fail closed).
 */
export function resolveCommand(
  input: string,
  project: ProjectData,
  playheadFrame: number,
  selectedClipIds: string[]
): CommandResult {
  const raw = input.trim().toLowerCase();
  if (!raw) return ZERO_RESULT;

  const seq = project.sequences[project.activeSequenceId];
  if (!seq) return ZERO_RESULT;

  const fps = seq.format.fps;
  const seqId = seq.id;

  // ── Split ──────────────────────────────────────────────────
  if (raw === 'split' || raw.startsWith('split at')) {
    const clips = selectedClipIds.length > 0
      ? seq.clips.filter((c) => selectedClipIds.includes(c.id))
      : getClipsAtFrame(seq, playheadFrame, fps);
    if (clips.length === 0) return { ...ZERO_RESULT, recognized: true, description: 'No clips to split' };
    const splitTime = fromSeconds(playheadFrame / fps, 30000);
    const ops = clips.map((clip) =>
      makeOp('clip.split', { sequenceId: seqId, clipId: clip.id, splitTime }, 'user')
    );
    return { ops, description: `Split ${clips.length} clip(s) at playhead`, requiresConfirm: false, recognized: true };
  }

  // ── Delete ─────────────────────────────────────────────────
  if (raw === 'delete' || raw === 'del') {
    if (selectedClipIds.length === 0) return { ...ZERO_RESULT, recognized: true, description: 'No clips selected' };
    const ops = [makeOp('clip.delete', { sequenceId: seqId, clipIds: selectedClipIds }, 'user')];
    return { ops, description: `Delete ${selectedClipIds.length} clip(s)`, requiresConfirm: false, recognized: true };
  }

  // ── Ripple delete ──────────────────────────────────────────
  if (raw === 'ripple delete' || raw === 'ripple del') {
    if (selectedClipIds.length === 0) return { ...ZERO_RESULT, recognized: true, description: 'No clips selected' };
    const ops = [makeOp('clip.rippleDelete', { sequenceId: seqId, clipIds: selectedClipIds }, 'user')];
    return { ops, description: `Ripple delete ${selectedClipIds.length} clip(s)`, requiresConfirm: false, recognized: true };
  }

  // ── Lift (delete without ripple) ───────────────────────────
  if (raw === 'lift' || raw === 'lift delete') {
    if (selectedClipIds.length === 0) return { ...ZERO_RESULT, recognized: true, description: 'No clips selected' };
    const ops = [makeOp('clip.delete', { sequenceId: seqId, clipIds: selectedClipIds }, 'user')];
    return { ops, description: `Lift ${selectedClipIds.length} clip(s)`, requiresConfirm: false, recognized: true };
  }

  // ── Add marker ─────────────────────────────────────────────
  if (raw.startsWith('add marker') || raw === 'marker') {
    const label = raw.replace(/^add marker\s*/i, '').trim() || 'Marker';
    const marker = { id: generateId('marker'), time: fromSeconds(playheadFrame / fps, 30000), label };
    const ops = [makeOp('marker.add', { sequenceId: seqId, marker }, 'user')];
    return { ops, description: `Add marker "${label}"`, requiresConfirm: false, recognized: true };
  }

  // ── Close gap ──────────────────────────────────────────────
  if (raw === 'close gap') {
    const targetTrack = seq.tracks.find((t) => t.targeted && t.kind === 'video');
    if (!targetTrack) return { ...ZERO_RESULT, recognized: true, description: 'No targeted track' };
    const gapStartTime = fromSeconds(playheadFrame / fps, 30000);
    const ops = [makeOp('timeline.closeGap', { sequenceId: seqId, trackId: targetTrack.id, gapStartTime }, 'user')];
    return { ops, description: 'Close gap at playhead', requiresConfirm: false, recognized: true };
  }

  // ── Insert gap ─────────────────────────────────────────────
  if (raw.startsWith('insert gap')) {
    const targetTrack = seq.tracks.find((t) => t.targeted && t.kind === 'video');
    if (!targetTrack) return { ...ZERO_RESULT, recognized: true, description: 'No targeted track' };
    const durMatch = raw.match(/([\d.]+)\s*s/);
    const durSecs = durMatch ? parseFloat(durMatch[1]) : 1;
    const startTime = fromSeconds(playheadFrame / fps, 30000);
    const duration = fromSeconds(durSecs, 30000);
    const ops = [makeOp('timeline.insertGap', { sequenceId: seqId, trackId: targetTrack.id, startTime, duration }, 'user')];
    return { ops, description: `Insert ${durSecs}s gap`, requiresConfirm: false, recognized: true };
  }

  // ── Freeze ─────────────────────────────────────────────────
  if (raw === 'freeze' || raw.startsWith('freeze frame')) {
    if (selectedClipIds.length === 0) return { ...ZERO_RESULT, recognized: true, description: 'No clips selected' };
    const freezeFrame = fromSeconds(playheadFrame / fps, 30000);
    const ops = selectedClipIds.map((id) =>
      makeOp('clip.setFreeze', { sequenceId: seqId, clipId: id, freeze: true, freezeFrame }, 'user')
    );
    return { ops, description: 'Freeze frame', requiresConfirm: false, recognized: true };
  }

  // ── Speed ──────────────────────────────────────────────────
  const speedMatch = raw.match(/^speed\s+([\d.]+)x?$/);
  if (speedMatch) {
    const speed = parseFloat(speedMatch[1]);
    if (selectedClipIds.length === 0) return { ...ZERO_RESULT, recognized: true, description: 'No clips selected' };
    const ops = selectedClipIds.map((id) =>
      makeOp('clip.setSpeed', { sequenceId: seqId, clipId: id, speed }, 'user')
    );
    return { ops, description: `Set speed ${speed}×`, requiresConfirm: false, recognized: true };
  }

  // ── Move to track ──────────────────────────────────────────
  if (raw.startsWith('move to v') || raw.startsWith('move to a')) {
    const trackLabel = raw.replace('move to ', '').toUpperCase();
    const targetTrack = seq.tracks.find((t) => t.label === trackLabel);
    if (!targetTrack || selectedClipIds.length === 0) {
      return { ...ZERO_RESULT, recognized: true, description: `Track ${trackLabel} not found or no selection` };
    }
    const ops = selectedClipIds.map((id) => {
      const clip = seq.clips.find((c) => c.id === id);
      if (!clip) return null;
      return makeOp('clip.move', { sequenceId: seqId, clipId: id, newStartTime: clip.startTime, newTrackId: targetTrack.id }, 'user');
    }).filter(Boolean) as OpEnvelope[];
    return { ops, description: `Move to ${trackLabel}`, requiresConfirm: false, recognized: true };
  }

  // ── Unlink ─────────────────────────────────────────────────
  if (raw === 'unlink') {
    if (selectedClipIds.length === 0) return { ...ZERO_RESULT, recognized: true, description: 'No clips selected' };
    const ops = selectedClipIds.map((id) =>
      makeOp('clip.unlink', { sequenceId: seqId, clipId: id }, 'user')
    );
    return { ops, description: `Unlink ${selectedClipIds.length} clip(s)`, requiresConfirm: false, recognized: true };
  }

  // ── Relink ─────────────────────────────────────────────────
  if (raw === 'relink') {
    if (selectedClipIds.length < 2) return { ...ZERO_RESULT, recognized: true, description: 'Select 2+ clips to relink' };
    const ops = [makeOp('clip.link', { sequenceId: seqId, clipIds: selectedClipIds }, 'user')];
    return { ops, description: `Relink ${selectedClipIds.length} clips`, requiresConfirm: false, recognized: true };
  }

  // ── Duplicate ──────────────────────────────────────────────
  if (raw === 'duplicate' || raw === 'dup') {
    if (selectedClipIds.length === 0) return { ...ZERO_RESULT, recognized: true, description: 'No clips selected' };
    const ops = selectedClipIds.map((id) =>
      makeOp('clip.duplicate', { sequenceId: seqId, clipId: id, newClipId: generateId('clip') }, 'user')
    );
    return { ops, description: `Duplicate ${selectedClipIds.length} clip(s)`, requiresConfirm: false, recognized: true };
  }

  // ── Enable / Disable clip ──────────────────────────────────
  if (raw === 'enable' || raw === 'enable clip') {
    if (selectedClipIds.length === 0) return { ...ZERO_RESULT, recognized: true, description: 'No clips selected' };
    const ops = selectedClipIds.map((id) =>
      makeOp('clip.enable', { sequenceId: seqId, clipId: id, enabled: true }, 'user')
    );
    return { ops, description: 'Enable clips', requiresConfirm: false, recognized: true };
  }
  if (raw === 'disable' || raw === 'disable clip') {
    if (selectedClipIds.length === 0) return { ...ZERO_RESULT, recognized: true, description: 'No clips selected' };
    const ops = selectedClipIds.map((id) =>
      makeOp('clip.enable', { sequenceId: seqId, clipId: id, enabled: false }, 'user')
    );
    return { ops, description: 'Disable clips', requiresConfirm: false, recognized: true };
  }

  // ── Cross dissolve ─────────────────────────────────────────
  if (raw === 'cross dissolve' || raw === 'dissolve') {
    if (selectedClipIds.length < 2) return { ...ZERO_RESULT, recognized: true, description: 'Select 2 clips for dissolve' };
    const clipA = seq.clips.find((c) => c.id === selectedClipIds[0]);
    const clipB = seq.clips.find((c) => c.id === selectedClipIds[1]);
    if (!clipA || !clipB) return { ...ZERO_RESULT, recognized: true, description: 'Clips not found' };
    const transition = {
      id: generateId('trans'),
      type: 'cross-dissolve' as const,
      duration: fromSeconds(1, 30000),
      clipAId: clipA.id,
      clipBId: clipB.id,
      edge: 'cut-point' as const,
    };
    const ops = [makeOp('transition.upsert', { sequenceId: seqId, transition }, 'user')];
    return { ops, description: 'Add cross dissolve', requiresConfirm: false, recognized: true };
  }

  // ── Fade audio ─────────────────────────────────────────────
  if (raw === 'fade audio' || raw.startsWith('fade in') || raw.startsWith('fade out')) {
    if (selectedClipIds.length === 0) return { ...ZERO_RESULT, recognized: true, description: 'No clips selected' };
    const durMatch = raw.match(/([\d.]+)\s*s/);
    const durSecs = durMatch ? parseFloat(durMatch[1]) : 0.5;
    const fadeDuration = fromSeconds(durSecs, 30000);
    const isFadeIn = raw.includes('fade in') || raw === 'fade audio';
    const isFadeOut = raw.includes('fade out') || raw === 'fade audio';
    const ops: OpEnvelope[] = [];
    for (const id of selectedClipIds) {
      if (isFadeIn) ops.push(makeOp('clip.setProps', { sequenceId: seqId, clipId: id, props: { fadeIn: fadeDuration } }, 'user'));
      if (isFadeOut) ops.push(makeOp('clip.setProps', { sequenceId: seqId, clipId: id, props: { fadeOut: fadeDuration } }, 'user'));
    }
    return { ops, description: `Fade audio ${durSecs}s`, requiresConfirm: false, recognized: true };
  }

  // ── Add keyframe ───────────────────────────────────────────
  if (raw === 'add keyframe' || raw.startsWith('keyframe')) {
    if (selectedClipIds.length === 0) return { ...ZERO_RESULT, recognized: true, description: 'No clips selected' };
    const clip = seq.clips.find((c) => c.id === selectedClipIds[0]);
    if (!clip) return { ...ZERO_RESULT, recognized: true, description: 'Clip not found' };
    const clipLocalTime = fromSeconds(Math.max(0, playheadFrame / fps - (clip.startTime.value / clip.startTime.timescale)), 30000);
    const kf = {
      id: generateId('kf'),
      time: clipLocalTime,
      property: 'transform.opacity',
      value: clip.transform.opacity,
      easing: 'linear' as const,
    };
    const ops = [makeOp('keyframe.upsert', { sequenceId: seqId, clipId: clip.id, keyframe: kf }, 'user')];
    return { ops, description: 'Add keyframe at playhead', requiresConfirm: false, recognized: true };
  }

  // ── Blur selection ─────────────────────────────────────────
  if (raw === 'blur' || raw === 'blur selection') {
    if (selectedClipIds.length === 0) return { ...ZERO_RESULT, recognized: true, description: 'No clips selected' };
    const ops: OpEnvelope[] = [];
    for (const id of selectedClipIds) {
      const clip = seq.clips.find((c) => c.id === id);
      if (!clip) continue;
      const effect = createEffect('blur', clip.effects.length);
      effect.params.amount = 10;
      ops.push(makeOp('clip.addEffect', { sequenceId: seqId, clipId: id, effect }, 'user'));
    }
    return { ops, description: 'Add blur effect', requiresConfirm: false, recognized: true };
  }

  // ── Crop ───────────────────────────────────────────────────
  if (raw === 'crop') {
    if (selectedClipIds.length === 0) return { ...ZERO_RESULT, recognized: true, description: 'No clips selected' };
    const ops: OpEnvelope[] = [];
    for (const id of selectedClipIds) {
      const clip = seq.clips.find((c) => c.id === id);
      if (!clip) continue;
      const effect = createEffect('crop', clip.effects.length);
      ops.push(makeOp('clip.addEffect', { sequenceId: seqId, clipId: id, effect }, 'user'));
    }
    return { ops, description: 'Add crop effect', requiresConfirm: false, recognized: true };
  }

  // ── Add lower third ────────────────────────────────────────
  if (raw.startsWith('add lower third') || raw.startsWith('lower third')) {
    const label = raw.replace(/^(add )?lower third\s*/i, '').trim() || 'Speaker Name';
    const graphicTrack = seq.tracks.find((t) => t.kind === 'graphic') ?? seq.tracks.find((t) => t.kind === 'motion');
    if (!graphicTrack) return { ...ZERO_RESULT, recognized: true, description: 'No graphics track' };
    const startTime = fromSeconds(playheadFrame / fps, 30000);
    const ops = buildPlaceGraphicOps(seqId, 'lower-third', graphicTrack.id, startTime, 5, fps);
    if (ops.length > 0) {
      // Set the name param
      const clipId = (ops[0].payload as any).clip?.id;
      if (clipId) {
        ops.push(makeOp('graphic.setParam', { sequenceId: seqId, clipId, key: 'name', value: label }, 'user'));
      }
    }
    return { ops, description: `Add lower third: "${label}"`, requiresConfirm: false, recognized: true };
  }

  // ── Add title ──────────────────────────────────────────────
  if (raw.startsWith('add title') || raw.startsWith('title')) {
    const text = raw.replace(/^(add )?title\s*/i, '').trim() || 'Title';
    const graphicTrack = seq.tracks.find((t) => t.kind === 'graphic') ?? seq.tracks.find((t) => t.kind === 'motion');
    if (!graphicTrack) return { ...ZERO_RESULT, recognized: true, description: 'No graphics track' };
    const startTime = fromSeconds(playheadFrame / fps, 30000);
    const ops = buildPlaceGraphicOps(seqId, 'title', graphicTrack.id, startTime, 5, fps);
    if (ops.length > 0) {
      const clipId = (ops[0].payload as any).clip?.id;
      if (clipId) {
        ops.push(makeOp('graphic.setParam', { sequenceId: seqId, clipId, key: 'text', value: text }, 'user'));
      }
    }
    return { ops, description: `Add title: "${text}"`, requiresConfirm: false, recognized: true };
  }

  // ── Add captions ───────────────────────────────────────────
  if (raw === 'add captions' || raw === 'captions') {
    return { ops: [], description: 'Run Add Captions skill', requiresConfirm: true, recognized: true };
  }

  // ── Precompose selection ───────────────────────────────────
  if (raw === 'precompose' || raw === 'precompose selection' || raw === 'precomp') {
    return { ops: [], description: 'Precompose selection — use Skills > Precompose', requiresConfirm: true, recognized: true };
  }

  // ── Open precomp ───────────────────────────────────────────
  if (raw === 'open precomp' || raw === 'enter precomp' || raw === 'open nested') {
    return { ops: [], description: 'Open nested sequence — double-click precomp clip or use Precomp panel', requiresConfirm: false, recognized: true };
  }

  // ── Dissolve precomp ───────────────────────────────────────
  if (raw === 'dissolve precomp' || raw === 'dissolve nested') {
    if (selectedClipIds.length === 0) return { ...ZERO_RESULT, recognized: true, description: 'No clips selected' };
    const clip = seq.clips.find((c) => c.id === selectedClipIds[0]);
    if (!clip?.precompId) return { ...ZERO_RESULT, recognized: true, description: 'Selected clip is not a precomp' };
    const ops = [makeOp('precomp.dissolve', { precompId: clip.precompId, sequenceId: seqId }, 'user')];
    return { ops, description: 'Dissolve precomp', requiresConfirm: false, recognized: true };
  }

  // ── Duplicate project / Save As ────────────────────────────
  if (raw === 'save as' || raw === 'duplicate project') {
    return { ops: [], description: 'Save As / Duplicate — use Project Manager (click project name)', requiresConfirm: false, recognized: true };
  }

  // ── Relink selected media ──────────────────────────────────
  if (raw === 'relink media' || raw === 'relink selected media') {
    return { ops: [], description: 'Relink media — use Media Bin Relink button', requiresConfirm: false, recognized: true };
  }

  // ── Add transition ─────────────────────────────────────────
  if (raw.startsWith('add transition') || raw === 'transition') {
    const typeMatch = raw.match(/(cross.?dissolve|dip.?black|dip.?white|fade.?black|fade.?from|audio.?crossfade|wipe)/i);
    const type = typeMatch ? typeMatch[1].toLowerCase().replace(/\s+/g, '-') as any : 'cross-dissolve';
    if (selectedClipIds.length < 1) return { ...ZERO_RESULT, recognized: true, description: 'Select clips to add transition' };
    const clipA = seq.clips.find((c) => c.id === selectedClipIds[0]);
    const clipB = selectedClipIds.length > 1 ? seq.clips.find((c) => c.id === selectedClipIds[1]) : clipA;
    if (!clipA || !clipB) return { ...ZERO_RESULT, recognized: true, description: 'Clips not found' };
    const transition = {
      id: generateId('trans'),
      type: type as any,
      duration: fromSeconds(0.5, 30000),
      clipAId: clipA.id,
      clipBId: clipB.id,
      edge: 'cut-point' as const,
    };
    const ops = [makeOp('transition.upsert', { sequenceId: seqId, transition }, 'user')];
    return { ops, description: `Add ${type} transition`, requiresConfirm: false, recognized: true };
  }

  // ── Remove transition ──────────────────────────────────────
  if (raw === 'remove transition' || raw === 'delete transition') {
    if (selectedClipIds.length === 0) return { ...ZERO_RESULT, recognized: true, description: 'No clips selected' };
    const clip = seq.clips.find((c) => c.id === selectedClipIds[0]);
    const transitionId = clip?.transitionOutId ?? clip?.transitionInId;
    if (!transitionId) {
      // Find transition by clip reference
      const tr = seq.transitions.find((t) => t.clipAId === selectedClipIds[0] || t.clipBId === selectedClipIds[0]);
      if (!tr) return { ...ZERO_RESULT, recognized: true, description: 'No transition found on selected clip' };
      const ops = [makeOp('transition.remove', { sequenceId: seqId, transitionId: tr.id }, 'user')];
      return { ops, description: 'Remove transition', requiresConfirm: false, recognized: true };
    }
    const ops = [makeOp('transition.remove', { sequenceId: seqId, transitionId }, 'user')];
    return { ops, description: 'Remove transition', requiresConfirm: false, recognized: true };
  }

  // ── Next / Previous marker ─────────────────────────────────
  if (raw === 'next marker') {
    const markers = [...seq.markers].sort((a, b) => (a.time.value / a.time.timescale) - (b.time.value / b.time.timescale));
    const playheadSecs = playheadFrame / fps;
    const next = markers.find((m) => (m.time.value / m.time.timescale) > playheadSecs + 0.01);
    if (!next) return { ...ZERO_RESULT, recognized: true, description: 'No next marker' };
    const ops = [makeOp('playhead.set', { frame: Math.round((next.time.value / next.time.timescale) * fps) }, 'user')];
    return { ops, description: 'Next marker', requiresConfirm: false, recognized: true };
  }
  if (raw === 'prev marker' || raw === 'previous marker') {
    const markers = [...seq.markers].sort((a, b) => (b.time.value / b.time.timescale) - (a.time.value / a.time.timescale));
    const playheadSecs = playheadFrame / fps;
    const prev = markers.find((m) => (m.time.value / m.time.timescale) < playheadSecs - 0.01);
    if (!prev) return { ...ZERO_RESULT, recognized: true, description: 'No previous marker' };
    const ops = [makeOp('playhead.set', { frame: Math.round((prev.time.value / prev.time.timescale) * fps) }, 'user')];
    return { ops, description: 'Previous marker', requiresConfirm: false, recognized: true };
  }

  // ── Next / Previous keyframe ───────────────────────────────
  if (raw === 'next keyframe') {
    if (selectedClipIds.length === 0) return { ...ZERO_RESULT, recognized: true, description: 'No clips selected' };
    const clip = seq.clips.find((c) => c.id === selectedClipIds[0]);
    if (!clip) return { ...ZERO_RESULT, recognized: true, description: 'Clip not found' };
    const clipStartSecs = clip.startTime.value / clip.startTime.timescale;
    const localSecs = playheadFrame / fps - clipStartSecs;
    const sorted = [...clip.keyframes].sort((a, b) => (a.time.value / a.time.timescale) - (b.time.value / b.time.timescale));
    const next = sorted.find((k) => (k.time.value / k.time.timescale) > localSecs + 0.01);
    if (!next) return { ...ZERO_RESULT, recognized: true, description: 'No next keyframe' };
    const frame = Math.round((clipStartSecs + next.time.value / next.time.timescale) * fps);
    const ops = [makeOp('playhead.set', { frame }, 'user')];
    return { ops, description: 'Next keyframe', requiresConfirm: false, recognized: true };
  }
  if (raw === 'prev keyframe' || raw === 'previous keyframe') {
    if (selectedClipIds.length === 0) return { ...ZERO_RESULT, recognized: true, description: 'No clips selected' };
    const clip = seq.clips.find((c) => c.id === selectedClipIds[0]);
    if (!clip) return { ...ZERO_RESULT, recognized: true, description: 'Clip not found' };
    const clipStartSecs = clip.startTime.value / clip.startTime.timescale;
    const localSecs = playheadFrame / fps - clipStartSecs;
    const sorted = [...clip.keyframes].sort((a, b) => (b.time.value / b.time.timescale) - (a.time.value / a.time.timescale));
    const prev = sorted.find((k) => (k.time.value / k.time.timescale) < localSecs - 0.01);
    if (!prev) return { ...ZERO_RESULT, recognized: true, description: 'No previous keyframe' };
    const frame = Math.round((clipStartSecs + prev.time.value / prev.time.timescale) * fps);
    const ops = [makeOp('playhead.set', { frame }, 'user')];
    return { ops, description: 'Previous keyframe', requiresConfirm: false, recognized: true };
  }

  // ── Toggle guides ──────────────────────────────────────────
  if (raw === 'toggle guides' || raw === 'guides') {
    return { ops: [], description: 'Toggle guides — press G or click ⊕ in viewer', requiresConfirm: false, recognized: true };
  }

  // ── Toggle safe areas ──────────────────────────────────────
  if (raw === 'toggle safe areas' || raw === 'safe areas') {
    return { ops: [], description: 'Toggle safe areas — click SA in viewer', requiresConfirm: false, recognized: true };
  }

  // ── Move selection to targeted track ──────────────────────
  if (raw === 'move to targeted track' || raw === 'move to target') {
    if (selectedClipIds.length === 0) return { ...ZERO_RESULT, recognized: true, description: 'No clips selected' };
    const targetTrack = seq.tracks.find((t) => t.targeted && t.kind === 'video');
    if (!targetTrack) return { ...ZERO_RESULT, recognized: true, description: 'No targeted video track' };
    const ops = selectedClipIds.map((id) => {
      const clip = seq.clips.find((c) => c.id === id);
      if (!clip) return null;
      return makeOp('clip.move', { sequenceId: seqId, clipId: id, newStartTime: clip.startTime, newTrackId: targetTrack.id }, 'user');
    }).filter(Boolean) as OpEnvelope[];
    return { ops, description: `Move to ${targetTrack.label}`, requiresConfirm: false, recognized: true };
  }

  // ── Unknown command — zero ops, fail closed ────────────────
  return ZERO_RESULT;
}

function getClipsAtFrame(seq: Sequence, frame: number, fps: number): Clip[] {
  const timeSecs = frame / fps;
  return seq.clips.filter((c) => {
    const start = c.startTime.value / c.startTime.timescale;
    const end = start + c.duration.value / c.duration.timescale;
    return timeSecs >= start && timeSecs < end;
  });
}
