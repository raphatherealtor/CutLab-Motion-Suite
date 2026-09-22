'use client';

import React, { useCallback, useState } from 'react';
import { useEngine } from '@/engine/store';
import { makeOp } from '@/engine/operations';
import type { ProjectState } from './EditorClient';
import AppImage from '@/components/ui/AppImage';
import Link from 'next/link';
import dynamic from 'next/dynamic';

const ProjectManager = dynamic(() => import('./ProjectManager'), { ssr: false });
const ExportDialog = dynamic(() => import('./ExportDialog'), { ssr: false });

interface EditorTopBarProps {
  project: ProjectState;
  tool: import('./EditorClient').ToolMode;
  onToolChange: (t: import('./EditorClient').ToolMode) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
}

export default function EditorTopBar({
  project,
  tool,
  onToolChange,
  onUndo,
  onRedo,
  onSave,
}: EditorTopBarProps) {
  const engine = useEngine();
  const [seqOpen, setSeqOpen] = useState(false);
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [showExport, setShowExport] = useState(false);

  const sequences = Object.values(engine.project.sequences);
  const activeSeqId = engine.project.activeSequenceId;

  function handleNewSequence() {
    const { generateId, DEFAULT_FORMAT } = require('@/engine/schema');
    const seqId = generateId('seq');
    const tracks = [
      { id: generateId('track'), kind: 'video' as const, label: 'V1', muted: false, solo: false, locked: false, height: 56, gain: 0, order: 0, targeted: true },
      { id: generateId('track'), kind: 'audio' as const, label: 'A1', muted: false, solo: false, locked: false, height: 48, gain: 0, order: 1, targeted: true },
      { id: generateId('track'), kind: 'graphic' as const, label: 'G1', muted: false, solo: false, locked: false, height: 36, gain: 0, order: 2, targeted: false },
      { id: generateId('track'), kind: 'caption' as const, label: 'CAP', muted: false, solo: false, locked: false, height: 28, gain: 0, order: 3, targeted: false },
    ];
    const seq = { id: seqId, name: 'New Sequence', format: DEFAULT_FORMAT, tracks, clips: [], markers: [], captions: [], transitions: [], cues: [] };
    engine.dispatch(makeOp('sequence.create', { sequence: seq }, 'user'), 'New sequence');
    setSeqOpen(false);
  }

  return (
    <>
      <header
        style={{
          height: '44px',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '0 8px',
          backgroundColor: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border)',
          boxShadow: 'inset 0 1px 0 rgba(244,247,255,0.06)',
          zIndex: 30,
          position: 'relative',
        }}
      >
        {/* App icon — use existing logo */}
        <Link href="/" style={{ display: 'flex', alignItems: 'center', flexShrink: 0, marginRight: '4px' }} title="Back to home" aria-label="CutLab Studio home">
          <AppImage
            src="/assets/images/app_logo.png"
            alt="CutLab Studio"
            width={28}
            height={28}
            className="rounded"
          />
        </Link>

        <div style={{ width: '1px', height: '20px', background: 'var(--color-border)', margin: '0 4px' }} aria-hidden="true" />

        {/* Project name + dirty indicator — click to open project manager */}
        <button
          onClick={() => setShowProjectManager(true)}
          style={{ display: 'flex', alignItems: 'center', gap: '5px', maxWidth: '220px', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: '4px' }}
          title="Project settings"
          aria-label="Open project manager"
        >
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {project.name}
          </span>
          {project.dirty && (
            <span style={{ fontSize: '11px', color: 'var(--color-accent)', lineHeight: 1, flexShrink: 0 }} title="Unsaved changes" aria-label="Unsaved changes">●</span>
          )}
        </button>

        {/* Sequence switcher */}
        <div style={{ position: 'relative', marginLeft: '4px' }}>
          <button
            className="btn-ghost"
            style={{ fontSize: '12px', padding: '4px 10px', gap: '4px', display: 'flex', alignItems: 'center' }}
            onClick={() => setSeqOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={seqOpen}
          >
            <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {sequences.find((s) => s.id === activeSeqId)?.name ?? 'Sequence'}
            </span>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {seqOpen && (
            <div role="listbox" style={{ position: 'absolute', top: '100%', left: 0, marginTop: '4px', background: 'var(--color-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 200, minWidth: '180px', overflow: 'hidden' }}>
              {sequences.map((seq) => (
                <button
                  key={seq.id}
                  role="option"
                  aria-selected={activeSeqId === seq.id}
                  onClick={() => setSeqOpen(false)}
                  style={{ display: 'block', width: '100%', padding: '7px 12px', textAlign: 'left', background: activeSeqId === seq.id ? 'rgba(59,130,255,0.12)' : 'transparent', color: activeSeqId === seq.id ? 'var(--color-accent)' : 'var(--color-fg)', fontSize: '12px', fontWeight: activeSeqId === seq.id ? 600 : 400, cursor: 'pointer', border: 'none', transition: 'background 100ms', fontFamily: 'var(--font-sans)' }}
                >
                  {seq.name}
                </button>
              ))}
              <div style={{ borderTop: '1px solid var(--color-border)', padding: '6px 12px' }}>
                <button className="btn-ghost" style={{ fontSize: '11px', padding: '2px 0', color: 'var(--color-accent)' }} onClick={handleNewSequence}>
                  + New Sequence
                </button>
              </div>
            </div>
          )}
        </div>

        <div style={{ flex: 1 }} />

        {/* Tools */}
        <div style={{ display: 'flex', gap: '2px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px', marginRight: '8px' }} role="toolbar" aria-label="Edit tools">
          <button
            className={`btn-icon${tool === 'select' ? ' armed' : ''}`}
            onClick={() => onToolChange('select')}
            title="Select tool (V) — move, trim, select clips"
            aria-label="Select tool"
            aria-pressed={tool === 'select'}
            style={{ borderRadius: '3px' }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2 2l4.5 11 2-4.5L13 6.5 2 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill={tool === 'select' ? 'currentColor' : 'none'} />
            </svg>
          </button>
          <button
            className={`btn-icon${tool === 'razor' ? ' armed' : ''}`}
            onClick={() => onToolChange('razor')}
            title="Razor tool (C) — click to split clips"
            aria-label="Razor / cut tool"
            aria-pressed={tool === 'razor'}
            style={{ borderRadius: '3px' }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2 12L12 2M8 8l3 3a1 1 0 001-1l-1-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="4" cy="10" r="1.5" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
        </div>

        {/* Undo/Redo */}
        <button className="btn-icon" onClick={onUndo} disabled={project.undoDepth === 0} title={`Undo (Cmd+Z) — ${project.undoDepth} steps`} aria-label="Undo" style={{ opacity: project.undoDepth === 0 ? 0.35 : 1 }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 6H9a4 4 0 010 8H6M3 6L6 3M3 6l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button className="btn-icon" onClick={onRedo} disabled={project.redoDepth === 0} title={`Redo (Cmd+Shift+Z) — ${project.redoDepth} steps`} aria-label="Redo" style={{ opacity: project.redoDepth === 0 ? 0.35 : 1 }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M13 6H7a4 4 0 000 8h3M13 6l-3-3M13 6l-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div style={{ width: '1px', height: '20px', background: 'var(--color-border)', margin: '0 4px' }} aria-hidden="true" />

        {/* Save */}
        <button
          className="btn-ghost"
          onClick={onSave}
          style={{ fontSize: '12px', padding: '5px 12px', color: project.dirty ? 'var(--color-fg)' : 'var(--color-subtle)', background: project.dirty ? 'rgba(59,130,255,0.1)' : 'transparent', border: `1px solid ${project.dirty ? 'rgba(59,130,255,0.3)' : 'transparent'}` }}
          title="Save project (Cmd+S)"
          aria-label="Save project"
        >
          Save{project.dirty ? ' *' : ''}
        </button>

        {/* Export */}
        <button
          className="export-btn"
          onClick={() => setShowExport(true)}
          aria-label="Export project"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path d="M6.5 1v8M3 6l3.5 3.5L10 6M1 11h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Export
        </button>
      </header>

      {/* Modals */}
      {showProjectManager && <ProjectManager onClose={() => setShowProjectManager(false)} />}
      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
    </>
  );
}