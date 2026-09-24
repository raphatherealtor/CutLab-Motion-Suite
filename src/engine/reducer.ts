/**
 * CutLab Kernel Reducer v2
 * (ProjectData, OpEnvelope) → ProjectData
 * Pure function. Deterministic. No side effects.
 * This is the ONE mutation door.
 */

import type { ProjectData, Clip, Sequence, Precomp } from './schema';
import type { OpEnvelope } from './operations';
import { SESSION_ONLY_OPS } from './operations';
import { add, sub, compare, fromSeconds } from './time';
import type { RationalTime } from './time';
import { applyMotionTransaction } from './motion-document';
import type { MotionTransaction } from './motion-document';

export interface ReducerResult {
  state: ProjectData;
  /** true if this op incremented revision (persistent edit) */
  didMutate: boolean;
}

export function applyOp(state: ProjectData, envelope: OpEnvelope): ReducerResult {
  // Idempotency: if opId already in history, skip
  if (state.opHistory.some((r) => r.opId === envelope.opId)) {
    return { state, didMutate: false };
  }

  // Session-only ops don't touch project data
  if (SESSION_ONLY_OPS.has(envelope.type)) {
    return { state, didMutate: false };
  }

  // Stale-state protection
  if (envelope.expectedRevision !== undefined && envelope.expectedRevision !== state.revision) {
    console.warn(`[cutlab] stale op ${envelope.opId}: expected rev ${envelope.expectedRevision}, got ${state.revision}`);
    return { state, didMutate: false };
  }

  const newState = reduce(state, envelope);
  // No-change ops (rejected/failed-closed edits) must not bump revision
  // or create undo history entries.
  if (newState === state) {
    return { state, didMutate: false };
  }
  const now = Date.now();

  return {
    state: {
      ...newState,
      revision: newState.revision + 1,
      updatedAt: now,
      opHistory: [
        ...newState.opHistory,
        { opId: envelope.opId, type: envelope.type, revision: newState.revision + 1, createdAt: now },
      ],
    },
    didMutate: true,
  };
}

export function applyOps(state: ProjectData, envelopes: OpEnvelope[]): ReducerResult {
  let current = state;
  let anyMutated = false;
  for (const env of envelopes) {
    const result = applyOp(current, env);
    current = result.state;
    if (result.didMutate) anyMutated = true;
  }
  return { state: current, didMutate: anyMutated };
}

// ── Core reducer ──────────────────────────────────────────────

