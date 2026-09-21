'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createDefaultProject } from '@/engine/schema';
import { saveProject } from '@/engine/persistence';

interface NewProjectModalProps {
  starter: string | null;
  onClose: () => void;
}

const STARTER_LABELS: Record<string, string> = {
  'starter-talking-head': 'Talking Head',
  'starter-listing': 'Listing Walkthrough',
  'starter-screen-demo': 'Screen Demo',
  'starter-motion': 'Motion Graphic',
  'starter-social': 'Social Cut',
};

const STARTER_DESCRIPTIONS: Record<string, string> = {
  'starter-talking-head': 'Interview, commentary, or direct-to-camera. Transcript-driven editing with captions.',
  'starter-listing': 'Structured explainer with b-roll, lower thirds, and transitions.',
  'starter-screen-demo': 'Screen recording with callouts, zoom, and captions.',
  'starter-motion': 'Motion Graphic workspace — Motion engine integration seam ready.',
  'starter-social': '9:16 vertical format for Reels, Shorts, and TikTok.',
};

// Starter-specific defaults
const STARTER_DEFAULTS: Record<string, { formatId: string; fps: string; workspaceHint: string }> = {
  'starter-talking-head': { formatId: 'format-1920x1080', fps: '29.97', workspaceHint: 'Words → Captions → Export' },
  'starter-listing': { formatId: 'format-1920x1080', fps: '29.97', workspaceHint: 'Media → Timeline → Graphics → Export' },
  'starter-screen-demo': { formatId: 'format-1920x1080', fps: '60', workspaceHint: 'Media → Graphics → Captions → Export' },
  'starter-motion': { formatId: 'format-1920x1080', fps: '29.97', workspaceHint: 'Motion Library → Timeline → Export' },
  'starter-social': { formatId: 'format-1080x1920', fps: '29.97', workspaceHint: 'Words → Captions → Graphics → Export' },
};

const FORMAT_OPTIONS = [
  { id: 'format-1920x1080', label: '1920 × 1080', sub: '16:9 · 1080p', w: 1920, h: 1080 },
  { id: 'format-3840x2160', label: '3840 × 2160', sub: '16:9 · 4K', w: 3840, h: 2160 },
  { id: 'format-1080x1920', label: '1080 × 1920', sub: '9:16 · Vertical', w: 1080, h: 1920 },
  { id: 'format-1080x1080', label: '1080 × 1080', sub: '1:1 · Square', w: 1080, h: 1080 },
];

const FPS_OPTIONS = ['23.976', '24', '25', '29.97', '30', '60'];

