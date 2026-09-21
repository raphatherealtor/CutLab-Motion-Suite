'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useEngine } from '@/engine/store';
import { listRecents, removeFromRecents, saveProjectAs, duplicateProject, type RecentEntry } from '@/engine/persistence';

interface ProjectManagerProps {
  onClose: () => void;
}

export default function ProjectManager({ onClose }: ProjectManagerProps) {
  const engine = useEngine();
  const { project, dirty, savedAgo } = engine;
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const [tab, setTab] = useState<'save' | 'open' | 'package'>('save');
  const [status, setStatus] = useState<string | null>(null);
  const [saveAsName, setSaveAsName] = useState('');
  const [showSaveAs, setShowSaveAs] = useState(false);

  useEffect(() => {
    setRecents(listRecents());
    setSaveAsName(project.name);
  }, [project.name]);

  const handleSave = useCallback(async () => {
    await engine.save();
    setStatus('Saved');
    setTimeout(() => setStatus(null), 2000);
    setRecents(listRecents());
  }, [engine]);

  const handleSaveAs = useCallback(async () => {
    if (!saveAsName.trim()) return;
    try {
      const newProj = await saveProjectAs(project, saveAsName.trim());
      // Load the new project
      await engine.loadProjectById(newProj.id);
      setStatus(`Saved as "${newProj.name}"`);
      setShowSaveAs(false);
      setRecents(listRecents());
      setTimeout(() => { setStatus(null); onClose(); }, 1500);
    } catch {
      setStatus('Save As failed');
    }
  }, [project, saveAsName, engine, onClose]);

  const handleDuplicate = useCallback(async () => {
    try {
      const duped = await duplicateProject(project);
      setStatus(`Duplicated as "${duped.name}"`);
      setRecents(listRecents());
      setTimeout(() => setStatus(null), 2000);
    } catch {
      setStatus('Duplicate failed');
    }
  }, [project]);

  const handleOpen = useCallback(async (projectId: string) => {
    await engine.loadProjectById(projectId);
    setStatus('Project opened');
    onClose();
  }, [engine, onClose]);

  const handleRemoveRecent = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeFromRecents(id);
    setRecents(listRecents());
  }, []);

  const handleExportPackage = useCallback(async () => {
    const { downloadProjectPackage } = await import('@/engine/persistence');
    downloadProjectPackage(project);
    setStatus('Package exported');
    setTimeout(() => setStatus(null), 2000);
  }, [project]);

  const handleImportPackage = useCallback(async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.cutlab';
    input.onchange = async () => {
      if (!input.files?.[0]) return;
      try {
        const { importProjectPackage, saveProject } = await import('@/engine/persistence');
        const imported = await importProjectPackage(input.files[0]);
        if (imported) {
          await saveProject(imported);
          await engine.loadProjectById(imported.id);
          setStatus('Package imported — media may need relinking');
          onClose();
        } else {
          setStatus('Failed to import package');
        }
      } catch {
        setStatus('Failed to import package');
      }
    };
    input.click();
  }, [engine, onClose]);

  const handleNewProject = useCallback((name: string) => {
    engine.newProject(name);
    onClose();
  }, [engine, onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(7,10,16,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Project Manager"
    >
      <div style={{
        width: '520px',
        maxHeight: '80vh',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: '10px',
        boxShadow: '0 24px 64px rgba(0,0,0,0.8)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-fg)', flex: 1 }}>Project</span>
          <div style={{ display: 'flex', gap: '3px' }}>
            {([
              { id: 'save', label: 'Save' },
              { id: 'open', label: 'Open' },
              { id: 'package', label: 'Package' },
            ] as const).map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{
                  fontSize: '11px',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  border: 'none',
                  background: tab === t.id ? 'rgba(59,130,255,0.15)' : 'transparent',
                  color: tab === t.id ? 'var(--color-accent)' : 'var(--color-muted)',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                  fontWeight: tab === t.id ? 600 : 400,
                }}
                aria-pressed={tab === t.id}
                title={
                  t.id === 'save' ? 'Save, Save As, Duplicate' :
                  t.id === 'open'? 'Open recent projects' : 'Export / Import project package'
                }
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            onClick={onClose}
            className="btn-icon"
            aria-label="Close project manager"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {tab === 'save' && (
            <div>
              <div style={{ background: 'var(--color-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: '12px', marginBottom: '12px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-fg)', marginBottom: '4px' }}>
                  {project.name}
                  {dirty && <span style={{ marginLeft: '6px', fontSize: '11px', color: 'var(--color-accent)', fontWeight: 400 }}>● unsaved</span>}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-subtle)' }}>
                  Revision {project.revision} · {savedAgo}
                </div>
              </div>

              {/* Save / Save As / Duplicate */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <button className="btn-primary" onClick={handleSave} style={{ flex: 1, fontSize: '12px', padding: '9px' }} aria-label="Save project">
                  Save
                </button>
                <button className="btn-ghost" onClick={() => setShowSaveAs((v) => !v)} style={{ flex: 1, fontSize: '12px', padding: '9px' }} aria-label="Save As">
                  Save As…
                </button>
                <button className="btn-ghost" onClick={handleDuplicate} style={{ flex: 1, fontSize: '12px', padding: '9px' }} aria-label="Duplicate project">
                  Duplicate
                </button>
              </div>

              {/* Save As inline form */}
              {showSaveAs && (
                <div style={{ background: 'var(--color-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: '12px', marginBottom: '12px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--color-subtle)', marginBottom: '6px' }}>Save As — new project name:</div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      type="text"
                      value={saveAsName}
                      onChange={(e) => setSaveAsName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSaveAs(); if (e.key === 'Escape') setShowSaveAs(false); }}
                      placeholder="New project name"
                      style={{
                        flex: 1,
                        background: 'var(--color-bg)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--color-fg)',
                        fontSize: '12px',
                        padding: '6px 8px',
                        fontFamily: 'var(--font-sans)',
                      }}
                      aria-label="New project name"
                      autoFocus
                    />
                    <button className="btn-primary" onClick={handleSaveAs} style={{ fontSize: '12px', padding: '6px 12px', flexShrink: 0 }} aria-label="Confirm Save As">
                      Save
                    </button>
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--color-subtle)', marginTop: '6px' }}>
                    Creates a new independent project. The current project is not modified.
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'open' && (
            <div>
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '10px', color: 'var(--color-subtle)', marginBottom: '8px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Recent Projects</div>
                {recents.length === 0 ? (
                  <div style={{ fontSize: '12px', color: 'var(--color-subtle)', textAlign: 'center', padding: '24px' }}>
                    <div style={{ marginBottom: '4px' }}>No recent projects</div>
                    <div style={{ fontSize: '11px' }}>Create a new project to get started.</div>
                  </div>
                ) : (
                  recents.map((r) => (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', background: 'var(--color-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', marginBottom: '6px', cursor: 'pointer' }}
                      onClick={() => handleOpen(r.id)}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                        <div style={{ fontSize: '10px', color: 'var(--color-subtle)', fontFamily: 'var(--font-mono)' }}>
                          {new Date(r.updatedAt).toLocaleDateString()} · rev {r.revision}
                        </div>
                      </div>
                      <button
                        className="btn-ghost"
                        style={{ fontSize: '11px', padding: '3px 8px', flexShrink: 0 }}
                        aria-label={`Open ${r.name}`}
                        onClick={(e) => { e.stopPropagation(); handleOpen(r.id); }}
                      >
                        Open
                      </button>
                      <button
                        onClick={(e) => handleRemoveRecent(r.id, e)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--color-subtle)', cursor: 'pointer', fontSize: '12px', padding: '2px 4px', flexShrink: 0 }}
                        title="Remove from recents"
                        aria-label={`Remove ${r.name} from recents`}
                      >
                        ✕
                      </button>
                    </div>
                  ))
                )}
              </div>
              <button
                className="btn-ghost"
                onClick={() => handleNewProject('Untitled Project')}
                style={{ width: '100%', fontSize: '12px', padding: '8px', color: 'var(--color-muted)' }}
                aria-label="Create new project"
              >
                + New Project
              </button>
            </div>
          )}

          {tab === 'package' && (
            <div>
              <div style={{ fontSize: '12px', color: 'var(--color-muted)', lineHeight: 1.6, marginBottom: '12px' }}>
                Export a portable project package (JSON). Media files are referenced by path — not embedded.
              </div>
              <div style={{
                padding: '8px 10px',
                background: 'rgba(244,247,255,0.03)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                marginBottom: '14px',
                fontSize: '11px',
                color: 'var(--color-subtle)',
                lineHeight: 1.5,
              }}>
                Importing on another machine may require relinking media files. Asset IDs are preserved — relinking reconnects existing clips without data loss.
              </div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <button className="btn-primary" onClick={handleExportPackage} style={{ flex: 1, fontSize: '13px', padding: '10px' }} aria-label="Export project package">
                  Export Package
                </button>
                <button className="btn-ghost" onClick={handleImportPackage} style={{ flex: 1, fontSize: '13px', padding: '10px' }} aria-label="Import project package">
                  Import Package
                </button>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--color-subtle)', lineHeight: 1.5 }}>
                Schema v{project.schemaVersion ?? 2} · {Object.keys(project.assets).length} assets · {Object.keys(project.sequences).length} sequence{Object.keys(project.sequences).length !== 1 ? 's' : ''}
              </div>
            </div>
          )}
        </div>

        {/* Status */}
        {status && (
          <div style={{ padding: '10px 20px', borderTop: '1px solid var(--color-border)', fontSize: '12px', color: 'var(--color-success)' }}>
            {status}
          </div>
        )}
      </div>
    </div>
  );
}
