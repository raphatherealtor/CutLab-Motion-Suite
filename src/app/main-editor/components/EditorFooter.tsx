'use client';

import React, { useState } from 'react';
import { useEngine } from '@/engine/store';

import type { ProjectState, PlaybackState } from './EditorClient';

interface EditorFooterProps {
  project: ProjectState;
  playback: PlaybackState;
}

const SHORTCUT_GROUPS = [
  {
    label: 'Playback',
    shortcuts: [
      { keys: 'Space / K', desc: 'Play / Pause' },
      { keys: 'J', desc: 'Skip back 1 sec' },
      { keys: 'L', desc: 'Skip forward 1 sec' },
      { keys: '← →', desc: 'Step 1 frame' },
      { keys: '⇧← ⇧→', desc: 'Step 1 second' },
      { keys: 'Home / End', desc: 'Go to start / end' },
    ],
  },
  {
    label: 'Edit',
    shortcuts: [
      { keys: 'S', desc: 'Split at playhead' },
      { keys: '⌫', desc: 'Delete selection' },
      { keys: '⇧⌫', desc: 'Ripple delete' },
      { keys: 'D', desc: 'Duplicate' },
      { keys: 'W', desc: 'Close gap' },
      { keys: '⌘A', desc: 'Select all' },
      { keys: 'Esc', desc: 'Deselect' },
    ],
  },
  {
    label: 'Marks',
    shortcuts: [
      { keys: 'I', desc: 'Mark In' },
      { keys: 'O', desc: 'Mark Out' },
      { keys: 'X', desc: 'Clear In/Out' },
      { keys: 'M', desc: 'Add marker' },
      { keys: '⇧↓ ⇧↑', desc: 'Next / prev marker' },
      { keys: '⌥→ ⌥←', desc: 'Next / prev keyframe' },
    ],
  },
  {
    label: 'Tools',
    shortcuts: [
      { keys: 'V', desc: 'Select tool' },
      { keys: 'C', desc: 'Razor tool' },
      { keys: 'N', desc: 'Toggle snap' },
      { keys: 'R', desc: 'Toggle ripple' },
      { keys: 'G', desc: 'Toggle guides' },
      { keys: '⇧S', desc: 'Toggle safe areas' },
    ],
  },
  {
    label: 'View',
    shortcuts: [
      { keys: '+ / -', desc: 'Zoom in / out' },
      { keys: '\\', desc: 'Fit timeline' },
      { keys: '⌘Z', desc: 'Undo' },
      { keys: '⌘⇧Z', desc: 'Redo' },
      { keys: '⌘S', desc: 'Save' },
      { keys: '⌘D', desc: 'Cross dissolve' },
    ],
  },
];

export default function EditorFooter({ project, playback }: EditorFooterProps) {
  const engine = useEngine();
  const { activeSequence, session } = engine;
  const fps = activeSequence?.format.fps ?? 29.97;
  const width = activeSequence?.format.width ?? 1920;
  const height = activeSequence?.format.height ?? 1080;
  const [showShortcuts, setShowShortcuts] = useState(false);

  const progressPct = playback.totalFrames > 0
    ? Math.round((playback.frameIndex / playback.totalFrames) * 100)
    : 0;

  return (
    <>
      {/* Shortcut reference panel */}
      {showShortcuts && (
        <div
          style={{
            position: 'fixed',
            bottom: '34px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 200,
            background: 'var(--color-elevated)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
            padding: '16px 20px',
            width: '680px',
            maxWidth: '90vw',
          }}
          role="dialog"
          aria-label="Keyboard shortcuts reference"
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-fg)' }}>Keyboard Shortcuts</span>
            <button
              className="btn-icon"
              onClick={() => setShowShortcuts(false)}
              aria-label="Close shortcuts"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '16px' }}>
            {SHORTCUT_GROUPS.map((group) => (
              <div key={group.label}>
                <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-subtle)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '6px' }}>
                  {group.label}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  {group.shortcuts.map((s) => (
                    <div key={s.keys} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <kbd style={{
                        fontSize: '9px',
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--color-fg)',
                        background: 'rgba(244,247,255,0.07)',
                        border: '1px solid var(--color-border)',
                        borderRadius: '3px',
                        padding: '1px 5px',
                        flexShrink: 0,
                        whiteSpace: 'nowrap',
                        minWidth: '36px',
                        textAlign: 'center',
                      }}>
                        {s.keys}
                      </kbd>
                      <span style={{ fontSize: '10px', color: 'var(--color-muted)', lineHeight: 1.3 }}>{s.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <footer
        style={{
          height: '26px',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '0 10px',
          backgroundColor: 'var(--color-surface)',
          borderTop: '1px solid var(--color-border)',
        }}
      >
        {/* Engine health */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          <span className="status-jewel jewel-ok" aria-hidden="true" />
          <span style={{ fontSize: '10px', color: 'var(--color-subtle)', fontFamily: 'var(--font-mono)' }}>engine</span>
        </div>

        <div style={{ width: '1px', height: '12px', background: 'var(--color-border)', flexShrink: 0 }} aria-hidden="true" />

        {/* Save status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          <span className={`status-jewel ${project.dirty ? 'jewel-warn' : 'jewel-ok'}`} aria-hidden="true" />
          <span style={{ fontSize: '10px', color: 'var(--color-subtle)', fontFamily: 'var(--font-mono)' }}>
            {project.dirty ? `unsaved · ${project.savedAgo}` : `saved · ${project.savedAgo}`}
          </span>
        </div>

        <div style={{ width: '1px', height: '12px', background: 'var(--color-border)', flexShrink: 0 }} aria-hidden="true" />

        {/* Snap / Ripple indicators */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
          <span style={{
            fontSize: '9px',
            fontFamily: 'var(--font-mono)',
            color: session.snapEnabled ? 'var(--color-accent)' : 'var(--color-subtle)',
            opacity: session.snapEnabled ? 1 : 0.5,
          }} title="Snap (N to toggle)">
            SNAP
          </span>
          <span style={{
            fontSize: '9px',
            fontFamily: 'var(--font-mono)',
            color: session.rippleEnabled ? 'var(--color-accent)' : 'var(--color-subtle)',
            opacity: session.rippleEnabled ? 1 : 0.5,
          }} title="Ripple (R to toggle)">
            RIPPLE
          </span>
        </div>

        <div style={{ flex: 1 }} />

        {/* Playback position */}
        <span style={{ fontSize: '10px', color: 'var(--color-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
          {progressPct}%
        </span>

        <div style={{ width: '1px', height: '12px', background: 'var(--color-border)', flexShrink: 0 }} aria-hidden="true" />

        {/* Sequence info */}
        <span style={{ fontSize: '10px', color: 'var(--color-subtle)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
          {width}×{height} · {fps.toFixed(2)} fps
        </span>

        <div style={{ width: '1px', height: '12px', background: 'var(--color-border)', flexShrink: 0 }} aria-hidden="true" />

        {/* Shortcut reference toggle */}
        <button
          onClick={() => setShowShortcuts((v) => !v)}
          style={{
            background: showShortcuts ? 'rgba(59,130,255,0.12)' : 'transparent',
            border: 'none',
            borderRadius: '3px',
            padding: '2px 6px',
            fontSize: '10px',
            fontFamily: 'var(--font-mono)',
            color: showShortcuts ? 'var(--color-accent)' : 'var(--color-subtle)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
          title="Keyboard shortcuts reference"
          aria-label="Toggle keyboard shortcuts reference"
          aria-pressed={showShortcuts}
        >
          ?
        </button>
      </footer>
    </>
  );
}