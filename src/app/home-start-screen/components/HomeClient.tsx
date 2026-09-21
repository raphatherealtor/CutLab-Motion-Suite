'use client';

import React, { useState } from 'react';
import StarterGrid from './StarterGrid';
import RecentProjects from './RecentProjects';
import NewProjectModal from './NewProjectModal';
import HomeFooter from './HomeFooter';
import AppImage from '@/components/ui/AppImage';

export default function HomeClient() {
  const [showNewProject, setShowNewProject] = useState(false);
  const [selectedStarter, setSelectedStarter] = useState<string | null>(null);

  function handleNewProject() {
    setShowNewProject(true);
    setSelectedStarter(null);
  }

  function handleStarterSelect(id: string) {
    setSelectedStarter(id);
    setShowNewProject(true);
  }

  function handleModalClose() {
    setShowNewProject(false);
    setSelectedStarter(null);
  }

  return (
    <div
      className="relative flex flex-col"
      style={{
        width: '100vw',
        height: '100vh',
        backgroundColor: 'var(--color-bg)',
        overflow: 'hidden',
      }}
    >
      {/* Ambient gradient blobs — brand identity, not marketing fluff */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: '-120px',
          left: '-80px',
          width: '600px',
          height: '600px',
          background:
            'radial-gradient(circle, rgba(59,130,255,0.06) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          bottom: '-80px',
          right: '-60px',
          width: '500px',
          height: '500px',
          background:
            'radial-gradient(circle, rgba(139,92,246,0.05) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      {/* Thin top bar — just icon + app name, no full nav */}
      <header
        className="flex items-center gap-3 px-6 flex-shrink-0"
        style={{
          height: '44px',
          borderBottom: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-surface)',
          boxShadow: 'inset 0 1px 0 rgba(244,247,255,0.06)',
          zIndex: 20,
        }}
      >
        <AppImage
          src="/assets/images/app_logo.png"
          alt="CutLab Studio app icon"
          width={28}
          height={28}
          className="rounded"
          style={{ flexShrink: 0 }}
        />
        <span
          style={{
            fontSize: '13px',
            fontWeight: 600,
            color: 'var(--color-fg)',
            letterSpacing: '0.01em',
          }}
        >
          CutLab Studio
        </span>
        <div style={{ flex: 1 }} />
        <span
          style={{
            fontSize: '11px',
            color: 'var(--color-subtle)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          v1.0.0 · local
        </span>
      </header>

      {/* Main scrollable content */}
      <main
        className="flex-1 overflow-y-auto"
        style={{ minHeight: 0 }}
      >
        <div
          style={{
            maxWidth: '1100px',
            margin: '0 auto',
            padding: '56px 40px 80px',
          }}
        >
          {/* Brand lockup hero */}
          <div className="flex flex-col items-center mb-16 fade-in">
            <AppImage
              src="/assets/images/app_logo.png"
              alt="CutLab Studio — local-first NLE with Motion Suite"
              width={200}
              height={60}
              priority
              className="mb-8"
              style={{ objectFit: 'contain' }}
            />
            <p
              style={{
                fontSize: '15px',
                color: 'var(--color-muted)',
                textAlign: 'center',
                maxWidth: '480px',
                lineHeight: 1.6,
              }}
            >
              Local-first NLE with a native Motion Suite. One kernel, one undo
              stack, one render plan. No accounts.
            </p>
            <div className="flex items-center gap-3 mt-8">
              <button
                className="btn-primary"
                onClick={handleNewProject}
                style={{ fontSize: '15px', padding: '10px 28px' }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M8 2v12M2 8h12"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
                New Project
              </button>
              <button className="btn-ghost" style={{ fontSize: '13px' }}>
                Open Project…
              </button>
            </div>
          </div>

          {/* Starter grid */}
          <section className="mb-12 slide-up" style={{ animationDelay: '60ms' }}>
            <div className="flex items-center gap-3 mb-4">
              <span className="section-header-label">Start from a template</span>
              <div
                style={{
                  flex: 1,
                  height: '1px',
                  background: 'var(--color-border)',
                }}
              />
            </div>
            <StarterGrid onSelect={handleStarterSelect} />
          </section>

          {/* Recent projects */}
          <section className="slide-up" style={{ animationDelay: '120ms' }}>
            <div className="flex items-center gap-3 mb-4">
              <span className="section-header-label">Recent</span>
              <div
                style={{
                  flex: 1,
                  height: '1px',
                  background: 'var(--color-border)',
                }}
              />
              <button className="btn-ghost" style={{ fontSize: '12px', padding: '3px 8px' }}>
                Show all
              </button>
            </div>
            <RecentProjects />
          </section>
        </div>
      </main>

      <HomeFooter />

      {showNewProject && (
        <NewProjectModal
          starter={selectedStarter}
          onClose={handleModalClose}
        />
      )}
    </div>
  );
}