function reduce(state: ProjectData, env: OpEnvelope): ProjectData {
  const p = env.payload as any;

  switch (env.type) {
    // ── Assets ──────────────────────────────────────────────
    case 'asset.register': {
      return { ...state, assets: { ...state.assets, [p.asset.id]: p.asset } };
    }
    case 'asset.setProps': {
      const existing = state.assets[p.assetId];
      if (!existing) return state;
      return { ...state, assets: { ...state.assets, [p.assetId]: { ...existing, ...p.props } } };
    }
    case 'asset.remove': {
      const { [p.assetId]: _removed, ...rest } = state.assets;
      return { ...state, assets: rest };
    }
    case 'asset.relink': {
      const existing = state.assets[p.assetId];
      if (!existing) return state;
      return {
        ...state,
        assets: {
          ...state.assets,
          [p.assetId]: { ...existing, sourceRef: p.newSourceRef, runtimeUrl: p.newRuntimeUrl, caste: 'relinked' },
        },
      };
    }

    // ── Clips ────────────────────────────────────────────────
    case 'clip.add': case'graphic.place': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        clips: [...seq.clips, ensureClipDefaults(p.clip)],
      }));
    }
    case 'clip.move': {
      return mutateSeq(state, p.sequenceId, (seq) => {
        const clip = seq.clips.find((c) => c.id === p.clipId);
        if (!clip) return seq;
        // Move linked clips together
        const linkedIds = clip.linkGroupId
          ? seq.clips.filter((c) => c.linkGroupId === clip.linkGroupId).map((c) => c.id)
          : [p.clipId];
        const delta = sub(p.newStartTime, clip.startTime);
        return {
          ...seq,
          clips: seq.clips.map((c) => {
            if (c.id === p.clipId) {
              return { ...c, startTime: p.newStartTime, trackId: p.newTrackId ?? c.trackId };
            }
            if (linkedIds.includes(c.id) && c.id !== p.clipId) {
              return { ...c, startTime: add(c.startTime, delta) };
            }
            return c;
          }),
        };
      });
    }
    case 'clip.trim': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        clips: seq.clips.map((c) => {
          if (c.id !== p.clipId) return c;
          if (p.edge === 'in') {
            const delta = sub(p.newTime, c.startTime);
            const newDuration = sub(c.duration, delta);
            if (compare(newDuration, { value: 1, timescale: c.duration.timescale }) < 0) return c;
            const newSourceIn = add(c.sourceIn, delta);
            // Ripple: shift subsequent clips
            return { ...c, startTime: p.newTime, duration: newDuration, sourceIn: newSourceIn };
          } else {
            const newDuration = sub(p.newTime, c.startTime);
            if (compare(newDuration, { value: 1, timescale: c.duration.timescale }) < 0) return c;
            const newSourceOut = add(c.sourceIn, newDuration);
            return { ...c, duration: newDuration, sourceOut: newSourceOut };
          }
        }),
      }));
    }
    case 'clip.split': {
      return mutateSeq(state, p.sequenceId, (seq) => {
        const clip = seq.clips.find((c) => c.id === p.clipId);
        if (!clip) return seq;
        const splitTime = p.splitTime as RationalTime;
        const splitOffset = sub(splitTime, clip.startTime);
        if (compare(splitOffset, { value: 0, timescale: splitOffset.timescale }) <= 0) return seq;
        if (compare(splitOffset, clip.duration) >= 0) return seq;

        const leftDuration = splitOffset;
        const rightDuration = sub(clip.duration, splitOffset);
        const rightSourceIn = add(clip.sourceIn, splitOffset);

        const left: Clip = { ...clip, duration: leftDuration, sourceOut: add(clip.sourceIn, leftDuration), transitionOutId: undefined };
        const right: Clip = {
          ...clip,
          id: `${clip.id}-split-${Date.now()}`,
          startTime: splitTime,
          duration: rightDuration,
          sourceIn: rightSourceIn,
          sourceOut: clip.sourceOut,
          transitionInId: undefined,
          keyframes: [],
        };

        return {
          ...seq,
          clips: seq.clips.flatMap((c) => (c.id === p.clipId ? [left, right] : [c])),
        };
      });
    }
    case 'clip.delete': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        clips: seq.clips.filter((c) => !p.clipIds.includes(c.id)),
        transitions: seq.transitions.filter(
          (t) => !p.clipIds.includes(t.clipAId) && !p.clipIds.includes(t.clipBId)
        ),
      }));
    }
    case 'clip.rippleDelete': {
      return mutateSeq(state, p.sequenceId, (seq) => {
        const toDelete = new Set<string>(p.clipIds);
        const deleted = seq.clips.filter((c) => toDelete.has(c.id));
        if (deleted.length === 0) return seq;

        const trackDeltas: Record<string, { startTime: RationalTime; totalDuration: RationalTime }> = {};
        for (const clip of deleted) {
          if (!trackDeltas[clip.trackId]) {
            trackDeltas[clip.trackId] = { startTime: clip.startTime, totalDuration: clip.duration };
          } else {
            const existing = trackDeltas[clip.trackId];
            if (compare(clip.startTime, existing.startTime) < 0) {
              trackDeltas[clip.trackId].startTime = clip.startTime;
            }
            trackDeltas[clip.trackId].totalDuration = add(existing.totalDuration, clip.duration);
          }
        }

        return {
          ...seq,
          clips: seq.clips
            .filter((c) => !toDelete.has(c.id))
            .map((c) => {
              const delta = trackDeltas[c.trackId];
              if (!delta) return c;
              if (compare(c.startTime, delta.startTime) >= 0) {
                return { ...c, startTime: sub(c.startTime, delta.totalDuration) };
              }
              return c;
            }),
          transitions: seq.transitions.filter(
            (t) => !toDelete.has(t.clipAId) && !toDelete.has(t.clipBId)
          ),
        };
      });
    }
    case 'clip.link': {
      const groupId = p.groupId || `link-${Date.now()}`;
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        clips: seq.clips.map((c) =>
          p.clipIds.includes(c.id) ? { ...c, linkGroupId: groupId } : c
        ),
      }));
    }
    case 'clip.unlink': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        clips: seq.clips.map((c) =>
          c.id === p.clipId ? { ...c, linkGroupId: undefined } : c
        ),
      }));
    }
    case 'clip.duplicate': {
      return mutateSeq(state, p.sequenceId, (seq) => {
        const original = seq.clips.find((c) => c.id === p.clipId);
        if (!original) return seq;
        const offset = fromSeconds(0.5, original.startTime.timescale);
        const dupe: Clip = {
          ...original,
          id: p.newClipId,
          startTime: add(original.startTime, offset),
          linkGroupId: undefined,
          transitionInId: undefined,
          transitionOutId: undefined,
        };
        return { ...seq, clips: [...seq.clips, dupe] };
      });
    }
    case 'clip.setProps': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        clips: seq.clips.map((c) => (c.id === p.clipId ? { ...c, ...p.props } : c)),
      }));
    }
    case 'clip.setTransform': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        clips: seq.clips.map((c) =>
          c.id === p.clipId ? { ...c, transform: { ...c.transform, ...p.transform } } : c
        ),
      }));
    }
    case 'clip.setGain': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        clips: seq.clips.map((c) => (c.id === p.clipId ? { ...c, gain: p.gain } : c)),
      }));
    }
    case 'clip.setSpeed': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        clips: seq.clips.map((c) =>
          c.id === p.clipId ? { ...c, speed: p.speed, reverse: p.reverse ?? c.reverse } : c
        ),
      }));
    }
    case 'clip.setFreeze': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        clips: seq.clips.map((c) =>
          c.id === p.clipId ? { ...c, freeze: p.freeze, freezeFrame: p.freezeFrame ?? c.freezeFrame } : c
        ),
      }));
    }
    case 'clip.addEffect': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        clips: seq.clips.map((c) =>
          c.id === p.clipId ? { ...c, effects: [...c.effects, p.effect] } : c
        ),
      }));
    }
    case 'clip.removeEffect': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        clips: seq.clips.map((c) =>
          c.id === p.clipId ? { ...c, effects: c.effects.filter((e) => e.id !== p.effectId) } : c
        ),
      }));
    }
    case 'clip.setEffect': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        clips: seq.clips.map((c) =>
          c.id === p.clipId
            ? { ...c, effects: c.effects.map((e) => (e.id === p.effectId ? { ...e, ...p.props } : e)) }
            : c
        ),
      }));
    }
    case 'clip.reorderEffect': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        clips: seq.clips.map((c) => {
          if (c.id !== p.clipId) return c;
          const effects = c.effects.map((e) =>
            e.id === p.effectId ? { ...e, order: p.newOrder } : e
          ).sort((a, b) => a.order - b.order);
          return { ...c, effects };
        }),
      }));
    }
    case 'clip.addMask': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        clips: seq.clips.map((c) =>
          c.id === p.clipId ? { ...c, masks: [...(c.masks || []), p.mask] } : c
        ),
      }));
    }
    case 'clip.setMask': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        clips: seq.clips.map((c) =>
          c.id === p.clipId
            ? { ...c, masks: (c.masks || []).map((m) => m.id === p.maskId ? { ...m, ...p.props } : m) }
            : c
        ),
      }));
    }
    case 'clip.removeMask': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        clips: seq.clips.map((c) =>
          c.id === p.clipId ? { ...c, masks: (c.masks || []).filter((m) => m.id !== p.maskId) } : c
        ),
      }));
    }
    case 'clip.enable': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        clips: seq.clips.map((c) =>
          c.id === p.clipId ? { ...c, disabled: !p.enabled } : c
        ),
      }));
    }
    case 'clip.disable': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        clips: seq.clips.map((c) =>
          c.id === p.clipId ? { ...c, disabled: true } : c
        ),
      }));
    }

    // ── Keyframes ────────────────────────────────────────────
    case 'keyframe.upsert': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        clips: seq.clips.map((c) => {
          if (c.id !== p.clipId) return c;
          const existing = c.keyframes.findIndex((k) => k.id === p.keyframe.id);
          if (existing >= 0) {
            const kfs = [...c.keyframes];
            kfs[existing] = p.keyframe;
            return { ...c, keyframes: kfs };
          }
          return { ...c, keyframes: [...c.keyframes, p.keyframe] };
        }),
      }));
    }
    case 'keyframe.remove': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        clips: seq.clips.map((c) =>
          c.id === p.clipId ? { ...c, keyframes: c.keyframes.filter((k) => k.id !== p.keyframeId) } : c
        ),
      }));
    }
    case 'keyframe.move': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        clips: seq.clips.map((c) =>
          c.id === p.clipId
            ? { ...c, keyframes: c.keyframes.map((k) => k.id === p.keyframeId ? { ...k, time: p.newTime } : k) }
            : c
        ),
      }));
    }
    case 'keyframe.setEasing': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        clips: seq.clips.map((c) =>
          c.id === p.clipId
            ? { ...c, keyframes: c.keyframes.map((k) => k.id === p.keyframeId ? { ...k, easing: p.easing } : k) }
            : c
        ),
      }));
    }

    // ── Tracks ───────────────────────────────────────────────
    case 'track.add': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        tracks: [...seq.tracks, p.track],
      }));
    }
    case 'track.set': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        tracks: seq.tracks.map((t) => (t.id === p.trackId ? { ...t, ...p.props } : t)),
      }));
    }
    case 'track.reorder': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        tracks: seq.tracks.map((t) => (t.id === p.trackId ? { ...t, order: p.order } : t)),
      }));
    }

    // ── Sequences ────────────────────────────────────────────
    case 'sequence.create': {
      return {
        ...state,
        sequences: { ...state.sequences, [p.sequence.id]: ensureSequenceDefaults(p.sequence) },
        activeSequenceId: p.sequence.id,
      };
    }
    case 'sequence.setFormat': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        format: { ...seq.format, ...p.format },
      }));
    }
    case 'sequence.setInOut': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        inPoint: p.inPoint,
        outPoint: p.outPoint,
      }));
    }
    case 'sequence.duplicate': {
      const original = state.sequences[p.sequenceId];
      if (!original) return state;
      const newSeq: Sequence = {
        ...original,
        id: p.newSequenceId,
        name: p.newName,
        clips: original.clips.map((c) => ({ ...c, id: `${c.id}-dup` })),
        markers: original.markers.map((m) => ({ ...m, id: `${m.id}-dup` })),
        captions: original.captions.map((cap) => ({ ...cap, id: `${cap.id}-dup` })),
        transitions: original.transitions.map((t) => ({ ...t, id: `${t.id}-dup` })),
        cues: original.cues.map((cue) => ({ ...cue, id: `${cue.id}-dup` })),
      };
      return {
        ...state,
        sequences: { ...state.sequences, [p.newSequenceId]: newSeq },
      };
    }

    // ── Timeline range ops ───────────────────────────────────
    case 'timeline.rippleDeleteRange': {
      return mutateSeq(state, p.sequenceId, (seq) => {
        const start = p.startTime as RationalTime;
        const end = p.endTime as RationalTime;
        const rangeDuration = sub(end, start);

        return {
          ...seq,
          clips: seq.clips
            .filter((c) => {
              const clipEnd = add(c.startTime, c.duration);
              return !(compare(c.startTime, start) >= 0 && compare(clipEnd, end) <= 0);
            })
            .map((c) => {
              if (compare(c.startTime, end) >= 0) {
                return { ...c, startTime: sub(c.startTime, rangeDuration) };
              }
              return c;
            }),
        };
      });
    }
    case 'timeline.insertGap': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        clips: seq.clips.map((c) => {
          if (c.trackId !== p.trackId) return c;
          if (compare(c.startTime, p.startTime) >= 0) {
            return { ...c, startTime: add(c.startTime, p.duration) };
          }
          return c;
        }),
      }));
    }
    case 'timeline.closeGap': {
      return mutateSeq(state, p.sequenceId, (seq) => {
        const clipsOnTrack = seq.clips.filter((c) => c.trackId === p.trackId);
        const clipBefore = clipsOnTrack
          .filter((c) => compare(add(c.startTime, c.duration), p.gapStartTime) <= 0)
          .sort((a, b) => compare(b.startTime, a.startTime))[0];
        const clipAfter = clipsOnTrack
          .filter((c) => compare(c.startTime, p.gapStartTime) >= 0)
          .sort((a, b) => compare(a.startTime, b.startTime))[0];

        if (!clipBefore || !clipAfter) return seq;
        const gapEnd = clipAfter.startTime;
        const gapStart = add(clipBefore.startTime, clipBefore.duration);
        const gapSize = sub(gapEnd, gapStart);

        return {
          ...seq,
          clips: seq.clips.map((c) => {
            if (c.trackId !== p.trackId) return c;
            if (compare(c.startTime, gapEnd) >= 0) {
              return { ...c, startTime: sub(c.startTime, gapSize) };
            }
            return c;
          }),
        };
      });
    }
    case 'timeline.insertEdit': {
      // Insert edit: push clips after insertTime to make room
      return mutateSeq(state, p.sequenceId, (seq) => {
        const clipDuration = p.clip.duration as RationalTime;
        const insertTime = p.insertTime as RationalTime;
        const shiftedClips = seq.clips.map((c) => {
          if (c.trackId === p.targetTrackId && compare(c.startTime, insertTime) >= 0) {
            return { ...c, startTime: add(c.startTime, clipDuration) };
          }
          return c;
        });
        return {
          ...seq,
          clips: [...shiftedClips, ensureClipDefaults({ ...p.clip, startTime: insertTime, trackId: p.targetTrackId })],
        };
      });
    }
    case 'timeline.overwriteEdit': {
      // Overwrite edit: place clip, removing/trimming anything underneath
      return mutateSeq(state, p.sequenceId, (seq) => {
        const newClip = ensureClipDefaults({ ...p.clip, startTime: p.startTime, trackId: p.targetTrackId });
        const newEnd = add(newClip.startTime, newClip.duration);
        const filteredClips = seq.clips.filter((c) => {
          if (c.trackId !== p.targetTrackId) return true;
          const clipEnd = add(c.startTime, c.duration);
          // Remove clips fully covered
          return !(compare(c.startTime, newClip.startTime) >= 0 && compare(clipEnd, newEnd) <= 0);
        });
        return { ...seq, clips: [...filteredClips, newClip] };
      });
    }

    // ── Transitions ──────────────────────────────────────────
    case 'transition.upsert': {
      return mutateSeq(state, p.sequenceId, (seq) => {
        const existing = seq.transitions.findIndex((t) => t.id === p.transition.id);
        if (existing >= 0) {
          const trans = [...seq.transitions];
          trans[existing] = p.transition;
          return { ...seq, transitions: trans };
        }
        return { ...seq, transitions: [...seq.transitions, p.transition] };
      });
    }
    case 'transition.remove': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        transitions: seq.transitions.filter((t) => t.id !== p.transitionId),
      }));
    }
    case 'transition.setProps': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        transitions: seq.transitions.map((t) =>
          t.id === p.transitionId ? { ...t, ...p.props } : t
        ),
      }));
    }

    // ── Precomps ─────────────────────────────────────────────
    case 'precomp.create': {
      const precomp: Precomp = p.precomp;
      const childSeq: Sequence = ensureSequenceDefaults(p.childSequence);
      const parentClip: Clip = ensureClipDefaults(p.parentClip);
      // sourceClipIds is passed by PrecompPanel to remove original clips
      const sourceClipIds: string[] = p.sourceClipIds ?? [];
      return {
        ...state,
        precomps: { ...state.precomps, [precomp.id]: precomp },
        sequences: {
          ...state.sequences,
          [childSeq.id]: childSeq,
          [precomp.parentSequenceId]: {
            ...state.sequences[precomp.parentSequenceId],
            clips: [
              ...state.sequences[precomp.parentSequenceId].clips.filter(
                (c) => sourceClipIds.length === 0 || !sourceClipIds.includes(c.id)
              ),
              parentClip,
            ],
          },
        },
      };
    }
    case 'precomp.dissolve': {
      const precomp = state.precomps[p.precompId];
      if (!precomp) return state;
      const childSeq = state.sequences[precomp.sequenceId];
      if (!childSeq) return state;
      const parentSeq = state.sequences[precomp.parentSequenceId];
      if (!parentSeq) return state;
      // Remove precomp clip, insert child clips
      const parentClip = parentSeq.clips.find((c) => c.id === precomp.parentClipId);
      const offset = parentClip?.startTime ?? fromSeconds(0, 30000);
      const dissolvedClips = childSeq.clips.map((c) => ({
        ...c,
        startTime: add(c.startTime, offset),
        precompId: undefined,
      }));
      const { [p.precompId]: _removedPrecomp, ...restPrecomps } = state.precomps;
      return {
        ...state,
        precomps: restPrecomps,
        sequences: {
          ...state.sequences,
          [precomp.parentSequenceId]: {
            ...parentSeq,
            clips: [
              ...parentSeq.clips.filter((c) => c.id !== precomp.parentClipId),
              ...dissolvedClips,
            ],
          },
        },
      };
    }
    case 'precomp.duplicate': {
      const original = state.precomps[p.precompId];
      if (!original) return state;
      const originalSeq = state.sequences[original.sequenceId];
      if (!originalSeq) return state;
      const newSeq: Sequence = {
        ...originalSeq,
        id: p.newSequenceId,
        name: `${originalSeq.name} Copy`,
        clips: originalSeq.clips.map((c) => ({ ...c, id: `${c.id}-dup` })),
      };
      const newPrecomp: Precomp = {
        ...original,
        id: p.newPrecompId,
        sequenceId: p.newSequenceId,
        createdAt: Date.now(),
      };
      return {
        ...state,
        precomps: { ...state.precomps, [p.newPrecompId]: newPrecomp },
        sequences: { ...state.sequences, [p.newSequenceId]: newSeq },
      };
    }

    // ── Markers ──────────────────────────────────────────────
    case 'marker.add': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        markers: [...seq.markers, p.marker],
      }));
    }
    case 'marker.remove': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        markers: seq.markers.filter((m) => m.id !== p.markerId),
      }));
    }
    case 'marker.set': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        markers: seq.markers.map((m) => (m.id === p.markerId ? { ...m, ...p.props } : m)),
      }));
    }

    // ── Captions ─────────────────────────────────────────────
    case 'caption.upsert': {
      return mutateSeq(state, p.sequenceId, (seq) => {
        const existing = seq.captions.findIndex((c) => c.id === p.caption.id);
        if (existing >= 0) {
          const caps = [...seq.captions];
          caps[existing] = p.caption;
          return { ...seq, captions: caps };
        }
        return { ...seq, captions: [...seq.captions, p.caption] };
      });
    }
    case 'caption.remove': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        captions: seq.captions.filter((c) => c.id !== p.captionId),
      }));
    }
    case 'caption.split': {
      return mutateSeq(state, p.sequenceId, (seq) => {
        const cap = seq.captions.find((c) => c.id === p.captionId);
        if (!cap) return seq;
        const splitTime = p.splitTime as RationalTime;
        const leftCap = { ...cap, endTime: splitTime };
        const rightCap = { ...cap, id: p.newCaptionId, startTime: splitTime };
        return {
          ...seq,
          captions: seq.captions.flatMap((c) => c.id === p.captionId ? [leftCap, rightCap] : [c]),
        };
      });
    }
    case 'caption.merge': {
      return mutateSeq(state, p.sequenceId, (seq) => {
        const capA = seq.captions.find((c) => c.id === p.captionIdA);
        const capB = seq.captions.find((c) => c.id === p.captionIdB);
        if (!capA || !capB) return seq;
        const merged = {
          ...capA,
          endTime: capB.endTime,
          text: `${capA.text} ${capB.text}`.trim(),
        };
        return {
          ...seq,
          captions: seq.captions
            .filter((c) => c.id !== p.captionIdA && c.id !== p.captionIdB)
            .concat(merged),
        };
      });
    }
    case 'caption.setStyle': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        captions: seq.captions.map((c) =>
          c.id === p.captionId ? { ...c, style: { ...(c.style || {}), ...p.style } } : c
        ),
      }));
    }

    // ── Transcript ───────────────────────────────────────────
    case 'transcript.upsert': {
      const asset = state.assets[p.assetId];
      if (!asset) return state;
      return {
        ...state,
        assets: {
          ...state.assets,
          [p.assetId]: { ...asset, transcriptWords: p.words },
        },
      };
    }

    // ── Graphics ─────────────────────────────────────────────
    case 'graphic.setParam': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        clips: seq.clips.map((c) =>
          c.id === p.clipId
            ? { ...c, graphicParams: { ...(c.graphicParams || {}), [p.key]: p.value } }
            : c
        ),
      }));
    }
    case 'graphic.setType': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        clips: seq.clips.map((c) =>
          c.id === p.clipId ? { ...c, graphicType: p.graphicType } : c
        ),
      }));
    }

    // ── Cues ─────────────────────────────────────────────────
    case 'cue.upsert': {
      return mutateSeq(state, p.sequenceId, (seq) => {
        const existing = seq.cues.findIndex((c) => c.id === p.cue.id);
        if (existing >= 0) {
          const cues = [...seq.cues];
          cues[existing] = p.cue;
          return { ...seq, cues };
        }
        return { ...seq, cues: [...seq.cues, p.cue] };
      });
    }
    case 'cue.remove': {
      return mutateSeq(state, p.sequenceId, (seq) => ({
        ...seq,
        cues: seq.cues.filter((c) => c.id !== p.cueId),
      }));
    }

    // ── Versions ─────────────────────────────────────────────
    case 'version.create': {
      const ver = {
        id: `ver-${Date.now()}`,
        label: p.label,
        revision: state.revision,
        createdAt: Date.now(),
        snapshotJson: p.snapshotJson,
      };
      return { ...state, versions: [...state.versions, ver] };
    }
    case 'version.restore': {
      // Restore is handled at store level
      return state;
    }

    // ── Settings ─────────────────────────────────────────────
    case 'settings.patch': {
      return { ...state, settings: { ...state.settings, ...p.settings } };
    }

    // ── Motion Documents ─────────────────────────────────────
    case 'motion.document.patch': {
      const { documentId, transaction } = env.payload as import('./operations').MotionDocumentPatchPayload;
      const existing = state.motionDocuments?.[documentId];
      if (!existing) return state;
      const updated = applyMotionTransaction(existing, transaction);
      // Rejected (locked/stale/no-op) transactions return the same reference —
      // no state change, no history entry.
      if (updated === existing) return state;
      return {
        ...state,
        motionDocuments: { ...(state.motionDocuments ?? {}), [documentId]: updated },
      };
    }
    case 'motion.document.register': {
      const { document } = env.payload as import('./operations').MotionDocumentRegisterPayload;
      if (!document) return state;
      return {
        ...state,
        motionDocuments: { ...(state.motionDocuments ?? {}), [document.id]: document },
      };
    }
    case 'motionDocument.upsert': {
      // Legacy: payload = { resource: { id, documentJson, ... } }
      const { resource } = env.payload as import('./operations').LegacyMotionDocumentUpsertPayload;
      if (!resource) return state;
      try {
        const doc = typeof resource.documentJson === 'string'
          ? JSON.parse(resource.documentJson)
          : resource;
        return {
          ...state,
          motionDocuments: { ...(state.motionDocuments ?? {}), [doc.id]: doc },
        };
      } catch {
        return state;
      }
    }
    case 'motion.document.remove': {
      const { [p.documentId]: _rm, ...rest } = state.motionDocuments ?? {};
      return { ...state, motionDocuments: rest };
    }

    default:
      return state;
  }
}

// ── Helpers ───────────────────────────────────────────────────

function mutateSeq(
  state: ProjectData,
  sequenceId: string,
  fn: (seq: Sequence) => Sequence
): ProjectData {
  const seq = state.sequences[sequenceId];
  if (!seq) return state;
  return {
    ...state,
    sequences: { ...state.sequences, [sequenceId]: fn(seq) },
  };
}

function ensureClipDefaults(clip: Partial<Clip> & { id: string; kind: Clip['kind']; trackId: string; name: string; startTime: any; duration: any; sourceIn: any; sourceOut: any }): Clip {
  return {
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0 },
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
    ...clip,
  };
}

function ensureSequenceDefaults(seq: Partial<Sequence> & { id: string; name: string }): Sequence {
  return {
    format: { width: 1920, height: 1080, fps: 29.97, fpsTimescale: 30000, sampleRate: 48000, channels: 2 },
    tracks: [],
    clips: [],
    markers: [],
    captions: [],
    transitions: [],
    cues: [],
    ...seq,
  };
}
