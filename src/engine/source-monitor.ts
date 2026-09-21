/**
 * CutLab Source Monitor — Section 2
 * Ephemeral session state for preparing media before timeline insertion.
 * Source monitor state is SessionState — never increments project revision.
 * Placed media becomes normal canonical timeline clips.
 */

import type { RationalTime } from './time';
import { fromSeconds } from './time';
import type { Asset, Clip, Track } from './schema';
import { generateId, DEFAULT_TRANSFORM } from './schema';
import type { OpEnvelope } from './operations';
import { makeOp } from './operations';

// ── Source Monitor State ──────────────────────────────────────

export interface SourceMonitorState {
  /** Currently loaded asset ID (null = empty) */
  assetId: string | null;
  /** Source playhead frame */
  playheadFrame: number;
  /** Source In point (frame) — null = beginning */
  inFrame: number | null;
  /** Source Out point (frame) — null = end */
  outFrame: number | null;
  /** Whether source is playing */
  playing: boolean;
}

export const DEFAULT_SOURCE_MONITOR: SourceMonitorState = {
  assetId: null,
  playheadFrame: 0,
  inFrame: null,
  outFrame: null,
  playing: false,
};

// ── Source In/Out helpers ─────────────────────────────────────

export function sourceInTime(state: SourceMonitorState, fps: number): RationalTime {
  const frame = state.inFrame ?? 0;
  return fromSeconds(frame / fps, 30000);
}

export function sourceOutTime(state: SourceMonitorState, asset: Asset, fps: number): RationalTime {
  const frame = state.outFrame ?? (asset.durationFrames ?? 0);
  return fromSeconds(frame / fps, 30000);
}

export function sourceDurationFrames(state: SourceMonitorState, asset: Asset): number {
  const inF = state.inFrame ?? 0;
  const outF = state.outFrame ?? (asset.durationFrames ?? 0);
  return Math.max(0, outF - inF);
}

// ── Insert / Overwrite into timeline ─────────────────────────

export interface PlaceOptions {
  sequenceId: string;
  targetTrack: Track;
  /** For insert: push clips after; for overwrite: replace underneath */
  mode: 'insert' | 'overwrite';
  /** Timeline position to place at */
  timelineFrame: number;
  fps: number;
}

/**
 * Build canonical ops to place source monitor content onto the timeline.
 * Returns ops — caller dispatches them.
 */
export function buildPlaceOps(
  state: SourceMonitorState,
  asset: Asset,
  options: PlaceOptions
): OpEnvelope[] {
  if (!state.assetId || !asset) return [];

  const { sequenceId, targetTrack, mode, timelineFrame, fps } = options;
  const inF = state.inFrame ?? 0;
  const outF = state.outFrame ?? (asset.durationFrames ?? 0);
  const durationFrames = Math.max(1, outF - inF);

  const startTime = fromSeconds(timelineFrame / fps, 30000);
  const duration = fromSeconds(durationFrames / fps, 30000);
  const sourceIn = fromSeconds(inF / fps, 30000);
  const sourceOut = fromSeconds(outF / fps, 30000);

  const clipId = generateId('clip');
  const clip: Clip = {
    id: clipId,
    kind: targetTrack.kind === 'audio' ? 'audio' : 'video',
    trackId: targetTrack.id,
    assetId: asset.id,
    name: asset.name,
    startTime,
    duration,
    sourceIn,
    sourceOut,
    transform: { ...DEFAULT_TRANSFORM },
    keyframes: [],
    effects: [],
    masks: [],
    gain: 0,
    fadeIn: { value: 0, timescale: 30000 },
    fadeOut: { value: 0, timescale: 30000 },
    speed: 1,
    reverse: false,
    freeze: false,
    disabled: false,
  };

  if (mode === 'insert') {
    return [makeOp('timeline.insertEdit', {
      sequenceId,
      clip,
      insertTime: startTime,
      targetTrackId: targetTrack.id,
    }, 'user')];
  } else {
    return [makeOp('timeline.overwriteEdit', {
      sequenceId,
      clip,
      startTime,
      targetTrackId: targetTrack.id,
    }, 'user')];
  }
}

// ── Linked A/V placement ──────────────────────────────────────

/**
 * Build ops to place both video and audio clips from a video asset.
 * Returns linked A/V pair ops.
 */
export function buildLinkedPlaceOps(
  state: SourceMonitorState,
  asset: Asset,
  videoTrack: Track,
  audioTrack: Track,
  sequenceId: string,
  timelineFrame: number,
  fps: number,
  mode: 'insert' | 'overwrite' = 'overwrite'
): OpEnvelope[] {
  if (!state.assetId || !asset) return [];

  const inF = state.inFrame ?? 0;
  const outF = state.outFrame ?? (asset.durationFrames ?? 0);
  const durationFrames = Math.max(1, outF - inF);

  const startTime = fromSeconds(timelineFrame / fps, 30000);
  const duration = fromSeconds(durationFrames / fps, 30000);
  const sourceIn = fromSeconds(inF / fps, 30000);
  const sourceOut = fromSeconds(outF / fps, 30000);

  const groupId = generateId('link');
  const videoClipId = generateId('clip');
  const audioClipId = generateId('clip');

  const baseClip = {
    assetId: asset.id,
    name: asset.name,
    startTime,
    duration,
    sourceIn,
    sourceOut,
    transform: { ...DEFAULT_TRANSFORM },
    keyframes: [],
    effects: [],
    masks: [],
    gain: 0,
    fadeIn: { value: 0, timescale: 30000 },
    fadeOut: { value: 0, timescale: 30000 },
    speed: 1,
    reverse: false,
    freeze: false,
    disabled: false,
    linkGroupId: groupId,
  };

  const videoClip: Clip = { ...baseClip, id: videoClipId, kind: 'video', trackId: videoTrack.id };
  const audioClip: Clip = { ...baseClip, id: audioClipId, kind: 'audio', trackId: audioTrack.id };

  const placeOp = mode === 'insert' ? 'timeline.insertEdit' : 'timeline.overwriteEdit';

  return [
    makeOp(placeOp as any, {
      sequenceId,
      clip: videoClip,
      [mode === 'insert' ? 'insertTime' : 'startTime']: startTime,
      targetTrackId: videoTrack.id,
    }, 'user'),
    makeOp(placeOp as any, {
      sequenceId,
      clip: audioClip,
      [mode === 'insert' ? 'insertTime' : 'startTime']: startTime,
      targetTrackId: audioTrack.id,
    }, 'user'),
  ];
}
