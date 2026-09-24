/**
 * Chat Z integration acceptance — identity, signals, recipes, AI provenance.
 *
 * Drives the REAL engine seams (reducer + motion-bridge + persistence) with
 * store.tsx DISPATCH_BATCH / UNDO / REDO semantics mirrored exactly.
 * No React, no browser APIs.
 *
 * Run:  npx tsx scripts/chatz-integration-acceptance.ts
 */

import { createDefaultProject } from '../src/engine/schema';
import type { ProjectData } from '../src/engine/schema';
import {
  createMotionDocument,
  evaluateSignals,
} from '../src/engine/motion-document';
import {
  motionTypesDocToEngineDoc,
  motionTransactionToStudioOps,
  createMotionClipOps,
  resolveClipMotionDocument,
} from '../src/engine/motion-bridge';
import { applyOps } from '../src/engine/reducer';
import { makeOp } from '../src/engine/operations';
import type { OpEnvelope } from '../src/engine/operations';
import { fromSeconds } from '../src/engine/time';
import { serializeProject, deserializeProject } from '../src/engine/persistence';
import { recipeToMotionOps } from '../src/engine/motion-package';
import { createMotionTransaction } from '../src/engine/motion-document-utils';

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

// ── Harness ────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

let es: EngineState = { project: createDefaultProject('ChatZ Acceptance'), undoStack: [], redoStack: [] };

// ── Setup: a motion clip with a real document ──────────────────

const doc = createMotionDocument('Setup Doc', fromSeconds(5, 30000), 29.97, 1920, 1080);
const objId = 'obj-setup';
doc.objects[objId] = {
  id: objId,
  kind: 'text',
  name: 'Title',
  depth: 0,
  transform: { x: 0, y: 0, z: 0, scaleX: 1, scaleY: 1, scaleZ: 1, rotationX: 0, rotationY: 0, rotationZ: 0, anchorX: 0, anchorY: 0, anchorZ: 0, opacity: 1 },
  keyframes: [],
  behaviors: [],
  masks: [],
  blendMode: 'normal',
  visible: true,
  solo: false,
  locked: false,
  text: 'Hello',
};
doc.rootObjectIds = [objId];

const seq = es.project.sequences[es.project.activeSequenceId];
const motionTrack = seq.tracks.find((t) => t.kind === 'motion') ?? seq.tracks[0];
es = dispatchBatch(
  es,
  createMotionClipOps({ doc, sequenceId: seq.id, trackId: motionTrack.id, startTimeSecs: 0, fps: 29.97 }),
  'Setup motion clip'
);
const originalClip = es.project.sequences[seq.id].clips.find((c) => c.kind === 'motion')!;
check('1. setup: motion clip registered with document', Boolean(resolveClipMotionDocument(es.project, originalClip)));

// ── 1. clip.duplicate → independent document clone ─────────────

const dupDocCountBefore = Object.keys(es.project.motionDocuments ?? {}).length;
es = dispatchBatch(
  es,
  [makeOp('clip.duplicate', { sequenceId: seq.id, clipId: originalClip.id, newClipId: 'clip-dupe' })],
  'Duplicate motion clip'
);
const dupeClip = es.project.sequences[seq.id].clips.find((c) => c.id === 'clip-dupe')!;
const originalDocId = originalClip.motionDocumentId!;
const dupeDocId = dupeClip.motionDocumentId!;
check('1a. duplicate clip has a DIFFERENT document id', dupeDocId !== originalDocId);
check('1b. document count grew by exactly one', Object.keys(es.project.motionDocuments ?? {}).length === dupDocCountBefore + 1);

// Edit the clone — the original must be untouched
es = dispatchBatch(
  es,
  motionTransactionToStudioOps(
    createMotionTransaction('Edit clone', [
      { documentId: dupeDocId, type: 'motion.setObjectProp', payload: { objectId: objId, props: { text: 'EDITED CLONE' } } },
    ]),
    es.project
  ),
  'Edit duplicated doc'
);
const docAfterEdit = es.project.motionDocuments![dupeDocId];
const originalDoc = es.project.motionDocuments![originalDocId];
check('1c. editing the clone does not mutate the original document', docAfterEdit.objects[objId].text === 'EDITED CLONE' && originalDoc.objects[objId].text === 'Hello');

// Undo all the way back — duplicate + its doc must be gone
es = undo(es);
es = undo(es);
check('1d. undo removes the duplicated document (snapshot history)',
  Object.keys(es.project.motionDocuments ?? {}).length === dupDocCountBefore);

// ── 2. motion.document.register deep-clones the payload ────────

const aliasDoc = createMotionDocument('Alias Source', fromSeconds(1, 30000), 29.97, 1920, 1080);
aliasDoc.rootObjectIds = [];
es = dispatchBatch(es, [makeOp('motion.document.register', { document: aliasDoc })], 'Register alias');
aliasDoc.name = 'MUTATED AFTER REGISTER';
check('2. register stores a private clone (later caller mutation is isolated)',
  es.project.motionDocuments![aliasDoc.id].name === 'Alias Source');

// ── 3. Signal contract: kind/sourceRef/range survive + kind-driven eval ──

