'use client';

/**
 * CutLab SVG Possibility Preview Panel
 *
 * Import SVG → parse structure → offer deterministic previewable possibilities.
 * Structure-aware suggestions based on actual SVG content.
 * Every accepted result remains editable in Motion Animator and Studio.
 */

import React, { useState, useCallback, useRef } from 'react';
import { useEngine } from '@/engine/store';
import {
  parseSVGStructure,
  generateSVGPossibilities,
  type SVGStructureAnalysis,
  type SVGPossibility,
  type SVGPossibilityKind,
} from '@/engine/svg-possibilities';
import { makeOp } from '@/engine/operations';
import { motionTypesDocToEngineDoc } from '@/engine/motion-bridge';
import { generateId } from '@/engine/schema';
import { fromSeconds } from '@/engine/time';

const POSSIBILITY_ICONS: Record<SVGPossibilityKind, string> = {
  'layered-parallax': '⊞',
  'group-stagger': '≡',
  'path-follow': '⟿',
  'mask-reveal': '◑',
  'depth-stack': '⊟',
  'camera-push': '⊙',
  'material-treatment': '◈',
  'audio-reactive': '♪',
  'speech-reactive': '◎',
  'procedural-repeat': '⊕',
  'text-choreography': 'T',
  'rig-hierarchy': '⊗',
};

