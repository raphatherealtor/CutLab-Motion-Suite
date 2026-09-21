'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { useEngine } from '@/engine/store';
import { makeOp } from '@/engine/operations';
import { generateId } from '@/engine/schema';
import { fromSeconds, toSeconds } from '@/engine/time';
import { createMotionDocument } from '@/engine/motion-document';
import type { MotionDocument as EngineMotionDocument } from '@/engine/motion-document';
import { MOTION_TEMPLATE_GENERATORS } from '@/motion/registry';
import type { MotionTemplateParams } from '@/motion/types';
import type { MotionDocument as RegistryMotionDocument } from '@/motion/types';

// ── Convert registry MotionDocument → engine MotionDocument ──

function convertRegistryDocToEngine(
  regDoc: RegistryMotionDocument
): EngineMotionDocument {
  let engineDoc = createMotionDocument(
    regDoc.name,
    { value: Math.round(toSeconds(regDoc.duration as any) * 30000), timescale: 30000 },
    regDoc.fps,
    regDoc.width,
    regDoc.height
  );
  engineDoc.id = regDoc.id;
  engineDoc.createdAt = regDoc.createdAt;
  engineDoc.updatedAt = regDoc.updatedAt;
  if (regDoc.templateId) {
    // Store template identity
    (engineDoc as any).templateId = regDoc.templateId;
  }

  // Convert objects
  for (const [objId, regObj] of Object.entries(regDoc.objects)) {
    const transform = regObj.transform;
    engineDoc.objects[objId] = {
      id: regObj.id,
      kind: mapKind(regObj.kind),
      name: regObj.name,
      parentId: regObj.parentId,
      depth: regObj.depth,
      transform: {
        x: transform.position?.x ?? 0,
        y: transform.position?.y ?? 0,
        z: transform.position?.z ?? 0,
        scaleX: transform.scale?.x ?? 1,
        scaleY: transform.scale?.y ?? 1,
        scaleZ: transform.scale?.z ?? 1,
        rotationX: transform.rotation?.x ?? 0,
        rotationY: transform.rotation?.y ?? 0,
        rotationZ: transform.rotation?.z ?? 0,
        anchorX: transform.anchor?.x ?? 0,
        anchorY: transform.anchor?.y ?? 0,
        anchorZ: transform.anchor?.z ?? 0,
        opacity: transform.opacity ?? 1,
      },
      keyframes: [],
      masks: [],
      blendMode: (regObj.blendMode as any) ?? 'normal',
      visible: regObj.visible,
      solo: false,
      locked: regObj.locked,
      text: regObj.textSegments?.[0]?.text ?? (regObj.kind === 'text' ? regObj.name : undefined),
      fontSize: regObj.textSegments?.[0]?.fontSize ?? 48,
      fontFamily: regObj.textSegments?.[0]?.fontFamily ?? 'sans-serif',
      fontWeight: regObj.textSegments?.[0]?.fontWeight ?? 700,
      assetRef: regObj.assetRef,
      svgData: regObj.svgData,
      childIds: regObj.children,
    };
  }
  engineDoc.rootObjectIds = regDoc.rootObjectIds;
  return engineDoc;
}

function mapKind(kind: string): EngineMotionDocument['objects'][string]['kind'] {
  const map: Record<string, EngineMotionDocument['objects'][string]['kind']> = {
    text: 'text',
    shape: 'shape',
    image: 'image',
    video: 'video',
    group: 'group',
    camera: 'camera',
    light: 'null-object',
    particle: 'shape',
    path: 'shape',
    mask: 'shape',
    null: 'null-object',
    svg: 'svg',
  };
  return map[kind] ?? 'shape';
}

// ── Families ──────────────────────────────────────────────────

const FAMILIES = [
  { id: 'all', label: 'All' },
  { id: 'core_motion', label: 'Core' },
  { id: 'data_viz', label: 'Data' },
  { id: 'explainer', label: 'Explainer' },
  { id: 'creative', label: 'Creative' },
  { id: 'screen_demo', label: 'Screen' },
  { id: 'business', label: 'Business' },
  { id: 'spatial', label: 'Spatial' },
];

interface MotionLibraryProps {
  onOpenMotionAnimator?: (documentId: string, clipId: string) => void;
}