const legacyDoc: Parameters<typeof motionTypesDocToEngineDoc>[0] = {
  id: 'sig-doc',
  name: 'Signal Doc',
  duration: { value: 30000, timescale: 30000 },
  fps: 29.97,
  width: 1920,
  height: 1080,
  objects: {},
  rootObjectIds: [],
  signals: {
    'sig-beat': { id: 'sig-beat', kind: 'audio-beat', name: 'Beat', sourceRef: 'asset-1', range: { min: 0, max: 1 } },
    'sig-static': { id: 'sig-static', name: 'Static', defaultValue: 0.5 },
  },
  createdAt: Date.now(),
  updatedAt: Date.now(),
};
const sigEngineDoc = motionTypesDocToEngineDoc(legacyDoc);
const beat = sigEngineDoc.signals['sig-beat'];
check('3a. converter preserves kind', beat.kind === 'audio-beat');
check('3b. converter preserves sourceRef', beat.sourceRef === 'asset-1');
check('3c. converter preserves range', Boolean(beat.range && beat.range.min === 0 && beat.range.max === 1));
check('3d. converter does not fabricate a numeric defaultValue that would pin the channel',
  beat.defaultValue === undefined);

const sigs0 = evaluateSignals(sigEngineDoc, 0);
const sigsHalf = evaluateSignals(sigEngineDoc, 0.3);
check('3e. kind-driven signal evaluates live (not constant 0)', sigs0['sig-beat'] === 1 && sigsHalf['sig-beat'] === 0,
  `t=0 → ${sigs0['sig-beat']}, t=0.3 → ${sigsHalf['sig-beat']}`);
check('3f. defaultValue-only signal falls back to its static value', sigs0['sig-static'] === 0.5);

// SignalBindingPanel-style signal: kind + defaultValue: 0 → channel still wins
const bindingPanelDoc = createMotionDocument('Panel Doc', fromSeconds(1, 30000), 29.97, 1920, 1080);
bindingPanelDoc.signals['sig-panel'] = { id: 'sig-panel', name: 'Beat', type: 'number', kind: 'audio-beat', defaultValue: 0 };
const panelSigs = evaluateSignals(bindingPanelDoc, 0);
check('3g. panel signal (defaultValue 0 + kind) is channel-driven, not pinned at 0', panelSigs['sig-panel'] === 1,
  `t=0 → ${panelSigs['sig-panel']}`);

// ── 4. AI provenance survives the Studio boundary ──────────────

const aiOps = motionTransactionToStudioOps(
  {
    description: 'AI edit',
    ops: [{ documentId: doc.id, type: 'motion.setObjectProp', payload: { objectId: objId, props: { text: 'AI' } }, actor: 'ai' }],
  },
  es.project
);
check('4. AI transaction records actor "ai" in Studio history', aiOps.length === 1 && aiOps[0].actor === 'ai',
  `actor = ${aiOps[0]?.actor}`);
const humanOps = motionTransactionToStudioOps(
  {
    description: 'Human edit',
    ops: [{ documentId: doc.id, type: 'motion.setObjectProp', payload: { objectId: objId, props: { text: 'H' } } }],
  },
  es.project
);
check('4b. human transaction still records actor "user"', humanOps[0].actor === 'user');

// ── 5. Recipes: canonical ops + save/reopen round-trip ─────────

const recipe = {
  id: 'recipe-1',
  name: 'Pulse Title',
  description: 'Scale pulse on the title',
  ops: [{ opId: 'mop-r1', type: 'motion.addBehavior', documentId: 'whatever-original', payload: { objectId: objId, behavior: { id: 'beh-r1', type: 'pulse', startTime: { value: 0, timescale: 30000 }, duration: { value: 30000, timescale: 30000 }, params: { amplitude: 0.1 }, easing: 'ease-out' } } }] as never as import('../src/engine/motion-document').MotionOp[],
  params: [],
  compatibleTargets: ['any'],
  createdAt: Date.now(),
};
es = dispatchBatch(es, [makeOp('library.recipe.upsert', { recipe })], 'Capture recipe');
check('5a. recipe upsert lands in project state', (es.project.recipes ?? []).length === 1);
check('5b. recipe upsert is one undoable history entry', es.undoStack[es.undoStack.length - 1].description === 'Capture recipe');

const serialized = serializeProject(es.project);
const reopened = deserializeProject(serialized);
check('5c. recipes survive save/reopen', (reopened.recipes ?? []).length === 1 && reopened.recipes![0].name === 'Pulse Title');

const remapped = recipeToMotionOps(reopened.recipes![0], doc.id);
check('5d. recipe apply remaps documentId to the target', remapped.length === 1 && remapped[0].documentId === doc.id);
check('5e. recipe apply regenerates op ids (independent identity)', remapped[0].opId !== 'mop-r1');

es = dispatchBatch(
  es,
  motionTransactionToStudioOps(createMotionTransaction('Apply recipe', remapped), es.project),
  'Apply recipe'
);
const recipeTarget = resolveClipMotionDocument(es.project, originalClip)!;
check('5f. applied recipe modifies the TARGET document', recipeTarget.objects[objId].behaviors.length === 1);

es = dispatchBatch(es, [makeOp('library.recipe.remove', { recipeId: 'recipe-1' })], 'Delete recipe');
check('5g. recipe remove clears project state', (es.project.recipes ?? []).length === 0);

// ── Summary ────────────────────────────────────────────────────

console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES PRESENT'} — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
