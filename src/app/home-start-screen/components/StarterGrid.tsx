'use client';

import React from 'react';

interface Starter {
  id: string;
  name: string;
  blurb: string;
  duration: string;
  gradient: string;
  accentColor: string;
  icon: React.ReactNode;
  tags: string[];
}

const STARTERS: Starter[] = [
  {
    id: 'starter-talking-head',
    name: 'Talking Head',
    blurb: 'Direct-to-camera or interview. Transcript-driven editing — cut fillers, remove dead air, burn captions.',
    duration: '2–15 min',
    gradient: 'linear-gradient(135deg, #0d1b3e 0%, #1a2f5e 50%, #0f2040 100%)',
    accentColor: 'var(--color-accent)',
    tags: ['Words', 'Captions', 'Skills'],
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <circle cx="14" cy="10" r="5" stroke="#3B82FF" strokeWidth="1.5" />
        <path d="M4 24c0-5.523 4.477-10 10-10s10 4.477 10 10" stroke="#3B82FF" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'starter-listing',
    name: 'Listing Walkthrough',
    blurb: 'Structured explainer with b-roll, lower thirds, and transitions. Real estate, product demos, tutorials.',
    duration: '1–8 min',
    gradient: 'linear-gradient(135deg, #0d2a1e 0%, #0f3d26 50%, #0a2018 100%)',
    accentColor: 'var(--color-success)',
    tags: ['Graphics', 'Transitions', 'Media'],
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <rect x="3" y="5" width="22" height="3" rx="1.5" fill="#34D399" />
        <rect x="3" y="12" width="16" height="3" rx="1.5" fill="#34D399" opacity="0.7" />
        <rect x="3" y="19" width="19" height="3" rx="1.5" fill="#34D399" opacity="0.5" />
      </svg>
    ),
  },
  {
    id: 'starter-screen-demo',
    name: 'Screen Demo',
    blurb: 'Screen recording with callouts, zoom, and captions. Software walkthroughs and feature demos.',
    duration: '1–12 min',
    gradient: 'linear-gradient(135deg, #1a0d3e 0%, #2a1a5e 50%, #150d40 100%)',
    accentColor: 'var(--color-accent-2)',
    tags: ['Graphics', 'Captions', 'Cues'],
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <rect x="3" y="5" width="22" height="15" rx="2" stroke="#8B5CF6" strokeWidth="1.5" />
        <path d="M9 24h10M14 20v4" stroke="#8B5CF6" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="14" cy="12" r="3" stroke="#8B5CF6" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    id: 'starter-motion',
    name: 'Motion Graphic',
    blurb: 'Motion template workspace. Integration seam ready for the CutLab Motion Suite.',
    duration: '0:05–2 min',
    gradient: 'linear-gradient(135deg, #1a0d3e 0%, #3d1a6e 50%, #22063e 100%)',
    accentColor: 'var(--color-accent-2)',
    tags: ['Motion', 'Graphics', 'Timeline'],
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <path d="M5 20 C8 14, 12 8, 16 12 S22 6 24 8" stroke="#8B5CF6" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        <circle cx="8" cy="17" r="2.5" fill="#22D3EE" />
        <circle cx="16" cy="12" r="2" fill="white" />
        <circle cx="24" cy="8" r="2" fill="white" />
      </svg>
    ),
  },
  {
    id: 'starter-social',
    name: 'Social Cut',
    blurb: '9:16 vertical format for Reels, Shorts, and TikTok. Captions, safe areas, and social graphics.',
    duration: '0:15–1 min',
    gradient: 'linear-gradient(135deg, #1f0d1a 0%, #3d1530 50%, #280d20 100%)',
    accentColor: 'var(--color-danger)',
    tags: ['9:16', 'Captions', 'Graphics'],
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <rect x="9" y="3" width="10" height="18" rx="2" stroke="#F43F5E" strokeWidth="1.5" />
        <path d="M12 25h4" stroke="#F43F5E" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M12 10l4 2-4 2V10z" fill="#F43F5E" />
      </svg>
    ),
  },
];

interface StarterGridProps {
  onSelect: (id: string) => void;
}

export default function StarterGrid({ onSelect }: StarterGridProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px' }}>
      {STARTERS.map((starter) => (
        <button
          key={starter.id}
          className="starter-card"
          onClick={() => onSelect(starter.id)}
          style={{ textAlign: 'left', cursor: 'pointer', border: 'none', padding: 0 }}
          aria-label={`Start ${starter.name} project`}
          title={starter.blurb}
        >
          {/* Gradient plate */}
          <div style={{
            height: '100px',
            background: starter.gradient,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            overflow: 'hidden',
          }}>
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: 0,
                backgroundImage: 'linear-gradient(rgba(244,247,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(244,247,255,0.03) 1px, transparent 1px)',
                backgroundSize: '20px 20px',
              }}
            />
            {starter.icon}
            <div style={{
              position: 'absolute',
              bottom: '8px',
              right: '8px',
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              color: 'rgba(244,247,255,0.4)',
              letterSpacing: '0.04em',
            }}>
              {starter.duration}
            </div>
          </div>

          {/* Card body */}
          <div style={{ padding: '10px 12px 12px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-fg)', marginBottom: '4px' }}>
              {starter.name}
            </div>
            <p style={{ fontSize: '11px', color: 'var(--color-muted)', lineHeight: 1.5, marginBottom: '8px' }}>
              {starter.blurb}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {starter.tags.map((tag) => (
                <span
                  key={`tag-${starter.id}-${tag}`}
                  style={{
                    fontSize: '10px',
                    fontWeight: 500,
                    padding: '2px 6px',
                    borderRadius: '10px',
                    background: 'rgba(244,247,255,0.06)',
                    color: 'var(--color-subtle)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}