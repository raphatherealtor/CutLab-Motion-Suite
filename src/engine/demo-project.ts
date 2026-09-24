/**
 * CutLab Integrated Demo Project
 * A complete demo project for testing the unified Studio↔Motion editor.
 *
 * Contains:
 * - Placeholder video clip
 * - Transcript / caption data
 * - Motion clip (Lower Third template)
 * - Text animation (Kinetic Headline)
 * - Mask / depth example (Depth Title)
 * - Signal-bound example (Beat Sync)
 * - Template-generated Motion item (Logo Reveal)
 */

import type { ProjectData, Sequence, Track, Clip, Caption, SemanticCue, Marker, Asset } from './schema';
import { SCHEMA_VERSION, generateId } from './schema';
import { motionRegistry } from '@/motion/registry';
import { generateMotionId } from '@/motion/utils';
import { secondsToMotionTime } from '@/motion/types';
import type { MotionBehavior } from '@/motion/types';
import { motionTypesDocToEngineDoc } from './motion-bridge';
import type { MotionDocument as EngineMotionDocument } from './motion-document';


function secs(s: number) { return { value: Math.round(s * 30000), timescale: 30000 }; }
function frames(f: number, fps = 29.97) { return secs(f / fps); }

export function createDemoProject(): ProjectData {
  const now = Date.now();
  const projectId = generateId('proj');
  const seqId = generateId('seq');

  // ── Tracks ────────────────────────────────────────────────

  const tracks: Track[] = [
    { id: generateId('track'), kind: 'video', label: 'V1', muted: false, solo: false, locked: false, height: 56, gain: 0, order: 0, targeted: true },
    { id: generateId('track'), kind: 'video', label: 'V2', muted: false, solo: false, locked: false, height: 40, gain: 0, order: 1, targeted: false },
    { id: generateId('track'), kind: 'audio', label: 'A1', muted: false, solo: false, locked: false, height: 48, gain: 0, order: 2, targeted: true, audioRole: 'dialogue' },
    { id: generateId('track'), kind: 'audio', label: 'A2', muted: false, solo: false, locked: false, height: 40, gain: 0, order: 3, targeted: false, audioRole: 'music' },
    { id: generateId('track'), kind: 'graphic', label: 'G1', muted: false, solo: false, locked: false, height: 36, gain: 0, order: 4, targeted: false },
    { id: generateId('track'), kind: 'motion', label: 'MOT', muted: false, solo: false, locked: false, height: 36, gain: 0, order: 5, targeted: false },
    { id: generateId('track'), kind: 'caption', label: 'CAP', muted: false, solo: false, locked: false, height: 28, gain: 0, order: 6, targeted: false },
  ];

  const [v1, v2, a1, a2, g1, mot, cap] = tracks;

  // ── Assets ────────────────────────────────────────────────

  const videoAssetId = generateId('asset');
  const audioAssetId = generateId('asset');

  const videoAsset: Asset = {
    id: videoAssetId,
    name: 'Demo Interview.mp4',
    kind: 'video',
    caste: 'stub',
    sourceRef: 'demo://interview.mp4',
    durationFrames: Math.round(30 * 29.97),
    fps: 29.97,
    width: 1920,
    height: 1080,
    hasAudio: true,
    sampleRate: 48000,
    channels: 2,
    fileSize: 0,
    mimeType: 'video/mp4',
    transcriptWords: [
      { id: generateId('word'), text: 'Welcome', startTime: secs(0.5), endTime: secs(1.0), confidence: 0.98, speaker: 'speaker-0', wordIndex: 0 },
      { id: generateId('word'), text: 'to', startTime: secs(1.0), endTime: secs(1.2), confidence: 0.99, speaker: 'speaker-0', wordIndex: 1 },
      { id: generateId('word'), text: 'CutLab', startTime: secs(1.2), endTime: secs(1.8), confidence: 0.97, speaker: 'speaker-0', wordIndex: 2 },
      { id: generateId('word'), text: 'Studio', startTime: secs(1.8), endTime: secs(2.4), confidence: 0.98, speaker: 'speaker-0', wordIndex: 3 },
      { id: generateId('word'), text: 'the', startTime: secs(2.6), endTime: secs(2.8), confidence: 0.99, speaker: 'speaker-0', wordIndex: 4 },
      { id: generateId('word'), text: 'unified', startTime: secs(2.8), endTime: secs(3.3), confidence: 0.96, speaker: 'speaker-0', wordIndex: 5 },
      { id: generateId('word'), text: 'editor', startTime: secs(3.3), endTime: secs(3.8), confidence: 0.98, speaker: 'speaker-0', wordIndex: 6 },
      { id: generateId('word'), text: 'for', startTime: secs(3.8), endTime: secs(4.0), confidence: 0.99, speaker: 'speaker-0', wordIndex: 7 },
      { id: generateId('word'), text: 'motion', startTime: secs(4.0), endTime: secs(4.5), confidence: 0.97, speaker: 'speaker-0', wordIndex: 8 },
      { id: generateId('word'), text: 'and', startTime: secs(4.5), endTime: secs(4.7), confidence: 0.99, speaker: 'speaker-0', wordIndex: 9 },
      { id: generateId('word'), text: 'video', startTime: secs(4.7), endTime: secs(5.2), confidence: 0.98, speaker: 'speaker-0', wordIndex: 10 },
      { id: generateId('word'), text: 'Now', startTime: secs(6.0), endTime: secs(6.4), confidence: 0.98, speaker: 'speaker-0', wordIndex: 11 },
      { id: generateId('word'), text: 'with', startTime: secs(6.4), endTime: secs(6.7), confidence: 0.99, speaker: 'speaker-0', wordIndex: 12 },
      { id: generateId('word'), text: 'real', startTime: secs(6.7), endTime: secs(7.1), confidence: 0.97, speaker: 'speaker-0', wordIndex: 13 },
      { id: generateId('word'), text: 'Motion', startTime: secs(7.1), endTime: secs(7.6), confidence: 0.98, speaker: 'speaker-0', wordIndex: 14 },
      { id: generateId('word'), text: 'integration', startTime: secs(7.6), endTime: secs(8.4), confidence: 0.96, speaker: 'speaker-0', wordIndex: 15 },
    ],
    ingestedAt: now,
  };

  const audioAsset: Asset = {
    id: audioAssetId,
    name: 'Demo Music.mp3',
    kind: 'audio',
    caste: 'stub',
    sourceRef: 'demo://music.mp3',
    durationFrames: Math.round(30 * 29.97),
    fps: 29.97,
    hasAudio: true,
    sampleRate: 44100,
    channels: 2,
    fileSize: 0,
    mimeType: 'audio/mp3',
    ingestedAt: now,
  };

  // ── Motion Documents ──────────────────────────────────────

  // 1. Lower Third — Clean (at 1s)
  const lowerThirdDocId = generateMotionId('mdoc');
  const lowerThirdDoc = motionRegistry.generateFromTemplate('tpl-lower-third-clean', {
    id: lowerThirdDocId,
    name: 'Lower Third — Demo',
    durationSecs: 6,
    width: 1920,
    height: 1080,
    fps: 29.97,
    text: 'Alex Johnson',
    subText: 'Motion Director',
    primaryColor: '#3B82FF',
  })!;

  // 2. Kinetic Headline (at 8s)
  const kineticDocId = generateMotionId('mdoc');
  const kineticDoc = motionRegistry.generateFromTemplate('tpl-kinetic-headline', {
    id: kineticDocId,
    name: 'Kinetic Headline — Demo',
    durationSecs: 5,
    width: 1920,
    height: 1080,
    fps: 29.97,
    text: 'CutLab Studio',
    accentColor: '#8B5CF6',
  })!;

  // 3. Depth Title — 2.5D example (at 14s)
  const depthDocId = generateMotionId('mdoc');
  const depthDoc = motionRegistry.generateFromTemplate('tpl-depth-title', {
    id: depthDocId,
    name: 'Depth Title — Demo',
    durationSecs: 6,
    width: 1920,
    height: 1080,
    fps: 29.97,
    text: 'Motion + Depth',
    primaryColor: '#3B82FF',
  })!;

  // Add depth/parallax to the depth doc
  if (depthDoc && Object.keys(depthDoc.objects).length > 0) {
    const firstObjId = depthDoc.rootObjectIds[0];
    if (firstObjId && depthDoc.objects[firstObjId]) {
      depthDoc.objects[firstObjId] = {
        ...depthDoc.objects[firstObjId],
        depth: 2,
        transform: {
          ...depthDoc.objects[firstObjId].transform,
          position: { ...depthDoc.objects[firstObjId].transform.position, z: 200 },
        },
      };
    }
  }

  // 4. Beat Sync — signal-bound example (at 20s)
  const beatSyncDocId = generateMotionId('mdoc');
  const beatSyncDoc = motionRegistry.generateFromTemplate('tpl-beat-sync', {
    id: beatSyncDocId,
    name: 'Beat Sync — Demo',
    durationSecs: 8,
    width: 1920,
    height: 1080,
    fps: 29.97,
    text: 'Feel the Beat',
    accentColor: '#F43F5E',
  })!;

  // Add audio-beat signal to beat sync doc
  if (beatSyncDoc) {
    const beatSignalId = generateMotionId('sig');
    beatSyncDoc.signals[beatSignalId] = {
      id: beatSignalId,
      kind: 'audio-beat',
      name: 'Audio Beat',
      sampleData: Array.from({ length: 30 }, (_, i) => i % 4 === 0 ? 1 : 0),
    };

    // Add signal-reactive behavior to first object
    const firstObjId = beatSyncDoc.rootObjectIds[0];
    if (firstObjId && beatSyncDoc.objects[firstObjId]) {
      const pulseBehavior: MotionBehavior = {
        id: generateMotionId('beh'),
        type: 'signal-reactive',
        startTime: secondsToMotionTime(0),
        duration: secondsToMotionTime(8),
        params: { property: 'scale.x', min: 0.9, max: 1.15 },
        signalBinding: beatSignalId,
        easing: 'linear',
      };
      beatSyncDoc.objects[firstObjId] = {
        ...beatSyncDoc.objects[firstObjId],
        behaviors: [...beatSyncDoc.objects[firstObjId].behaviors, pulseBehavior],
      };
    }
  }

  // 5. Logo Reveal (at 28s)
  const logoDocId = generateMotionId('mdoc');
  const logoDoc = motionRegistry.generateFromTemplate('tpl-logo-reveal', {
    id: logoDocId,
    name: 'Logo Reveal — Demo',
    durationSecs: 4,
    width: 1920,
    height: 1080,
    fps: 29.97,
    text: 'CUTLAB',
    subText: 'Studio',
    primaryColor: '#34D399',
  })!;

  // ── Clips ─────────────────────────────────────────────────

  const defaultClipProps = {
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0 },
    keyframes: [],
    effects: [],
    masks: [],
    gain: 0,
    fadeIn: secs(0),
    fadeOut: secs(0),
    speed: 1,
    reverse: false,
    freeze: false,
    disabled: false,
  };

  const clips: Clip[] = [
    // Video clip (30s)
    {
      ...defaultClipProps,
      id: generateId('clip'),
      kind: 'video',
      trackId: v1.id,
      assetId: videoAssetId,
      name: 'Demo Interview.mp4',
      startTime: secs(0),
      duration: secs(30),
      sourceIn: secs(0),
      sourceOut: secs(30),
      fadeIn: secs(0.5),
      fadeOut: secs(0.5),
    },
    // Audio clip (30s)
    {
      ...defaultClipProps,
      id: generateId('clip'),
      kind: 'audio',
      trackId: a1.id,
      assetId: videoAssetId,
      name: 'Demo Interview (Audio)',
      startTime: secs(0),
      duration: secs(30),
      sourceIn: secs(0),
      sourceOut: secs(30),
      gain: 0,
    },
    // Music bed (30s)
    {
      ...defaultClipProps,
      id: generateId('clip'),
      kind: 'audio',
      trackId: a2.id,
      assetId: audioAssetId,
      name: 'Demo Music.mp3',
      startTime: secs(0),
      duration: secs(30),
      sourceIn: secs(0),
      sourceOut: secs(30),
      gain: -12,
    },
    // Motion clip 1: Lower Third (1s–7s)
    {
      ...defaultClipProps,
      id: generateId('clip'),
      kind: 'motion',
      trackId: mot.id,
      name: 'Lower Third — Demo',
      startTime: secs(1),
      duration: secs(6),
      sourceIn: secs(0),
      sourceOut: secs(6),
      motionDocumentId: lowerThirdDocId,
      motionBundleId: 'tpl-lower-third-clean',
      zOrder: 10,
    },
    // Motion clip 2: Kinetic Headline (8s–13s)
    {
      ...defaultClipProps,
      id: generateId('clip'),
      kind: 'motion',
      trackId: mot.id,
      name: 'Kinetic Headline — Demo',
      startTime: secs(8),
      duration: secs(5),
      sourceIn: secs(0),
      sourceOut: secs(5),
      motionDocumentId: kineticDocId,
      motionBundleId: 'tpl-kinetic-headline',
      zOrder: 10,
    },
    // Motion clip 3: Depth Title (14s–20s)
    {
      ...defaultClipProps,
      id: generateId('clip'),
      kind: 'motion',
      trackId: mot.id,
      name: 'Depth Title — Demo',
      startTime: secs(14),
      duration: secs(6),
      sourceIn: secs(0),
      sourceOut: secs(6),
      motionDocumentId: depthDocId,
      motionBundleId: 'tpl-depth-title',
      zOrder: 10,
    },
    // Motion clip 4: Beat Sync (20s–28s)
    {
      ...defaultClipProps,
      id: generateId('clip'),
      kind: 'motion',
      trackId: mot.id,
      name: 'Beat Sync — Demo',
      startTime: secs(20),
      duration: secs(8),
      sourceIn: secs(0),
      sourceOut: secs(8),
      motionDocumentId: beatSyncDocId,
      motionBundleId: 'tpl-beat-sync',
      zOrder: 10,
    },
    // Motion clip 5: Logo Reveal (28s–32s)
    {
      ...defaultClipProps,
      id: generateId('clip'),
      kind: 'motion',
      trackId: mot.id,
      name: 'Logo Reveal — Demo',
      startTime: secs(28),
      duration: secs(4),
      sourceIn: secs(0),
      sourceOut: secs(4),
      motionDocumentId: logoDocId,
      motionBundleId: 'tpl-logo-reveal',
      zOrder: 10,
    },
  ];

  // ── Captions ──────────────────────────────────────────────

  const captions: Caption[] = [
    {
      id: generateId('cap'),
      startTime: secs(0.5),
      endTime: secs(5.5),
      text: 'Welcome to CutLab Studio, the unified editor for motion and video.',
      speaker: 'speaker-0',
      trackId: cap.id,
      wordTimings: [
        { wordId: generateId('wt'), text: 'Welcome', startTime: secs(0.5), endTime: secs(1.0) },
        { wordId: generateId('wt'), text: 'to', startTime: secs(1.0), endTime: secs(1.2) },
        { wordId: generateId('wt'), text: 'CutLab', startTime: secs(1.2), endTime: secs(1.8), semanticMetadata: { emphasis: 1 } },
        { wordId: generateId('wt'), text: 'Studio', startTime: secs(1.8), endTime: secs(2.4), semanticMetadata: { emphasis: 1 } },
        { wordId: generateId('wt'), text: 'the', startTime: secs(2.6), endTime: secs(2.8) },
        { wordId: generateId('wt'), text: 'unified', startTime: secs(2.8), endTime: secs(3.3) },
        { wordId: generateId('wt'), text: 'editor', startTime: secs(3.3), endTime: secs(3.8) },
        { wordId: generateId('wt'), text: 'for', startTime: secs(3.8), endTime: secs(4.0) },
        { wordId: generateId('wt'), text: 'motion', startTime: secs(4.0), endTime: secs(4.5), semanticMetadata: { emphasis: 0.8 } },
        { wordId: generateId('wt'), text: 'and', startTime: secs(4.5), endTime: secs(4.7) },
        { wordId: generateId('wt'), text: 'video', startTime: secs(4.7), endTime: secs(5.2) },
      ],
    },
    {
      id: generateId('cap'),
      startTime: secs(6.0),
      endTime: secs(9.0),
      text: 'Now with real Motion integration.',
      speaker: 'speaker-0',
      trackId: cap.id,
      wordTimings: [
        { wordId: generateId('wt'), text: 'Now', startTime: secs(6.0), endTime: secs(6.4) },
        { wordId: generateId('wt'), text: 'with', startTime: secs(6.4), endTime: secs(6.7) },
        { wordId: generateId('wt'), text: 'real', startTime: secs(6.7), endTime: secs(7.1), semanticMetadata: { emphasis: 0.9 } },
        { wordId: generateId('wt'), text: 'Motion', startTime: secs(7.1), endTime: secs(7.6), semanticMetadata: { emphasis: 1 } },
        { wordId: generateId('wt'), text: 'integration', startTime: secs(7.6), endTime: secs(8.4) },
      ],
    },
  ];

  // ── Markers ───────────────────────────────────────────────

  const markers: Marker[] = [
    { id: generateId('marker'), time: secs(0), label: 'Start', color: '#3B82FF' },
    { id: generateId('marker'), time: secs(1), label: 'Lower Third In', color: '#8B5CF6' },
    { id: generateId('marker'), time: secs(8), label: 'Kinetic Headline', color: '#8B5CF6' },
    { id: generateId('marker'), time: secs(14), label: 'Depth Title', color: '#22D3EE' },
    { id: generateId('marker'), time: secs(20), label: 'Beat Sync', color: '#F43F5E' },
    { id: generateId('marker'), time: secs(28), label: 'Logo Reveal', color: '#34D399' },
  ];

  // ── Semantic Cues ─────────────────────────────────────────

  const cues: SemanticCue[] = [
    {
      id: generateId('cue'),
      type: 'emphasis',
      timeRange: { start: secs(1.2), end: secs(2.4) },
      label: 'CutLab Studio emphasis',
      data: { emphasis: 1 },
    },
    {
      id: generateId('cue'),
      type: 'emphasis',
      timeRange: { start: secs(7.1), end: secs(8.4) },
      label: 'Motion integration emphasis',
      data: { emphasis: 0.9 },
    },
    {
      id: generateId('cue'),
      type: 'chapter',
      timeRange: { start: secs(0), end: secs(8) },
      label: 'Introduction',
    },
    {
      id: generateId('cue'),
      type: 'chapter',
      timeRange: { start: secs(8), end: secs(20) },
      label: 'Motion Demo',
    },
    {
      id: generateId('cue'),
      type: 'chapter',
      timeRange: { start: secs(20), end: secs(32) },
      label: 'Signal & Logo',
    },
  ];

  // ── Sequence ──────────────────────────────────────────────

  const seq: Sequence = {
    id: seqId,
    name: 'Demo — Unified Editor',
    format: { width: 1920, height: 1080, fps: 29.97, fpsTimescale: 30000, sampleRate: 48000, channels: 2 },
    tracks,
    clips,
    markers,
    captions,
    transitions: [],
    cues,
  };

  // ── Motion Documents (persisted resources) ────────────────
  // Convert registry MotionDocuments (motion/types) to engine MotionDocuments
  // through the ONE shared converter (motion-bridge.motionTypesDocToEngineDoc) —
  // the same conversion MotionLibrary/DemoCompositions/SVG import use, so
  // signals (kind/sourceRef/range), keyframes, materials and cameras all survive.

  const convertRegistryToEngine = (regDoc: unknown): EngineMotionDocument =>
    motionTypesDocToEngineDoc(regDoc as Parameters<typeof motionTypesDocToEngineDoc>[0]);

  const motionDocuments: Record<string, EngineMotionDocument> = {};

  if (lowerThirdDoc) motionDocuments[lowerThirdDocId] = convertRegistryToEngine(lowerThirdDoc);
  if (kineticDoc) motionDocuments[kineticDocId] = convertRegistryToEngine(kineticDoc);
  if (depthDoc) motionDocuments[depthDocId] = convertRegistryToEngine(depthDoc);
  if (beatSyncDoc) motionDocuments[beatSyncDocId] = convertRegistryToEngine(beatSyncDoc);
  if (logoDoc) motionDocuments[logoDocId] = convertRegistryToEngine(logoDoc);

  // ── Project ───────────────────────────────────────────────

  return {
    schemaVersion: SCHEMA_VERSION,
    id: projectId,
    name: 'CutLab Demo — Unified Editor',
    createdAt: now,
    updatedAt: now,
    revision: 0,
    assets: {
      [videoAssetId]: videoAsset,
      [audioAssetId]: audioAsset,
    },
    sequences: { [seqId]: seq },
    activeSequenceId: seqId,
    precomps: {},
    versions: [],
    opHistory: [],
    exportPresets: {
      'preset-h264-1080p': {
        id: 'preset-h264-1080p',
        name: 'H.264 1080p',
        codec: 'h264',
        width: 1920,
        height: 1080,
        fps: 29.97,
        bitrate: 8000000,
        audioBitrate: 192000,
        audioCodec: 'aac',
        container: 'mp4',
      },
    },
    audioPresets: {
      'audio-dialogue': { id: 'audio-dialogue', name: 'Dialogue', targetLufs: -23, truePeak: -1, role: 'dialogue' },
    },
    settings: {
      autoSaveIntervalMs: 30000,
      defaultPadMs: 60,
      snapEnabled: true,
      rippleEnabled: false,
    },
    motionDocuments,
    migrations: ['demo-project-v1'],
  };
}