export default function MotionLibrary({ onOpenMotionAnimator }: MotionLibraryProps) {
  const engine = useEngine();
  const { project, activeSequence, session } = engine;
  const [activeFamily, setActiveFamily] = useState('all');
  const [search, setSearch] = useState('');

  // Use the real 53-template registry
  const filtered = useMemo(() => {
    return MOTION_TEMPLATE_GENERATORS.filter((t) => {
      const matchFamily = activeFamily === 'all' || t.family === activeFamily;
      const matchSearch =
        !search.trim() ||
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.tags.some((tag) => tag.toLowerCase().includes(search.toLowerCase()));
      return matchFamily && matchSearch;
    });
  }, [activeFamily, search]);

  const handlePlaceTemplate = useCallback((tplId: string, tplName: string, tplDurSecs: number) => {
    if (!activeSequence) return;

    const fps = activeSequence.format.fps;
    const motionTrack = activeSequence.tracks.find((t) => t.kind === 'motion');
    if (!motionTrack) return;

    const docId = generateId('mdoc');
    const params: MotionTemplateParams = {
      id: docId,
      name: tplName,
      durationSecs: tplDurSecs,
      width: activeSequence.format.width,
      height: activeSequence.format.height,
      fps,
      text: tplName,
    };

    // Find the generator and generate the rich MotionDocument
    const generator = MOTION_TEMPLATE_GENERATORS.find((g) => g.id === tplId);
    let engineDoc: EngineMotionDocument;

    if (generator) {
      try {
        const regDoc = generator.generate(params);
        engineDoc = convertRegistryDocToEngine(regDoc);
      } catch {
        // Fallback: create a basic document
        engineDoc = createMotionDocument(
          tplName,
          fromSeconds(tplDurSecs, 30000),
          fps,
          activeSequence.format.width,
          activeSequence.format.height
        );
        engineDoc.id = docId;
        const textObjId = generateId('mobj');
        engineDoc.objects[textObjId] = {
          id: textObjId,
          kind: 'text',
          name: tplName,
          depth: 0,
          transform: { x: 0, y: 0, z: 0, scaleX: 1, scaleY: 1, scaleZ: 1, rotationX: 0, rotationY: 0, rotationZ: 0, anchorX: 0, anchorY: 0, anchorZ: 0, opacity: 1 },
          keyframes: [],
          masks: [],
          blendMode: 'normal',
          visible: true,
          solo: false,
          locked: false,
          text: tplName,
          fontSize: 48,
          fontFamily: 'sans-serif',
          fontWeight: 700,
        };
        engineDoc.rootObjectIds = [textObjId];
      }
    } else {
      engineDoc = createMotionDocument(
        tplName,
        fromSeconds(tplDurSecs, 30000),
        fps,
        activeSequence.format.width,
        activeSequence.format.height
      );
      engineDoc.id = docId;
    }

    // Place clip on timeline at playhead
    const startTime = fromSeconds(session.playheadFrame / fps, 30000);
    const clipId = generateId('clip');
    const duration = fromSeconds(tplDurSecs, 30000);

    const motionClip = {
      id: clipId,
      kind: 'motion' as const,
      trackId: motionTrack.id,
      assetId: undefined,
      name: tplName,
      startTime,
      duration,
      sourceIn: fromSeconds(0, 30000),
      sourceOut: duration,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0 },
      keyframes: [],
      effects: [],
      masks: [],
      gain: 0,
      fadeIn: fromSeconds(0, 30000),
      fadeOut: fromSeconds(0, 30000),
      speed: 1,
      reverse: false,
      freeze: false,
      disabled: false,
      // Both fields set for compatibility
      motionDocumentId: engineDoc.id,
      motionBundleId: engineDoc.id,
      zOrder: 10,
    };

    // Register MotionDocument + add clip in one atomic batch (one undo entry)
    engine.dispatchBatch([
      makeOp('motion.document.register' as any, { document: engineDoc }, 'user'),
      makeOp('clip.add', { sequenceId: activeSequence.id, clip: motionClip }, 'user'),
    ], `Place ${tplName}`);

    engine.updateSession({ selectedClipIds: new Set([clipId]) });
  }, [activeSequence, session.playheadFrame, engine]);

  // Get motion clips in the current sequence that have documents
  const motionClips = activeSequence?.clips.filter(
    (c) => c.kind === 'motion' && (c.motionDocumentId ?? c.motionBundleId) &&
      project.motionDocuments?.[(c.motionDocumentId ?? c.motionBundleId)!]
  ) ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Engine status banner */}
      <div style={{ padding: '8px 10px', background: 'rgba(139,92,246,0.07)', borderBottom: '1px solid rgba(139,92,246,0.2)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '7px' }}>
        <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#34D399', flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#34D399' }}>Motion engine connected — {MOTION_TEMPLATE_GENERATORS.length} templates</div>
          <div style={{ fontSize: '10px', color: 'var(--color-subtle)', marginTop: '1px' }}>Place templates → canonical MotionDocument → Studio timeline</div>
        </div>
      </div>

      {/* Active motion clips */}
      {motionClips.length > 0 && (
        <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
          <div style={{ fontSize: '9px', fontWeight: 600, color: 'var(--color-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>On Timeline</div>
          {motionClips.map((clip) => {
            const docId = clip.motionDocumentId ?? clip.motionBundleId!;
            return (
              <div key={clip.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 6px', background: 'var(--color-elevated)', border: '1px solid var(--color-border)', borderRadius: '4px', marginBottom: '3px' }}>
                <span style={{ fontSize: '10px', color: 'var(--color-accent-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clip.name}</span>
                <button
                  onClick={() => onOpenMotionAnimator?.(docId, clip.id)}
                  style={{ fontSize: '9px', background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '3px', color: 'var(--color-accent-2)', padding: '2px 6px', cursor: 'pointer', flexShrink: 0 }}
                  aria-label={`Open ${clip.name} in Motion Animator`}
                >
                  Open ↗
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Search */}
      <div style={{ padding: '8px 10px 6px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '5px 8px' }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <circle cx="5" cy="5" r="3.5" stroke="var(--color-subtle)" strokeWidth="1.2" />
            <path d="M8 8l2.5 2.5" stroke="var(--color-subtle)" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${MOTION_TEMPLATE_GENERATORS.length} templates…`}
            style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--color-fg)', fontFamily: 'var(--font-sans)', fontSize: '12px', width: '100%' }}
            aria-label="Search motion templates" />
        </div>
      </div>

      {/* Family filters */}
      <div style={{ padding: '0 10px 8px', flexShrink: 0, display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
        {FAMILIES.map((fam) => (
          <button key={`fam-${fam.id}`} onClick={() => setActiveFamily(fam.id)}
            style={{ fontSize: '11px', fontWeight: 500, padding: '3px 8px', borderRadius: '10px', border: `1px solid ${activeFamily === fam.id ? 'rgba(139,92,246,0.5)' : 'var(--color-border)'}`, background: activeFamily === fam.id ? 'rgba(139,92,246,0.15)' : 'transparent', color: activeFamily === fam.id ? 'var(--color-accent-2)' : 'var(--color-muted)', cursor: 'pointer' }}
            aria-pressed={activeFamily === fam.id}>
            {fam.label}
          </button>
        ))}
      </div>

      {/* Template grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px 12px' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginBottom: '4px' }}>No templates match</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {filtered.map((tpl) => (
              <MotionTemplateCard
                key={tpl.id}
                id={tpl.id}
                name={tpl.name}
                gradient={tpl.previewGradient ?? 'linear-gradient(135deg, #0d1b3e, #1a2f5e)'}
                accentColor={tpl.accentColor ?? '#3B82FF'}
                tags={tpl.tags}
                durationSecs={tpl.defaultDurationSecs}
                onPlace={() => handlePlaceTemplate(tpl.id, tpl.name, tpl.defaultDurationSecs)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface MotionTemplateCardProps {
  id: string;
  name: string;
  gradient: string;
  accentColor: string;
  tags: string[];
  durationSecs: number;
  onPlace: () => void;
}

function MotionTemplateCard({ name, gradient, accentColor, tags, durationSecs, onPlace }: MotionTemplateCardProps) {
  const [hovered, setHovered] = useState(false);
  const mins = Math.floor(durationSecs / 60);
  const secs = durationSecs % 60;
  const durStr = `${mins}:${String(secs).padStart(2, '0')}`;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="article"
      aria-label={`${name} motion template`}
      style={{ border: `1px solid ${hovered ? accentColor + '60' : 'var(--color-border)'}`, borderRadius: '6px', overflow: 'hidden', cursor: 'pointer', transition: 'border-color 0.15s' }}
    >
      <div style={{ height: '60px', background: gradient, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }} aria-hidden="true">
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(244,247,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(244,247,255,0.04) 1px, transparent 1px)', backgroundSize: '12px 12px' }} />
        <svg width="24" height="16" viewBox="0 0 24 16" fill="none" style={{ position: 'relative', zIndex: 1 }}>
          <path d="M2 12 C5 8, 8 4, 12 7 S18 3 22 5" stroke={accentColor} strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.9" />
        </svg>
        {hovered && (
          <button
            onClick={onPlace}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
            aria-label={`Place ${name}`}
          >
            <span>+ Place</span>
          </button>
        )}
      </div>
      <div style={{ padding: '6px 8px' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-fg)', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '9px', color: 'var(--color-subtle)' }}>{tags.slice(0, 2).join(' · ')}</div>
          <div style={{ fontSize: '9px', color: 'var(--color-muted)' }}>{durStr}</div>
        </div>
      </div>
    </div>
  );
}