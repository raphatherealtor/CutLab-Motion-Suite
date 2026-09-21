'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useEngine } from '@/engine/store';

import type { RightPanelTab } from './EditorClient';
import MotionLibrary from './MotionLibrary';
import ClipInspector from './ClipInspector';
import MediaBin from './MediaBin';
import SourceMonitor from './SourceMonitor';
import TranscriptWorkspace from './TranscriptWorkspace';
import CaptionsEditor from './CaptionsEditor';
import SemanticCueInspector from './SemanticCueInspector';
import TransitionsPanel from './TransitionsPanel';
import GraphicsLibrary from './GraphicsLibrary';


interface InspectorLibraryPanelProps {
  tab: RightPanelTab;
  onTabChange: (t: RightPanelTab) => void;
  selectedClipId: string | null;
  onOpenMotionAnimator?: (documentId: string, clipId: string) => void;
}

type LibrarySubTab = 'media' | 'source' | 'graphics' | 'motion' | 'effects';
type InspectorSubTab = 'clip' | 'audio' | 'keyframes' | 'masks' | 'words' | 'captions' | 'cues';

const LIB_TABS: { id: LibrarySubTab; label: string; tooltip: string }[] = [
  { id: 'media', label: 'Media', tooltip: 'Media Bin — imported assets' },
  { id: 'source', label: 'Source', tooltip: 'Source Monitor — preview & mark In/Out' },
  { id: 'graphics', label: 'Graphics', tooltip: 'Graphics — titles, lower thirds, shapes' },
  { id: 'motion', label: 'Motion', tooltip: 'Motion Library — template integration seam' },
  { id: 'effects', label: 'Effects', tooltip: 'Transitions & Precomps' },
];

const INSP_TABS: { id: InspectorSubTab; label: string; tooltip: string }[] = [
  { id: 'clip', label: 'Clip', tooltip: 'Clip properties — transform, speed, enable' },
  { id: 'audio', label: 'Audio', tooltip: 'Audio — gain, fade, pan, role' },
  { id: 'keyframes', label: 'Keys', tooltip: 'Keyframes — add, edit, easing' },
  { id: 'masks', label: 'Masks', tooltip: 'Masks — rect, ellipse, feather, invert' },
  { id: 'words', label: 'Words', tooltip: 'Transcript — click-seek, select, edit' },
  { id: 'captions', label: 'Captions', tooltip: 'Captions — edit, style, split, merge' },
  { id: 'cues', label: 'Cues', tooltip: 'Semantic Cues — emphasis, beat, chapter' },
];

