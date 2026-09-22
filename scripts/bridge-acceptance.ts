/**
 * Focused Studio ↔ Motion Animator bridge acceptance test (agent-bridge).
 *
 * Drives the REAL engine seam — reducer + motion-bridge — with store.tsx
 * DISPATCH_BATCH / UNDO / REDO semantics mirrored exactly (one dispatchBatch
 * = one history entry). No React, no browser APIs.
 *
 * Run:  npx tsx scripts/bridge-acceptance.ts
 */

import { createDefaultProject } from '../src/engine/schema';
import type { ProjectData } from '../src/engine/schema';
import { createMotionDocument, DEFAULT_MOTION_TRANSFORM } from '../src/engine/motion-document';
import {
  createMotionClipOps,
  motionTransactionToStudioOps,
  resolveMotionDocument,
  resolveClipMotionDocument,
  evaluateMotionClip,
} from '../src/engine/motion-bridge';
import { applyOps } from '../src/engine/reducer';
import type { OpEnvelope } from '../src/engine/operations';
import { makeOp } from '../src/engine/motion-document-utils';
import { fromSeconds } from '../src/engine/time';

// ── Store semantics mirror (store.tsx DISPATCH_BATCH / UNDO / REDO) ──

interface HistoryEntry { state: ProjectData; description: string }
interface EngineState {
  project: ProjectData;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
}

function dispatchBatch(es: EngineState, envelopes: OpEnvelope[], description: string): EngineState {
  const result = applyOps(es.project, envelopes);
  if (!result.didMutate) return es;
  return {
    project: result.state,
    undoStack: [...es.undoStack, { state: es.project, description }],
    redoStack: [],
  };
}

function undo(es: EngineState): EngineState {
  if (es.undoStack.length === 0) return es;
  const prev = es.undoStack[es.undoStack.length - 1];
  return {
    project: prev.state,
    undoStack: es.undoStack.slice(0, -1),
    redoStack: [...es.redoStack, { state: es.project, description: prev.description }],
  };
}

function redo(es: EngineState): EngineState {
  if (es.redoStack.length === 0) return es;
  const next = es.redoStack[es.redoStack.length - 1];
  return {
    project: next.state,
    redoStack: es.redoStack.slice(0, -1),
    undoStack: [...es.undoStack, { state: es.project, description: next.description }],
  };
}

// ── Assertions ─────────────────────────────────────────────────

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

// ── Fixture: one Studio project with ONE Motion clip + ONE document ──

const project = createDefaultProject('Bridge Acceptance');
const seq = project.sequences[project.activeSequenceId];
const doc = createMotionDocument('Bridge Doc', fromSeconds(3, 30000), 30);

// One root object to edit (setup — committed through the canonical path too)
const objId = 'obj-title';
const setupTxOps = [
  makeOp('motion.object.add', doc.id, {
    object: {
      id: objId,
      kind: 'text',
      name: 'Title',
      depth: 0,
      transform: { ...DEFAULT_MOTION_TRANSFORM },
      keyframes: [],
      behaviors: [],
      masks: [],
      blendMode: 'normal',
      visible: true,
      solo: false,
      locked: false,
      text: 'Hello',
    },
  }),
];

let es: EngineState = { project, undoStack: [], redoStack: [] };

// Register the Motion clip in Studio (createMotionClipOps = register doc + add clip)
const clipOps = createMotionClipOps({
  doc,
  sequenceId: seq.id,
  trackId: seq.tracks[0].id,
  startTimeSecs: 0,
  fps: seq.format.fps,
});
es = dispatchBatch(es, clipOps, 'Insert Motion clip');

// Add the root object through the canonical seam (setup edit)
const setupStudioOps = motionTransactionToStudioOps({ ops: setupTxOps, description: 'Add title object' }, es.project);
es = dispatchBatch(es, setupStudioOps, 'Add title object');

const motionClip = es.project.sequences[seq.id].clips.find((c) => c.kind === 'motion');
check('1. select Motion clip in Studio', !!motionClip && !!motionClip.motionDocumentId);

// ── 2./3. Open in Motion Animator = workspace handoff resolution ──

const handoffDocId = motionClip!.motionDocumentId!;
const animatorDoc = resolveMotionDocument(es.project, handoffDocId);
check('2. open in Motion Animator resolves document', animatorDoc !== null);
check('3. same MotionDocument ID', animatorDoc?.id === doc.id && animatorDoc.id === motionClip!.motionDocumentId,
  `animator=${animatorDoc?.id} clip=${motionClip!.motionDocumentId} canonical=${doc.id}`);
check('3b. exactly ONE MotionDocument in project', Object.keys(es.project.motionDocuments ?? {}).length === 1);

// ── 4. Edit: transform + keyframe in ONE Motion transaction ──

const editOps = [
  makeOp('motion.setObjectTransform', doc.id, { objectId: objId, transform: { opacity: 0.5 } }),
  makeOp('motion.upsertKeyframe', doc.id, {
    keyframe: {
      id: 'kf-1',
      time: fromSeconds(1, 30000),
      property: 'transform.x',
      value: 200,
      easing: 'ease-out',
    },
    objectId: objId,
  }),
];
const historyBefore = es.undoStack.length;
const editStudioOps = motionTransactionToStudioOps({ ops: editOps, description: 'Edit title' }, es.project);
check('4. transaction converts to Studio ops', editStudioOps.length === 1 && editStudioOps[0].type === 'motion.document.patch',
  `got ${editStudioOps.map((o) => o.type).join(',')}`);