export default function SVGPossibilityPanel() {
  const engine = useEngine();
  const { project, session } = engine;

  const [svgContent, setSvgContent] = useState('');
  const [analysis, setAnalysis] = useState<SVGStructureAnalysis | null>(null);
  const [possibilities, setPossibilities] = useState<SVGPossibility[]>([]);
  const [selectedPossibility, setSelectedPossibility] = useState<SVGPossibility | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [activeTab, setActiveTab] = useState<'import' | 'possibilities' | 'structure'>('import');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleParseSVG = useCallback((svg: string) => {
    if (!svg.trim()) return;
    setIsParsing(true);
    try {
      const parsed = parseSVGStructure(svg);
      setAnalysis(parsed);
      const poss = generateSVGPossibilities(svg, parsed);
      setPossibilities(poss);
      setActiveTab('possibilities');
    } finally {
      setIsParsing(false);
    }
  }, []);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      setSvgContent(content);
      handleParseSVG(content);
    };
    reader.readAsText(file);
  }, [handleParseSVG]);

  const handleAcceptPossibility = useCallback((possibility: SVGPossibility) => {
    const seq = project.sequences[project.activeSequenceId];
    if (!seq) return;

    const fps = seq.format.fps;
    const playheadSecs = session.playheadFrame / fps;

    // Store the canonical MotionDocument in project.
    // (SVG possibilities are authored in the legacy motion/types system —
    // migrate to the canonical engine MotionDocument at import time.)
    // EVERY placement gets a fresh document id: placing the same possibility
    // twice must produce two independent, individually editable documents,
    // never two clips aliased onto one shared entry.
    const engineDoc = motionTypesDocToEngineDoc(possibility.motionDocument as unknown as Parameters<typeof motionTypesDocToEngineDoc>[0]);
    engineDoc.id = generateId('mdoc');
    engineDoc.createdAt = Date.now();
    engineDoc.updatedAt = Date.now();
    const docId = engineDoc.id;

    // Create a motion clip on the timeline
    const clipId = generateId();
    const clipDuration = possibility.motionDocument.duration.value / possibility.motionDocument.duration.timescale;

    // ONE atomic batch: register + clip.add land as a single history entry
    engine.dispatchBatch([
      makeOp('motion.document.register', { document: engineDoc }, 'system'),
      makeOp('clip.add', {
        sequenceId: seq.id,
        clip: {
          id: clipId,
          name: `SVG: ${possibility.label}`,
          kind: 'motion',
          trackId: seq.tracks.find((t) => t.kind === 'video')?.id ?? seq.tracks[0]?.id ?? 'v1',
          startTime: fromSeconds(playheadSecs, fps),
          duration: fromSeconds(clipDuration, fps),
          sourceIn: fromSeconds(0, fps),
          sourceOut: fromSeconds(clipDuration, fps),
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
          motionDocumentId: docId,
          motionBundleId: docId,
        },
      }),
    ], `Place SVG: ${possibility.label}`);

    setSelectedPossibility(possibility);
  }, [project, session, engine]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--color-surface)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <span style={{ fontSize: '14px' }}>⬡</span>
        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-fg)', letterSpacing: '0.05em' }}>SVG POSSIBILITIES</span>
        {analysis && (
          <div style={{ marginLeft: 'auto', fontSize: '9px', color: 'var(--color-muted)', background: 'rgba(59,130,255,0.1)', padding: '2px 6px', borderRadius: '3px', border: '1px solid rgba(59,130,255,0.2)' }}>
            {analysis.elementCount} elements
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        {(['import', 'possibilities', 'structure'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1,
              padding: '6px 4px',
              background: activeTab === tab ? 'rgba(59,130,255,0.1)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid #3b82ff' : '2px solid transparent',
              color: activeTab === tab ? '#3b82ff' : 'var(--color-muted)',
              fontSize: '9px',
              cursor: 'pointer',
              fontWeight: activeTab === tab ? 600 : 400,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* IMPORT TAB */}
        {activeTab === 'import' && (
          <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ fontSize: '10px', color: 'var(--color-muted)', lineHeight: 1.5 }}>
              Import an SVG file to generate structure-aware Motion possibilities. Every accepted result remains editable.
            </div>

            {/* File upload */}
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: '2px dashed rgba(59,130,255,0.3)',
                borderRadius: '8px',
                padding: '24px',
                textAlign: 'center',
                cursor: 'pointer',
                background: 'rgba(59,130,255,0.04)',
                transition: 'all 0.2s',
              }}
            >
              <div style={{ fontSize: '24px', marginBottom: '8px', opacity: 0.5 }}>⬡</div>
              <div style={{ fontSize: '11px', color: 'var(--color-fg)', marginBottom: '4px' }}>Drop SVG or click to browse</div>
              <div style={{ fontSize: '10px', color: 'var(--color-muted)' }}>Structure-aware suggestions will be generated</div>
              <input ref={fileInputRef} type="file" accept=".svg,image/svg+xml" onChange={handleFileUpload} style={{ display: 'none' }} />
            </div>

            {/* Paste SVG */}
            <div>
              <div style={{ fontSize: '10px', color: 'var(--color-muted)', marginBottom: '6px' }}>Or paste SVG code:</div>
              <textarea
                value={svgContent}
                onChange={(e) => setSvgContent(e.target.value)}
                placeholder="<svg xmlns=...>...</svg>"
                style={{
                  width: '100%',
                  minHeight: '80px',
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '6px',
                  color: 'var(--color-fg)',
                  fontSize: '10px',
                  padding: '8px',
                  resize: 'vertical',
                  fontFamily: 'monospace',
                  boxSizing: 'border-box',
                }}
              />
              <button
                onClick={() => handleParseSVG(svgContent)}
                disabled={!svgContent.trim() || isParsing}
                style={{
                  width: '100%',
                  marginTop: '6px',
                  padding: '8px',
                  background: 'rgba(59,130,255,0.15)',
                  border: '1px solid rgba(59,130,255,0.3)',
                  borderRadius: '5px',
                  color: '#3b82ff',
                  fontSize: '11px',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                {isParsing ? 'Parsing...' : 'Parse & Generate Possibilities'}
              </button>
            </div>

            {/* Demo SVG */}
            <div>
              <div style={{ fontSize: '10px', color: 'var(--color-muted)', marginBottom: '6px' }}>Try a demo SVG:</div>
              <button
                onClick={() => {
                  const demoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080">
  <g id="background"><rect width="1920" height="1080" fill="#0a0a1a"/></g>
  <g id="layer-back"><circle cx="200" cy="540" r="80" fill="#1a1a3e"/><circle cx="400" cy="300" r="60" fill="#1a1a3e"/><circle cx="600" cy="700" r="70" fill="#1a1a3e"/></g>
  <g id="layer-mid"><rect x="700" y="400" width="200" height="200" rx="10" fill="#2a2a5e"/><rect x="1000" y="300" width="180" height="180" rx="10" fill="#2a2a5e"/><rect x="1300" y="450" width="160" height="160" rx="10" fill="#2a2a5e"/></g>
  <g id="layer-front"><text x="960" y="500" text-anchor="middle" font-size="72" fill="white" font-weight="bold">CUTLAB</text><text x="960" y="580" text-anchor="middle" font-size="32" fill="rgba(255,255,255,0.6)">MOTION STUDIO</text></g>
  <path id="main-path" d="M 100 540 C 400 200 800 800 1200 300 C 1400 100 1700 600 1900 400" stroke="#3b82ff" stroke-width="3" fill="none"/>
</svg>`;
                  setSvgContent(demoSvg);
                  handleParseSVG(demoSvg);
                }}
                style={{ width: '100%', padding: '7px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-border)', borderRadius: '5px', color: 'var(--color-muted)', fontSize: '10px', cursor: 'pointer' }}
              >
                Load Demo SVG (groups + path + text)
              </button>
            </div>
          </div>
        )}

        {/* POSSIBILITIES TAB */}
        {activeTab === 'possibilities' && (
          <div style={{ padding: '12px' }}>
            {possibilities.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px', fontSize: '11px', color: 'var(--color-muted)' }}>
                Import an SVG to see structure-aware possibilities
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '10px', color: 'var(--color-muted)', marginBottom: '4px' }}>
                  {possibilities.length} possibilities from SVG structure
                </div>
                {possibilities.map((poss) => (
                  <div
                    key={poss.id}
                    style={{
                      borderRadius: '8px',
                      overflow: 'hidden',
                      border: `1px solid ${selectedPossibility?.id === poss.id ? poss.accentColor + '60' : 'var(--color-border)'}`,
                      background: selectedPossibility?.id === poss.id ? `${poss.accentColor}10` : 'rgba(0,0,0,0.2)',
                    }}
                  >
                    {/* Preview gradient */}
                    <div style={{ height: '36px', background: poss.previewGradient, display: 'flex', alignItems: 'center', padding: '0 10px', gap: '8px' }}>
                      <span style={{ fontSize: '14px', color: poss.accentColor }}>{POSSIBILITY_ICONS[poss.kind]}</span>
                      <span style={{ fontSize: '11px', color: '#fff', fontWeight: 600 }}>{poss.label}</span>
                      <div style={{ marginLeft: 'auto', fontSize: '9px', color: 'rgba(255,255,255,0.5)', background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: '3px' }}>
                        {Math.round(poss.confidence * 100)}% match
                      </div>
                    </div>

                    <div style={{ padding: '8px 10px' }}>
                      <div style={{ fontSize: '10px', color: 'var(--color-fg)', marginBottom: '4px' }}>{poss.description}</div>
                      <div style={{ fontSize: '9px', color: 'var(--color-muted)', marginBottom: '6px', fontStyle: 'italic' }}>
                        Why: {poss.structuralReason}
                      </div>

                      {/* Requirements */}
                      <div style={{ display: 'flex', gap: '4px', marginBottom: '8px', flexWrap: 'wrap' }}>
                        {poss.requiresAudio && (
                          <span style={{ fontSize: '9px', padding: '1px 5px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '2px', color: '#f59e0b' }}>audio</span>
                        )}
                        {poss.requiresSpeech && (
                          <span style={{ fontSize: '9px', padding: '1px 5px', background: 'rgba(59,130,255,0.1)', border: '1px solid rgba(59,130,255,0.2)', borderRadius: '2px', color: '#3b82ff' }}>speech</span>
                        )}
                        {poss.requiresSubject && (
                          <span style={{ fontSize: '9px', padding: '1px 5px', background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: '2px', color: '#8b5cf6' }}>subject</span>
                        )}
                        <span style={{ fontSize: '9px', padding: '1px 5px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-border)', borderRadius: '2px', color: 'var(--color-muted)' }}>
                          {Object.keys(poss.motionDocument.objects).length} objects
                        </span>
                      </div>

                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          onClick={() => handleAcceptPossibility(poss)}
                          style={{ flex: 1, padding: '6px', background: `${poss.accentColor}20`, border: `1px solid ${poss.accentColor}40`, borderRadius: '4px', color: poss.accentColor, fontSize: '10px', cursor: 'pointer', fontWeight: 600 }}
                        >
                          PLACE ON TIMELINE
                        </button>
                        <button
                          onClick={() => setSelectedPossibility(poss)}
                          style={{ padding: '6px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'var(--color-muted)', fontSize: '10px', cursor: 'pointer' }}
                        >
                          INSPECT
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* STRUCTURE TAB */}
        {activeTab === 'structure' && (
          <div style={{ padding: '12px' }}>
            {analysis ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '10px', color: 'var(--color-muted)', marginBottom: '4px', letterSpacing: '0.05em' }}>SVG STRUCTURE ANALYSIS</div>

                {[
                  { label: 'Total Elements', value: analysis.elementCount },
                  { label: 'Groups', value: analysis.groupCount, note: analysis.groupCount >= 2 ? '→ depth plane candidates' : '' },
                  { label: 'Paths', value: analysis.pathCount, note: analysis.dominantPath ? '→ path follow candidate' : '' },
                  { label: 'Text Elements', value: analysis.textCount, note: analysis.textCount > 0 ? '→ choreography candidate' : '' },
                  { label: 'Closed Shapes', value: analysis.closedShapes.length, note: analysis.closedShapes.length > 0 ? '→ mask candidates' : '' },
                  { label: 'Repeated Shape Groups', value: analysis.repeatedShapeGroups.length, note: analysis.repeatedShapeGroups.length > 0 ? '→ stagger/procedural candidate' : '' },
                  { label: 'Nested Hierarchies', value: analysis.nestedHierarchies.length, note: analysis.nestedHierarchies.length > 0 ? '→ rig candidate' : '' },
                  { label: 'Canvas Size', value: `${analysis.width}×${analysis.height}` },
                ].map(({ label, value, note }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '6px 8px', background: 'rgba(0,0,0,0.2)', borderRadius: '4px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--color-fg)', flex: 1 }}>{label}</span>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '11px', color: '#3b82ff', fontWeight: 600 }}>{value}</div>
                      {note && <div style={{ fontSize: '9px', color: 'var(--color-muted)', fontStyle: 'italic' }}>{note}</div>}
                    </div>
                  </div>
                ))}

                {analysis.dominantPath && (
                  <div style={{ padding: '8px', background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.15)', borderRadius: '5px' }}>
                    <div style={{ fontSize: '10px', color: '#8b5cf6', marginBottom: '3px' }}>Dominant Path</div>
                    <div style={{ fontSize: '9px', color: 'var(--color-muted)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {analysis.dominantPath.pathData?.slice(0, 60)}...
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '30px', fontSize: '11px', color: 'var(--color-muted)' }}>
                Import an SVG to see structure analysis
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