export default function InspectorLibraryPanel({
  tab,
  onTabChange,
  selectedClipId,
  onOpenMotionAnimator,
}: InspectorLibraryPanelProps) {
  const engine = useEngine();
  const [libSubTab, setLibSubTab] = React.useState<LibrarySubTab>('media');
  const [inspSubTab, setInspSubTab] = React.useState<InspectorSubTab>('clip');

  // Track the previous selected clip to detect new selections
  const prevSelectedClipIdRef = React.useRef<string | null>(null);

  // Synchronously derive whether the selected clip is graphic/motion — no useEffect lag
  const selectedClip = selectedClipId && engine.activeSequence
    ? engine.activeSequence.clips.find((c) => c.id === selectedClipId) ?? null
    : null;
  const selectedClipIsGraphic = !!(selectedClip && (selectedClip.kind === 'graphic' || selectedClip.kind === 'motion'));

  // Auto-switch to Inspector only when a NEW clip is selected (not when user manually clicks Library)
  useEffect(() => {
    const prevId = prevSelectedClipIdRef.current;
    prevSelectedClipIdRef.current = selectedClipId;

    // Only auto-switch if a clip was just selected (went from null/different to a new id)
    if (selectedClipId && selectedClipId !== prevId) {
      onTabChange('inspector');
    }
  }, [selectedClipId]); // eslint-disable-line react-hooks/exhaustive-deps

  const subTabStyle = (active: boolean) => ({
    background: active ? 'rgba(59,130,255,0.14)' : 'transparent',
    border: 'none',
    borderRadius: '3px',
    padding: '3px 7px',
    fontSize: '10px',
    fontWeight: active ? 600 : 400,
    color: active ? 'var(--color-accent)' : 'var(--color-subtle)',
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
    transition: 'all 100ms ease',
  });

  return (
    <div
      style={{
        width: '320px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--color-surface)',
        borderLeft: '1px solid var(--color-border)',
        overflow: 'hidden',
      }}
    >
      {/* Main tab bar */}
      <div style={{
        padding: '5px 8px',
        borderBottom: '1px solid var(--color-border)',
        flexShrink: 0,
        display: 'flex',
        gap: '3px',
        alignItems: 'center',
      }}>
        <button
          className={`tab-pill${tab === 'library' ? ' active' : ''}`}
          onClick={() => onTabChange('library')}
          aria-pressed={tab === 'library'}
          title="Library — Media, Source, Graphics, Motion, Effects"
        >
          Library
        </button>
        <button
          className={`tab-pill${tab === 'inspector' ? ' active' : ''}`}
          onClick={() => onTabChange('inspector')}
          aria-pressed={tab === 'inspector'}
          title="Inspector — Clip, Audio, Keyframes, Masks, Words, Captions, Cues"
        >
          Inspector
        </button>
        {selectedClipId && tab !== 'inspector' && (
          <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--color-accent)', opacity: 0.7 }}>
            clip selected
          </span>
        )}
      </div>

      {/* Library sub-tabs */}
      {tab === 'library' && (
        <div style={{
          padding: '4px 6px',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
          display: 'flex',
          gap: '2px',
          overflowX: 'auto',
        }}>
          {LIB_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setLibSubTab(t.id)}
              style={subTabStyle(libSubTab === t.id)}
              aria-pressed={libSubTab === t.id}
              title={t.tooltip}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Inspector sub-tabs */}
      {tab === 'inspector' && (
        <div style={{
          padding: '4px 6px',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
          display: 'flex',
          gap: '2px',
          overflowX: 'auto',
        }}>
          {INSP_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setInspSubTab(t.id)}
              style={subTabStyle(inspSubTab === t.id)}
              aria-pressed={inspSubTab === t.id}
              title={t.tooltip}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* No clip selected hint for inspector */}
      {tab === 'inspector' && !selectedClipId && inspSubTab === 'clip' && (
        <div style={{
          padding: '24px 16px',
          textAlign: 'center',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ margin: '0 auto 8px', display: 'block', opacity: 0.25 }} aria-hidden="true">
            <rect x="3" y="7" width="18" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" />
            <path d="M7 7V5M17 7V5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginBottom: '3px' }}>No clip selected</div>
          <div style={{ fontSize: '11px', color: 'var(--color-subtle)' }}>Click a clip on the timeline to inspect it.</div>
        </div>
      )}

      {/* Panel body */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {tab === 'library' && libSubTab === 'media' && <MediaBin />}
        {tab === 'library' && libSubTab === 'source' && <SourceMonitor />}
        {tab === 'library' && libSubTab === 'graphics' && <GraphicsLibrary />}
        {tab === 'library' && libSubTab === 'motion' && (
          <MotionLibrary onOpenMotionAnimator={onOpenMotionAnimator} />
        )}
        {tab === 'library' && libSubTab === 'effects' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <div style={{ padding: '6px 10px 4px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
              <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-subtle)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Transitions</span>
            </div>
            <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
              <TransitionsPanel />
            </div>
          </div>
        )}

        {tab === 'inspector' && inspSubTab === 'clip' && <ClipInspector selectedClipId={selectedClipId} activeTab={selectedClipIsGraphic ? 'motion' : 'transform'} />}
        {tab === 'inspector' && inspSubTab === 'audio' && <ClipInspector selectedClipId={selectedClipId} activeTab="audio" />}
        {tab === 'inspector' && inspSubTab === 'keyframes' && <ClipInspector selectedClipId={selectedClipId} activeTab="keyframes" />}
        {tab === 'inspector' && inspSubTab === 'masks' && <ClipInspector selectedClipId={selectedClipId} activeTab="masks" />}
        {tab === 'inspector' && inspSubTab === 'words' && <TranscriptWorkspace />}
        {tab === 'inspector' && inspSubTab === 'captions' && <CaptionsEditor />}
        {tab === 'inspector' && inspSubTab === 'cues' && <SemanticCueInspector />}
      </div>
    </div>
  );
}