/**
 * CutLab Motion Animator ↔ Studio Host Bridge — Canonical
 *
 * Uses engine/motion-document.ts as the canonical MotionDocument schema.
 * No private Motion project, no private undo stack, no separate persistence.
 * ALL persistent edits go through Studio dispatchBatch → one history entry.
 */

import type { EngineContextValue } from './store';
import type { WorkspaceHandoff, ReturnHandoff } from './workspace-context';
import { buildReturnHandoff } from './workspace-context';
import type { Clip, ProjectData } from './schema';
import type { RationalTime } from './time';
import { fromSeconds } from './time';
import type { MotionDocument, MotionOp, MotionTransaction } from './motion-document';

import { motionTransactionToStudioOps, motionLocalTimeToStudioSequenceTime, studioRationalToMotionRational,  } from './motion-bridge';



export interface MotionAnimatorHostBridge {
  readonly project: ProjectData;
  readonly handoff: WorkspaceHandoff;
  readonly document: MotionDocument | null;
  readonly clip: Clip | null;
  readonly undoDepth: number;
  readonly redoDepth: number;

  clipLocalTime(seconds: number): { value: number; timescale: number };
  studioSequenceTime(localTime: { value: number; timescale: number }): RationalTime;

  /**
   * Persistent write path.
   * One Motion transaction becomes one Studio history entry.
   */
  commit(ops: MotionOp[], description: string): boolean;

  undo(): void;
  redo(): void;

  buildReturn(selectedMotionObjectId?: string, hadEdits?: boolean): ReturnHandoff;
}

function resolveClip(engine: EngineContextValue, handoff: WorkspaceHandoff): Clip | null {
  return engine.activeSequence?.clips.find((clip) => clip.id === handoff.clipId) ?? null;
}

export function createMotionAnimatorHostBridge(
  engine: EngineContextValue,
  handoff: WorkspaceHandoff
): MotionAnimatorHostBridge {
  const getDocument = (): MotionDocument | null =>
    engine.project.motionDocuments?.[handoff.motionDocumentId] ?? null;
  const getClip = () => resolveClip(engine, handoff);

  return {
    project: engine.project,
    handoff,
    document: getDocument(),
    clip: getClip(),
    undoDepth: engine.undoDepth,
    redoDepth: engine.redoDepth,

    clipLocalTime(seconds) {
      const studioRt = fromSeconds(seconds, 120000);
      return studioRationalToMotionRational(studioRt);
    },

    studioSequenceTime(localTime) {
      const clip = getClip();
      const localSecs = localTime.value / localTime.timescale;
      if (!clip) {
        return fromSeconds(handoff.clipStartSecs + localSecs, 120000);
      }
      return fromSeconds(motionLocalTimeToStudioSequenceTime(localSecs, clip), 120000);
    },

    commit(ops, description) {
      if (!ops.length) return false;
      const transaction: MotionTransaction = { ops, description };
      const studioOps = motionTransactionToStudioOps(transaction, engine.project);
      if (!studioOps.length) return false;
      engine.dispatchBatch(studioOps, description);
      return true;
    },

    undo() { engine.undo(); },
    redo() { engine.redo(); },

    buildReturn(selectedMotionObjectId, hadEdits = false) {
      return buildReturnHandoff({
        motionDocumentId: handoff.motionDocumentId,
        clipId: handoff.clipId,
        selectedMotionObjectId,
        hadEdits,
      });
    },
  };
}
