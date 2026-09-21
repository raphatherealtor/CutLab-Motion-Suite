'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { listRecents, type RecentEntry } from '@/engine/persistence';

const KIND_COLORS: Record<string, string> = {
  'Talking Head': 'var(--color-accent)',
  'Screen Demo': 'var(--color-accent-2)',
  'Motion': 'var(--color-accent-2)',
  'Social': 'var(--color-danger)',
  'Listing': 'var(--color-success)',
  'default': 'var(--color-muted)',
};

const THUMB_GRADIENTS = [
  'linear-gradient(135deg, #0d1b3e, #1a2f5e)',
  'linear-gradient(135deg, #1a0d3e, #2a1a5e)',
  'linear-gradient(135deg, #1a0d3e, #3d1a6e)',
  'linear-gradient(135deg, #0d2a1e, #0f3d26)',
  'linear-gradient(135deg, #1f0d1a, #3d1530)',
  'linear-gradient(135deg, #0d2a1e, #0a2018)',
];

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(ts).toLocaleDateString();
}

export default function RecentProjects() {
  const router = useRouter();
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const [pinned, setPinned] = useState<Set<string>>(new Set());

  useEffect(() => {
    const list = listRecents();
    setRecents(list);
    // Load pinned state from localStorage
    try {
      const p = JSON.parse(localStorage.getItem('cutlab-pinned') ?? '[]') as string[];
      setPinned(new Set(p));
    } catch {}
  }, []);

  const handleOpen = useCallback(async (entry: RecentEntry) => {
    // Store the project ID to load in the editor
    localStorage.setItem('cutlab-open-project', entry.id);
    router.push('/main-editor');
  }, [router]);

  const handleTogglePin = useCallback((id: string) => {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem('cutlab-pinned', JSON.stringify(Array.from(next)));
      return next;
    });
  }, []);

  const handleRemove = useCallback((id: string) => {
    setRecents((prev) => {
      const next = prev.filter((r) => r.id !== id);
      // Update localStorage recents list
      try {
        const stored = JSON.parse(localStorage.getItem('cutlab-recents') ?? '[]') as RecentEntry[];
        const updated = stored.filter((r) => r.id !== id);
        localStorage.setItem('cutlab-recents', JSON.stringify(updated));
      } catch {}
      return next;
    });
  }, []);

  const sorted = [
    ...recents.filter((r) => pinned.has(r.id)),
    ...recents.filter((r) => !pinned.has(r.id)),
  ];

  if (sorted.length === 0) {
    return (
      <div style={{ padding: '32px 20px', textAlign: 'center', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-lg)', background: 'rgba(244,247,255,0.01)' }}>
        <div style={{ fontSize: '13px', color: 'var(--color-muted)', marginBottom: '4px' }}>No recent projects</div>
        <div style={{ fontSize: '12px', color: 'var(--color-subtle)' }}>Projects you open or create will appear here.</div>
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: 'inset 0 1px 0 rgba(244,247,255,0.04)' }}>
      {sorted.map((entry, idx) => {
        const isPinned = pinned.has(entry.id);
        const thumbGrad = THUMB_GRADIENTS[idx % THUMB_GRADIENTS.length];
        const kindColor = KIND_COLORS[entry.name.includes('Motion') ? 'Motion' : entry.name.includes('Social') ? 'Social' : 'default'];

        return (
          <div
            key={entry.id}
            className="recent-row"
            style={{ borderTop: idx > 0 ? '1px solid var(--color-border)' : 'none' }}
          >
            {/* Thumbnail */}
            <div style={{ width: '52px', height: '32px', borderRadius: '4px', background: thumbGrad, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: 'rgba(244,247,255,0.3)', border: '1px solid rgba(244,247,255,0.06)' }} aria-hidden="true">
              ▶
            </div>

            {/* Name + meta */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entry.name}
                </span>
                {isPinned && <span style={{ fontSize: '10px', color: 'var(--color-accent-2)', flexShrink: 0 }} title="Pinned" aria-label="Pinned">◆</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '1px' }}>
                <span style={{ fontSize: '11px', color: kindColor, fontWeight: 500 }}>rev {entry.revision}</span>
                <span style={{ fontSize: '11px', color: 'var(--color-subtle)' }}>·</span>
                <span style={{ fontSize: '11px', color: 'var(--color-subtle)' }}>{timeAgo(entry.updatedAt)}</span>
              </div>
            </div>

            {/* Hover actions */}
            <div className="row-actions" style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
              <button
                className="btn-ghost"
                onClick={() => handleOpen(entry)}
                style={{ fontSize: '11px', padding: '3px 10px' }}
                aria-label={`Open ${entry.name}`}
              >
                Open
              </button>
              <button
                className="btn-ghost"
                onClick={() => handleTogglePin(entry.id)}
                style={{ fontSize: '11px', padding: '3px 8px', color: isPinned ? 'var(--color-accent-2)' : 'var(--color-subtle)' }}
                title={isPinned ? 'Unpin' : 'Pin'}
                aria-label={isPinned ? 'Unpin project' : 'Pin project'}
                aria-pressed={isPinned}
              >
                {isPinned ? '◆' : '◇'}
              </button>
              <button
                className="btn-ghost"
                onClick={() => handleRemove(entry.id)}
                style={{ fontSize: '11px', padding: '3px 8px', color: 'var(--color-subtle)' }}
                title="Remove from recents"
                aria-label="Remove from recents"
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}