es = dispatchBatch(es, editStudioOps, 'Edit title');
check('4b. one edit creates ONE history entry', es.undoStack.length === historyBefore + 1,
  `undoStack ${historyBefore} → ${es.undoStack.length}`);

// ── 5. Return to Studio: same clip reflects the edit ──

const studioDoc = resolveClipMotionDocument(es.project, motionClip!);
check('5. return to Studio — same document ID', studioDoc?.id === doc.id);
check('5b. Studio sees transform edit', studioDoc?.objects[objId]?.transform.opacity === 0.5,
  `opacity=${studioDoc?.objects[objId]?.transform.opacity}`);
check('5c. Studio sees keyframe edit', (studioDoc?.objects[objId]?.keyframes.length ?? 0) === 1);
const frame = evaluateMotionClip(es.project, motionClip!, 1.0);
const frameObj = frame?.objects.find((o) => o.objectId === objId);
check('5d. rendered update — evaluated frame reflects edit', frame !== null && frameObj !== undefined && frameObj.opacity === 0.5,
  `frameObj.opacity=${frameObj?.opacity}`);
check('5e. still exactly ONE MotionDocument after edit', Object.keys(es.project.motionDocuments ?? {}).length === 1);

// ── 6. Studio undo ──

es = undo(es);
const undoneDoc = resolveClipMotionDocument(es.project, motionClip!);
check('6. undo restores pre-edit transform', undoneDoc?.objects[objId]?.transform.opacity === 1);
check('6b. undo restores pre-edit keyframes', (undoneDoc?.objects[objId]?.keyframes.length ?? -1) === 0);
check('6c. undo keeps same document ID', undoneDoc?.id === doc.id);
check('6d. no duplicate document after undo', Object.keys(es.project.motionDocuments ?? {}).length === 1);

// ── 7. Studio redo ──

es = redo(es);
const redoneDoc = resolveClipMotionDocument(es.project, motionClip!);
check('7. redo reapplies transform edit', redoneDoc?.objects[objId]?.transform.opacity === 0.5);
check('7b. redo reapplies keyframe edit', (redoneDoc?.objects[objId]?.keyframes.length ?? 0) === 1);
check('7c. redo keeps same document ID', redoneDoc?.id === doc.id);

// ── 8. Reopen Animator: same document, same state ──

const reopenedDoc = resolveMotionDocument(es.project, handoffDocId);
check('8. reopen Animator — same document ID', reopenedDoc?.id === doc.id);
check('8b. reopen Animator — same edited state',
  reopenedDoc?.objects[objId]?.transform.opacity === 0.5 && (reopenedDoc?.objects[objId]?.keyframes.length ?? 0) === 1);

// ── 9. Signal binding regression: binding twice must NOT duplicate the signal ──

function bindBeatSignal(state: EngineState): EngineState {
  const proj = state.project;
  const clip = proj.sequences[seq.id].clips.find((c) => c.kind === 'motion')!;
  const d = resolveClipMotionDocument(proj, clip)!;
  // Panel logic: match canonical signal by `kind` (channel id), create if absent
  const existing = Object.values(d.signals).find((s) => s.kind === 'audio-beat');
  const sigId = existing?.id ?? 'sig-beat-1';
  const ops = [];
  if (!existing) {
    ops.push(makeOp('motion.upsertSignal', d.id, {
      signal: { id: sigId, kind: 'audio-beat', name: 'Beat', type: 'number', defaultValue: 0 },
    }));
  }
  ops.push(makeOp('motion.addBehavior', d.id, {
    objectId: objId,
    behavior: {
      id: `beh-${Math.random().toString(36).slice(2, 8)}`,
      type: 'signal-reactive',
      startTime: fromSeconds(0, 30000),
      duration: fromSeconds(3, 30000),
      params: { property: 'scale.x', min: 1, max: 1.2 },
      signalBinding: sigId,
      easing: 'spring',
    },
  }));
  const studio = motionTransactionToStudioOps({ ops, description: 'Bind beat signal' }, proj);
  return dispatchBatch(state, studio, 'Bind beat signal');
}

const sigHistoryBefore = es.undoStack.length;
es = bindBeatSignal(es);
es = bindBeatSignal(es);
const sigDoc = resolveClipMotionDocument(es.project, motionClip!)!;
const beatSignals = Object.values(sigDoc.signals).filter((s) => s.kind === 'audio-beat');
check('9. two binds create exactly ONE signal (no .kind duplication)', beatSignals.length === 1,
  `found ${beatSignals.length}`);
check('9b. both behaviors bound to the same signal id',
  sigDoc.objects[objId].behaviors.filter((b) => b.signalBinding === beatSignals[0]?.id).length === 2);
check('9c. each bind = one history entry', es.undoStack.length === sigHistoryBefore + 2,
  `undoStack ${sigHistoryBefore} → ${es.undoStack.length}`);
check('9d. still exactly ONE MotionDocument', Object.keys(es.project.motionDocuments ?? {}).length === 1);

// ── Summary ────────────────────────────────────────────────────

console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES PRESENT'} — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
