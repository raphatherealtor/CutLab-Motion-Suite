'use client';

import React, { useState, useCallback } from 'react';
import { useEngine } from '@/engine/store';

interface ExportDialogProps {
  onClose: () => void;
}

const SIZE_OPTIONS = [
  { id: '1920x1080', label: '1920×1080 (1080p)', w: 1920, h: 1080 },
  { id: '1280x720', label: '1280×720 (720p)', w: 1280, h: 720 },
  { id: '1080x1920', label: '1080×1920 (9:16)', w: 1080, h: 1920 },
  { id: '1080x1080', label: '1080×1080 (1:1)', w: 1080, h: 1080 },
];

export default function ExportDialog({ onClose }: ExportDialogProps) {
  const engine = useEngine();
  const { project, activeSequence } = engine;

  const [size, setSize] = useState('1920x1080');
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [encoderPath, setEncoderPath] = useState('');

  const fps = activeSequence?.format.fps ?? 29.97;
  const selectedSize = SIZE_OPTIONS.find((s) => s.id === size) ?? SIZE_OPTIONS[0];

  const totalFrames = activeSequence
    ? Math.round(activeSequence.clips.reduce((max, c) => {
        const end = (c.startTime.value / c.startTime.timescale + c.duration.value / c.duration.timescale);
        return Math.max(max, end);
      }, 0) * fps)
    : 0;

  const handleExport = useCallback(async () => {
    if (!activeSequence || totalFrames === 0) {
      setStatus('error');
      setStatusMsg('No content to export. Add clips to the timeline first.');
      return;
    }

    setStatus('running');
    setProgress(0);
    setStatusMsg('Preparing export…');

    try {
      // Build a preset matching selected size
      const presetId = `export-${Date.now()}`;
      const preset = {
        id: presetId,
        name: 'Export',
        codec: 'vp9',
        width: selectedSize.w,
        height: selectedSize.h,
        fps,
        bitrate: 6_000_000,
        audioBitrate: 192_000,
        audioCodec: 'opus',
        container: 'webm',
      };

      // Register preset temporarily
      const projectWithPreset = {
        ...project,
        exportPresets: { ...project.exportPresets, [presetId]: preset },
      };

      const { runExport } = await import('@/engine/export-pipeline');

      const job = await runExport(projectWithPreset, presetId, (p) => {
        setProgress(Math.round(p * 100));
        if (p < 0.6) setStatusMsg(`Rendering frames… ${Math.round(p * 100)}%`);
        else if (p < 0.8) setStatusMsg(`Encoding audio… ${Math.round(p * 100)}%`);
        else if (p < 1.0) setStatusMsg(`Muxing… ${Math.round(p * 100)}%`);
        else setStatusMsg('Finalizing…');
      });

      if (job.status === 'complete' && job.outputUrl && job.outputBlob) {
        setEncoderPath(job.encoderPath ?? '');
        const ext = job.encoderPath === 'audio-only' ? 'wav' : 'webm';
        const mimeType = job.encoderPath === 'audio-only' ? 'audio/wav' : 'video/webm';
        const a = document.createElement('a');
        a.href = job.outputUrl;
        a.download = `${project.name}.${ext}`;
        a.click();
        setProgress(100);
        setStatus('done');
        setStatusMsg(`Export complete — ${job.encoderPath ?? 'unknown'} path. File: ${project.name}.${ext}`);
      } else {
        setStatus('error');
        setStatusMsg(`Export failed: ${job.error ?? 'Unknown error'}`);
      }
    } catch (err) {
      setStatus('error');
      setStatusMsg(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, [project, activeSequence, selectedSize, fps, totalFrames]);

  const canExport = totalFrames > 0 && status !== 'running';

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(7,10,16,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Export"
    >
      <div style={{ width: '460px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', boxShadow: '0 24px 64px rgba(0,0,0,0.8)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center' }}>
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-fg)', flex: 1 }}>Export</span>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--color-subtle)', cursor: 'pointer', fontSize: '16px', padding: '2px 6px' }} aria-label="Close">✕</button>
        </div>

        <div style={{ padding: '16px 20px' }}>
          {/* Export info */}
          <div style={{ marginBottom: '16px', padding: '10px 12px', background: 'var(--color-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', fontSize: '11px', color: 'var(--color-muted)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span>Sequence</span>
              <span style={{ color: 'var(--color-fg)' }}>{activeSequence?.name ?? '—'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span>Duration</span>
              <span style={{ color: 'var(--color-fg)' }}>{totalFrames > 0 ? `${(totalFrames / fps).toFixed(2)}s (${totalFrames} frames)` : 'No content'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Format</span>
              <span style={{ color: 'var(--color-fg)' }}>WebM (VP9 + Opus) — real A/V</span>
            </div>
          </div>

          {/* Size */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '10px', color: 'var(--color-subtle)', marginBottom: '8px', fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Output Size</div>
            <select value={size} onChange={(e) => setSize(e.target.value)}
              style={{ width: '100%', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'var(--color-fg)', fontSize: '12px', padding: '8px 10px' }}
              aria-label="Output size">
              {SIZE_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>

          {/* Encoder path info */}
          <div style={{ marginBottom: '16px', padding: '8px 10px', background: 'rgba(59,130,255,0.06)', border: '1px solid rgba(59,130,255,0.15)', borderRadius: 'var(--radius)', fontSize: '10px', color: 'var(--color-subtle)' }}>
            <div style={{ fontWeight: 600, color: 'var(--color-accent)', marginBottom: '3px' }}>Export Path</div>
            <div>1. MediaRecorder (VP9/VP8 + Opus) — real video + audio</div>
            <div>2. WAV audio only — last resort if MediaRecorder is unavailable</div>
            <div style={{ marginTop: '4px', color: 'rgba(244,247,255,0.3)' }}>Same compositor as preview. Real video + Motion + audio.</div>
          </div>

          {/* Progress */}
          {status !== 'idle' && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ height: '4px', background: 'var(--color-well)', borderRadius: '2px', marginBottom: '6px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress ?? 0}%`, background: status === 'error' ? 'var(--color-danger)' : status === 'done' ? 'var(--color-success)' : 'var(--color-accent)', transition: 'width 200ms ease', borderRadius: '2px' }} />
              </div>
              <div style={{ fontSize: '11px', color: status === 'error' ? 'var(--color-danger)' : status === 'done' ? 'var(--color-success)' : 'var(--color-muted)' }}>
                {statusMsg}
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn-ghost" onClick={onClose} style={{ flex: 1, fontSize: '13px', padding: '10px' }} aria-label="Cancel export">Cancel</button>
            <button
              className="btn-primary"
              onClick={handleExport}
              disabled={!canExport}
              style={{ flex: 2, fontSize: '13px', padding: '10px', opacity: !canExport ? 0.5 : 1 }}
              aria-label="Start export"
            >
              {status === 'running' ? `Exporting… ${progress ?? 0}%` : status === 'done' ? 'Done ✓' : totalFrames === 0 ? 'No content' : 'Export'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