export default function NewProjectModal({ starter, onClose }: NewProjectModalProps) {
  const router = useRouter();
  const starterDefaults = starter ? STARTER_DEFAULTS[starter] : null;

  const [name, setName] = useState(
    starter
      ? `${STARTER_LABELS[starter] || 'Untitled'} — New Project`
      : 'Untitled Project'
  );
  const [format, setFormat] = useState(starterDefaults?.formatId ?? 'format-1920x1080');
  const [fps, setFps] = useState(starterDefaults?.fps ?? '29.97');
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const formatOpt = FORMAT_OPTIONS.find((f) => f.id === format) ?? FORMAT_OPTIONS[0];
      const project = createDefaultProject(name.trim());

      // Apply format settings
      const seqId = project.activeSequenceId;
      project.sequences[seqId].format = {
        ...project.sequences[seqId].format,
        width: formatOpt.w,
        height: formatOpt.h,
        fps: parseFloat(fps),
      };

      // Apply starter-specific sequence name
      if (starter && STARTER_LABELS[starter]) {
        project.sequences[seqId].name = `${STARTER_LABELS[starter]} Sequence`;
      }

      // Store starter type for workspace hint
      if (starter) {
        (project as any).starterType = starter;
      }

      await saveProject(project);
      localStorage.setItem('cutlab-open-project', project.id);
      router.push('/main-editor');
    } catch (e) {
      console.warn('[cutlab] create project failed', e);
      setCreating(false);
    }
  }

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New Project"
      onClick={handleBackdropClick}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(7,10,16,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        className="fade-in"
        style={{
          background: 'var(--color-elevated)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          width: '440px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(244,247,255,0.06)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px 12px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '12px',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-fg)' }}>New Project</div>
            {starter && STARTER_LABELS[starter] && (
              <div style={{ fontSize: '12px', color: 'var(--color-accent)', marginTop: '2px' }}>
                {STARTER_LABELS[starter]}
              </div>
            )}
            {starter && STARTER_DESCRIPTIONS[starter] && (
              <div style={{ fontSize: '11px', color: 'var(--color-subtle)', marginTop: '4px', lineHeight: 1.4 }}>
                {STARTER_DESCRIPTIONS[starter]}
              </div>
            )}
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close" style={{ flexShrink: 0, marginTop: '2px' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px' }}>
          {/* Name */}
          <div style={{ marginBottom: '16px' }}>
            <label htmlFor="project-name" style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 600,
              color: 'var(--color-subtle)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              marginBottom: '6px',
            }}>
              Project Name
            </label>
            <input
              id="project-name"
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') onClose();
              }}
              className="inspector-input"
              style={{ fontSize: '13px', padding: '7px 10px', width: '100%' }}
              autoComplete="off"
            />
          </div>

          {/* Format */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 600,
              color: 'var(--color-subtle)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              marginBottom: '6px',
            }}>
              Sequence Format
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              {FORMAT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setFormat(opt.id)}
                  style={{
                    background: format === opt.id ? 'rgba(59,130,255,0.15)' : 'var(--color-well)',
                    border: `1px solid ${format === opt.id ? 'rgba(59,130,255,0.5)' : 'var(--color-border)'}`,
                    borderRadius: 'var(--radius-sm)',
                    padding: '7px 10px',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                  aria-pressed={format === opt.id}
                >
                  <div style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: format === opt.id ? 'var(--color-accent)' : 'var(--color-fg)',
                    fontFamily: 'var(--font-mono)',
                  }}>
                    {opt.label}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--color-subtle)', marginTop: '1px' }}>{opt.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* FPS */}
          <div style={{ marginBottom: starterDefaults?.workspaceHint ? '14px' : '20px' }}>
            <label style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 600,
              color: 'var(--color-subtle)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              marginBottom: '6px',
            }}>
              Frame Rate
            </label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {FPS_OPTIONS.map((f) => (
                <button
                  key={`fps-${f}`}
                  onClick={() => setFps(f)}
                  style={{
                    background: fps === f ? 'rgba(59,130,255,0.15)' : 'var(--color-well)',
                    border: `1px solid ${fps === f ? 'rgba(59,130,255,0.5)' : 'var(--color-border)'}`,
                    borderRadius: 'var(--radius-sm)',
                    padding: '4px 10px',
                    fontSize: '12px',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 500,
                    color: fps === f ? 'var(--color-accent)' : 'var(--color-muted)',
                    cursor: 'pointer',
                  }}
                  aria-pressed={fps === f}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Workflow hint for starters */}
          {starterDefaults?.workspaceHint && (
            <div style={{
              marginBottom: '20px',
              padding: '8px 10px',
              background: 'rgba(59,130,255,0.06)',
              border: '1px solid rgba(59,130,255,0.15)',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
            }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" style={{ flexShrink: 0, opacity: 0.6 }}>
                <path d="M2 6h8M6 2l4 4-4 4" stroke="var(--color-accent)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span style={{ fontSize: '11px', color: 'var(--color-subtle)' }}>
                Suggested workflow: <span style={{ color: 'var(--color-fg)' }}>{starterDefaults.workspaceHint}</span>
              </span>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button className="btn-ghost" onClick={onClose} disabled={creating}>Cancel</button>
            <button
              className="btn-primary"
              onClick={handleCreate}
              disabled={creating || !name.trim()}
              style={{ minWidth: '120px', justifyContent: 'center' }}
            >
              {creating ? 'Creating…' : 'Create Project'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}