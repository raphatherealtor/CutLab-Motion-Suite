'use client';

/**
 * SceneScriptPanel — Semantic view of the Studio timeline.
 * NOT another timeline. Derives from canonical Studio sequence.
 * Shows sections, beats, ideas, speaker segments, emphasis moments.
 * Connects to Motion choreography via context.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { useEngine } from '@/engine/store';
import { deriveSceneScript, getActiveSceneRegion, getChoreographyDirective, type SceneRegion, type SceneRegionKind, type EnergyLevel } from '@/engine/scene-script';
import { toSeconds } from '@/engine/time';


const REGION_KIND_COLORS: Record<SceneRegionKind, string> = {
  section: '#3B82F6',
  beat: '#F59E0B',
  idea: '#8B5CF6',
  'speaker-segment': '#10B981',
  'emphasis-moment': '#EF4444',
  'visual-focus': '#06B6D4',
  'energy-change': '#F97316',
  'settle-moment': '#6B7280',
  'transition-moment': '#A78BFA',
  intro: '#34D399',
  outro: '#9CA3AF',
  climax: '#EC4899',
};

const REGION_KIND_ICONS: Record<SceneRegionKind, string> = {
  section: '§',
  beat: '♩',
  idea: '💡',
  'speaker-segment': '🎙',
  'emphasis-moment': '⬆',
  'visual-focus': '👁',
  'energy-change': '⚡',
  'settle-moment': '⏸',
  'transition-moment': '→',
  intro: '▶',
  outro: '⏹',
  climax: '🔥',
};

const ENERGY_COLORS: Record<EnergyLevel, string> = {
  low: '#6B7280',
  medium: '#3B82F6',
  high: '#F59E0B',
  peak: '#EF4444',
};

export default function SceneScriptPanel() {
  const engine = useEngine();
  const { project, activeSequence, session, dispatch } = engine;
  const fps = activeSequence?.format.fps ?? 29.97;
  const currentTimeSecs = session.playheadFrame / fps;

  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [editingRegionId, setEditingRegionId] = useState<string | null>(null);
  const [showChoreography, setShowChoreography] = useState(false);

  // Derive scene script from active sequence
  const words = useMemo(() => {
    if (!activeSequence) return [];
    const allWords: import('@/engine/schema').TranscriptWord[] = [];
    for (const clip of activeSequence.clips) {
      const asset = clip.assetId ? project?.assets[clip.assetId] : null;
      if (asset?.transcriptWords) allWords.push(...asset.transcriptWords);
    }
    return allWords;
  }, [activeSequence, project]);

  const sceneScript = useMemo(() => {
    if (!activeSequence) return null;
    return deriveSceneScript(activeSequence, words);
  }, [activeSequence, words]);

  const activeRegion = useMemo(() => {
    if (!sceneScript) return null;
    return getActiveSceneRegion(sceneScript, currentTimeSecs);
  }, [sceneScript, currentTimeSecs]);

  const selectedRegion = sceneScript?.regions.find((r) => r.id === selectedRegionId) ?? null;

  const choreographyDirective = useMemo(() => {
    if (!activeRegion) return null;
    return getChoreographyDirective({
      activeRegion,
      energyLevel: activeRegion.energyLevel,
      cameraEnergy: activeRegion.cameraEnergy,
      compositionDensity: activeRegion.compositionDensity,
      energyValue: activeRegion.densityValue,
      cameraEnergyValue: activeRegion.cameraEnergyValue,
      densityValue: activeRegion.densityValue,
      motionHints: activeRegion.motionHints,
      activeSpeaker: activeRegion.activeSpeaker,
      isIntro: activeRegion.kind === 'intro',
      isOutro: activeRegion.kind === 'outro',
      isEmphasis: activeRegion.kind === 'emphasis-moment',
      isSettle: activeRegion.kind === 'settle-moment',
      isTransition: activeRegion.kind === 'transition-moment',
    });
  }, [activeRegion]);

  const seekToRegion = useCallback((region: SceneRegion) => {
    const frame = Math.round(toSeconds(region.start) * fps);
    // Session-only playhead move — never a persistent op, never an undo step
    engine.updateSession({ playheadFrame: frame });
  }, [engine, fps]);

  if (!sceneScript || !activeSequence) {
    return (
      <div style={{ padding: '16px', textAlign: 'center', fontSize: '11px', color: 'var(--color-muted)' }}>
        No sequence loaded
      </div>
    );
  }

  const sectionStyle: React.CSSProperties = {
    padding: '6px 10px',
    borderBottom: '1px solid var(--color-border)',
    fontSize: '9px',
    fontWeight: 600,
    color: 'var(--color-subtle)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    background: 'var(--color-surface)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '12px' }}>🎬</span>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-fg)' }}>Scene Script</span>
          <span style={{ fontSize: '9px', color: 'var(--color-subtle)', marginLeft: 'auto' }}>
            {sceneScript.regions.length} regions · semantic view
          </span>
        </div>
        <div style={{ fontSize: '9px', color: 'var(--color-subtle)', marginTop: '2px' }}>
          Derived from canonical sequence · not a separate timeline
        </div>
      </div>

      {/* Active region context */}
      {activeRegion && (
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--color-border)', background: 'rgba(59,130,246,0.06)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
            <span style={{ fontSize: '12px' }}>{REGION_KIND_ICONS[activeRegion.kind]}</span>
            <span style={{ fontSize: '10px', fontWeight: 600, color: REGION_KIND_COLORS[activeRegion.kind] }}>
              {activeRegion.label}
            </span>
            <span style={{ fontSize: '9px', padding: '1px 5px', borderRadius: '3px', background: ENERGY_COLORS[activeRegion.energyLevel] + '22', color: ENERGY_COLORS[activeRegion.energyLevel] }}>
              {activeRegion.energyLevel}
            </span>
            <button
              onClick={() => setShowChoreography(!showChoreography)}
              style={{ marginLeft: 'auto', fontSize: '9px', padding: '2px 6px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px', color: 'var(--color-subtle)', cursor: 'pointer' }}
            >
              {showChoreography ? 'Hide' : 'Motion'}
            </button>
          </div>

          {showChoreography && choreographyDirective && (
            <div style={{ fontSize: '9px', color: 'var(--color-subtle)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px' }}>
              <div>Camera: <span style={{ color: 'var(--color-fg)' }}>{choreographyDirective.cameraDirective}</span></div>
              <div>Text: <span style={{ color: 'var(--color-fg)' }}>{choreographyDirective.textDirective}</span></div>
              <div>Signal gain: <span style={{ color: 'var(--color-fg)' }}>{choreographyDirective.signalGain.toFixed(1)}×</span></div>
              <div>Depth: <span style={{ color: 'var(--color-fg)' }}>{choreographyDirective.depthMultiplier.toFixed(1)}×</span></div>
            </div>
          )}
        </div>
      )}

      {/* Region list */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div style={sectionStyle}>Regions ({sceneScript.regions.length})</div>

        {sceneScript.regions.map((region) => {
          const isActive = region.id === activeRegion?.id;
          const isSelected = region.id === selectedRegionId;
          const startSecs = toSeconds(region.start);
          const endSecs = toSeconds(region.end);
          const duration = endSecs - startSecs;
          const color = REGION_KIND_COLORS[region.kind];

          return (
            <div
              key={region.id}
              onClick={() => setSelectedRegionId(isSelected ? null : region.id)}
              style={{
                padding: '6px 10px',
                borderBottom: '1px solid var(--color-border)',
                background: isActive ? `${color}11` : isSelected ? 'var(--color-well)' : 'transparent',
                cursor: 'pointer',
                borderLeft: `3px solid ${isActive ? color : 'transparent'}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', flexShrink: 0 }}>{REGION_KIND_ICONS[region.kind]}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '10px', fontWeight: 600, color: isActive ? color : 'var(--color-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {region.label}
                  </div>
                  <div style={{ fontSize: '9px', color: 'var(--color-subtle)' }}>
                    {startSecs.toFixed(1)}s – {endSecs.toFixed(1)}s · {duration.toFixed(1)}s
                    {region.activeSpeaker && <span style={{ marginLeft: '4px', color: '#10B981' }}>· {region.activeSpeaker}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
                  <span style={{ fontSize: '8px', padding: '1px 4px', borderRadius: '2px', background: ENERGY_COLORS[region.energyLevel] + '22', color: ENERGY_COLORS[region.energyLevel] }}>
                    {region.energyLevel}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); seekToRegion(region); }}
                    style={{ fontSize: '9px', padding: '1px 5px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '2px', color: 'var(--color-subtle)', cursor: 'pointer' }}
                    title="Seek to region"
                  >▶</button>
                </div>
              </div>

              {/* Expanded detail */}
              {isSelected && (
                <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid var(--color-border)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '9px', color: 'var(--color-subtle)' }}>
                    <div>Kind: <span style={{ color: color }}>{region.kind}</span></div>
                    <div>Camera: <span style={{ color: 'var(--color-fg)' }}>{region.cameraEnergy}</span></div>
                    <div>Density: <span style={{ color: 'var(--color-fg)' }}>{region.compositionDensity}</span></div>
                    <div>Source: <span style={{ color: 'var(--color-fg)' }}>{region.source}</span></div>
                  </div>

                  {/* Energy bars */}
                  <div style={{ marginTop: '6px' }}>
                    <div style={{ fontSize: '9px', color: 'var(--color-subtle)', marginBottom: '3px' }}>Energy</div>
                    <div style={{ height: '4px', background: 'var(--color-border)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${region.densityValue * 100}%`, background: ENERGY_COLORS[region.energyLevel], borderRadius: '2px' }} />
                    </div>
                  </div>
                  <div style={{ marginTop: '4px' }}>
                    <div style={{ fontSize: '9px', color: 'var(--color-subtle)', marginBottom: '3px' }}>Camera Energy</div>
                    <div style={{ height: '4px', background: 'var(--color-border)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${region.cameraEnergyValue * 100}%`, background: '#EC4899', borderRadius: '2px' }} />
                    </div>
                  </div>

                  {region.motionHints && Object.keys(region.motionHints).length > 0 && (
                    <div style={{ marginTop: '6px', fontSize: '9px', color: 'var(--color-subtle)' }}>
                      Hints: {Object.entries(region.motionHints).filter(([, v]) => v).map(([k]) => k).join(', ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {sceneScript.regions.length === 0 && (
          <div style={{ padding: '16px', textAlign: 'center', fontSize: '11px', color: 'var(--color-muted)' }}>
            No regions derived yet. Add semantic cues or markers to the timeline.
          </div>
        )}
      </div>

      {/* Footer info */}
      <div style={{ padding: '6px 10px', borderTop: '1px solid var(--color-border)', flexShrink: 0, fontSize: '9px', color: 'var(--color-subtle)' }}>
        Scene Script is a semantic view — not a separate timeline or project state.
        Regions derive from cues, markers, and transcript.
      </div>
    </div>
  );
}
