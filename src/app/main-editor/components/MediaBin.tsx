'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { useEngine } from '@/engine/store';
import { makeOp } from '@/engine/operations';
import type { Asset } from '@/engine/schema';
import { generateId } from '@/engine/schema';
import { fromSeconds } from '@/engine/time';

type SortKey = 'name' | 'kind' | 'duration' | 'ingestedAt' | 'fileSize';
type KindFilter = 'all' | 'video' | 'audio' | 'image' | 'graphic' | 'motion-bundle';

function formatDuration(frames?: number, fps = 29.97): string {
  if (!frames) return '—';
  const secs = frames / fps;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  const f = Math.round((secs % 1) * fps);
  return `${m}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const CASTE_COLOR: Record<string, string> = {
  original: 'var(--color-success)',
  proxy: 'var(--color-accent-3)',
  relinked: 'var(--color-accent)',
  plate: 'var(--color-accent-2)',
  missing: 'var(--color-danger)',
  failed: 'var(--color-danger)',
  stub: 'var(--color-subtle)',
};

const KIND_ICON: Record<string, string> = {
  video: '▶',
  audio: '♪',
  image: '▣',
  graphic: '◈',
  'motion-bundle': '◆',
};

export default function MediaBin() {
  const engine = useEngine();
  const { project, activeSequence, dispatch } = engine;
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('ingestedAt');
  const [sortAsc, setSortAsc] = useState(false);
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  const assets = useMemo(() => {
    let list = Object.values(project.assets);
    if (kindFilter !== 'all') list = list.filter((a) => a.kind === kindFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((a) =>
        a.name.toLowerCase().includes(q) ||
        a.kind.toLowerCase().includes(q) ||
        a.caste.toLowerCase().includes(q) ||
        (a.tags ?? []).some((t) => t.toLowerCase().includes(q))
      );
    }
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortKey === 'kind') cmp = a.kind.localeCompare(b.kind);
      else if (sortKey === 'duration') cmp = (a.durationFrames ?? 0) - (b.durationFrames ?? 0);
      else if (sortKey === 'ingestedAt') cmp = (a.ingestedAt ?? 0) - (b.ingestedAt ?? 0);
      else if (sortKey === 'fileSize') cmp = (a.fileSize ?? 0) - (b.fileSize ?? 0);
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [project.assets, search, sortKey, sortAsc, kindFilter]);

  const handleImport = useCallback(async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*,audio/*,image/*';
    input.multiple = true;
    input.onchange = async () => {
      if (!input.files) return;
      const { ingestFile } = await import('@/engine/media');
      for (const file of Array.from(input.files)) {
        try {
          const { asset } = await ingestFile(file);
          dispatch(makeOp('asset.register', { asset }), `Import ${asset.name}`);
        } catch (e) {
          console.warn('[cutlab] import failed', e);
        }
      }
    };
    input.click();
  }, [dispatch]);

  const handleRelink = useCallback(async (assetId: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*,audio/*,image/*';
    input.onchange = async () => {
      if (!input.files?.[0]) return;
      const { ingestFile } = await import('@/engine/media');
      const { asset } = await ingestFile(input.files[0]);
      dispatch(makeOp('asset.relink', { assetId, newSourceRef: asset.sourceRef, newRuntimeUrl: asset.runtimeUrl }), 'Relink asset');
    };
    input.click();
  }, [dispatch]);

  const handleRemoveAsset = useCallback((assetId: string) => {
    dispatch(makeOp('asset.remove', { assetId }), 'Remove asset');
    if (selectedAssetId === assetId) setSelectedAssetId(null);
  }, [dispatch, selectedAssetId]);

  const handleDragStart = useCallback((e: React.DragEvent, asset: Asset) => {
    e.dataTransfer.setData('application/cutlab-asset', asset.id);
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  const handleAddToTimeline = useCallback(async (asset: Asset) => {
    if (!activeSequence) return;
    const fps = activeSequence.format.fps;
    const durationFrames = asset.durationFrames ?? 150;
    const duration = fromSeconds(durationFrames / fps, 30000);
    const startTime = fromSeconds(0, 30000);
    const defaultTransform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0 };

    const videoTrack = activeSequence.tracks.find((t) => t.kind === 'video' && t.targeted);
    const audioTrack = activeSequence.tracks.find((t) => t.kind === 'audio' && t.targeted);

    if (asset.kind === 'video' && videoTrack) {
      const clipId = generateId('clip');
      const videoClip = {
        id: clipId, kind: 'video' as const, trackId: videoTrack.id, assetId: asset.id, name: asset.name,
        startTime, duration, sourceIn: fromSeconds(0, 30000), sourceOut: duration,
        transform: { ...defaultTransform }, keyframes: [], effects: [], masks: [],
        gain: 0, fadeIn: fromSeconds(0, 30000), fadeOut: fromSeconds(0, 30000), speed: 1, reverse: false, freeze: false, disabled: false,
      };
      dispatch(makeOp('clip.add', { sequenceId: activeSequence.id, clip: videoClip }), 'Add clip');
      if (asset.hasAudio && audioTrack) {
        const audioClipId = generateId('clip');
        const audioClip = { ...videoClip, id: audioClipId, kind: 'audio' as const, trackId: audioTrack.id, linkGroupId: clipId };
        dispatch(makeOp('clip.add', { sequenceId: activeSequence.id, clip: audioClip }), 'Add audio');
        dispatch(makeOp('clip.link', { sequenceId: activeSequence.id, clipIds: [clipId, audioClipId] }), 'Link A/V');
      }
    } else if (asset.kind === 'audio' && audioTrack) {
      const audioClip = {
        id: generateId('clip'), kind: 'audio' as const, trackId: audioTrack.id, assetId: asset.id, name: asset.name,
        startTime, duration, sourceIn: fromSeconds(0, 30000), sourceOut: duration,
        transform: { ...defaultTransform }, keyframes: [], effects: [], masks: [],
        gain: 0, fadeIn: fromSeconds(0, 30000), fadeOut: fromSeconds(0, 30000), speed: 1, reverse: false, freeze: false, disabled: false,
      };
      dispatch(makeOp('clip.add', { sequenceId: activeSequence.id, clip: audioClip }), 'Add audio clip');
    } else if (asset.kind === 'image' && videoTrack) {
      const imgClip = {
        id: generateId('clip'), kind: 'video' as const, trackId: videoTrack.id, assetId: asset.id, name: asset.name,
        startTime, duration: fromSeconds(5, 30000), sourceIn: fromSeconds(0, 30000), sourceOut: fromSeconds(5, 30000),
        transform: { ...defaultTransform }, keyframes: [], effects: [], masks: [],
        gain: 0, fadeIn: fromSeconds(0, 30000), fadeOut: fromSeconds(0, 30000), speed: 1, reverse: false, freeze: false, disabled: false,
      };
      dispatch(makeOp('clip.add', { sequenceId: activeSequence.id, clip: imgClip }), 'Add image');
    }
  }, [activeSequence, dispatch]);

  const selectedAsset = selectedAssetId ? project.assets[selectedAssetId] : null;

  const kindCounts = useMemo(() => {
    const all = Object.values(project.assets);
    return {
      all: all.length,
      video: all.filter((a) => a.kind === 'video').length,
      audio: all.filter((a) => a.kind === 'audio').length,
      image: all.filter((a) => a.kind === 'image').length,
      graphic: all.filter((a) => a.kind === 'graphic').length,
      'motion-bundle': all.filter((a) => a.kind === 'motion-bundle').length,
    };
  }, [project.assets]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', gap: '5px', alignItems: 'center' }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '3px 7px' }}>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
            <circle cx="4.5" cy="4.5" r="3.5" stroke="var(--color-subtle)" strokeWidth="1.2" />
            <path d="M7.5 7.5l2 2" stroke="var(--color-subtle)" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search media…"
            style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--color-fg)', fontFamily: 'var(--font-sans)', fontSize: '11px', flex: 1 }}
            aria-label="Search media bin"
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', color: 'var(--color-subtle)', cursor: 'pointer', padding: '0', fontSize: '11px' }} aria-label="Clear search">✕</button>
          )}
        </div>
        <button className="btn-ghost" onClick={handleImport}
          style={{ fontSize: '11px', padding: '3px 8px', color: 'var(--color-accent)', flexShrink: 0 }}
          title="Import media files" aria-label="Import media">
          + Import
        </button>
      </div>

      {/* Kind filter pills */}
      <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', gap: '2px', overflowX: 'auto' }}>
        {(['all', 'video', 'audio', 'image', 'graphic'] as KindFilter[]).map((k) => (
          <button key={k}
            onClick={() => setKindFilter(k)}
            style={{ background: kindFilter === k ? 'rgba(59,130,255,0.12)' : 'transparent', border: 'none', borderRadius: '3px', padding: '2px 6px', fontSize: '10px', color: kindFilter === k ? 'var(--color-accent)' : 'var(--color-subtle)', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
            aria-pressed={kindFilter === k}
          >
            {k}{k !== 'all' && kindCounts[k] > 0 ? ` (${kindCounts[k]})` : ''}
          </button>
        ))}
      </div>

      {/* Sort bar */}
      <div style={{ padding: '3px 8px', borderBottom: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', gap: '2px', alignItems: 'center' }}>
        {(['name', 'kind', 'duration', 'fileSize', 'ingestedAt'] as SortKey[]).map((key) => (
          <button key={key}
            onClick={() => { if (sortKey === key) setSortAsc(!sortAsc); else { setSortKey(key); setSortAsc(true); } }}
            style={{ background: sortKey === key ? 'rgba(59,130,255,0.1)' : 'transparent', border: 'none', borderRadius: '3px', padding: '2px 5px', fontSize: '9px', color: sortKey === key ? 'var(--color-accent)' : 'var(--color-subtle)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '2px' }}
            aria-label={`Sort by ${key}`}
          >
            {key === 'ingestedAt' ? 'date' : key === 'fileSize' ? 'size' : key}
            {sortKey === key && <span aria-hidden="true">{sortAsc ? '↑' : '↓'}</span>}
          </button>
        ))}
      </div>

      {/* Asset list */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {assets.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '24px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', marginBottom: '8px', opacity: 0.25 }} aria-hidden="true">▶</div>
            <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginBottom: '3px' }}>
              {search ? 'No results' : 'No media imported'}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--color-subtle)' }}>
              {search ? 'Try a different search' : 'Click + Import to add video, audio, or images'}
            </div>
          </div>
        ) : (
          assets.map((asset) => (
            <AssetRow
              key={asset.id}
              asset={asset}
              isSelected={selectedAssetId === asset.id}
              onSelect={() => setSelectedAssetId(selectedAssetId === asset.id ? null : asset.id)}
              onAddToTimeline={() => handleAddToTimeline(asset)}
              onRelink={() => handleRelink(asset.id)}
              onRemove={() => handleRemoveAsset(asset.id)}
              onDragStart={(e) => handleDragStart(e, asset)}
            />
          ))
        )}
      </div>

      {/* Selected asset metadata panel */}
      {selectedAsset && (
        <div style={{ flexShrink: 0, borderTop: '1px solid var(--color-border)', padding: '8px', background: 'var(--color-elevated)', maxHeight: '120px', overflowY: 'auto' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-fg)', marginBottom: '5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedAsset.name}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px' }}>
            {[
              { label: 'Kind', value: selectedAsset.kind },
              { label: 'Status', value: selectedAsset.caste },
              { label: 'Duration', value: formatDuration(selectedAsset.durationFrames, selectedAsset.fps) },
              { label: 'Size', value: formatFileSize(selectedAsset.fileSize) },
              ...(selectedAsset.width ? [{ label: 'Dimensions', value: `${selectedAsset.width}×${selectedAsset.height}` }] : []),
              ...(selectedAsset.fps ? [{ label: 'FPS', value: selectedAsset.fps.toFixed(2) }] : []),
              ...(selectedAsset.sampleRate ? [{ label: 'Sample Rate', value: `${selectedAsset.sampleRate} Hz` }] : []),
              ...(selectedAsset.channels ? [{ label: 'Channels', value: String(selectedAsset.channels) }] : []),
            ].map(({ label, value }) => value ? (
              <div key={label} style={{ display: 'flex', gap: '4px' }}>
                <span style={{ fontSize: '10px', color: 'var(--color-subtle)', flexShrink: 0 }}>{label}:</span>
                <span style={{ fontSize: '10px', color: 'var(--color-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
              </div>
            ) : null)}
          </div>
          {selectedAsset.caste === 'missing' && (
            <div style={{ marginTop: '6px', padding: '4px 8px', background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.2)', borderRadius: '4px', fontSize: '10px', color: 'var(--color-danger)' }}>
              Media file not found. <button onClick={() => handleRelink(selectedAsset.id)} style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontSize: '10px', padding: 0, textDecoration: 'underline' }}>Relink…</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface AssetRowProps {
  asset: Asset;
  isSelected: boolean;
  onSelect: () => void;
  onAddToTimeline: () => void;
  onRelink: () => void;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
}

function AssetRow({ asset, isSelected, onSelect, onAddToTimeline, onRelink, onRemove, onDragStart }: AssetRowProps) {
  const isMissing = asset.caste === 'missing' || asset.caste === 'failed';

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onSelect}
      onDoubleClick={onAddToTimeline}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '7px',
        padding: '5px 8px',
        borderBottom: '1px solid rgba(244,247,255,0.04)',
        cursor: 'grab',
        background: isSelected ? 'rgba(59,130,255,0.08)' : 'transparent',
        opacity: isMissing ? 0.6 : 1,
      }}
      title={`${asset.name} — double-click to add to timeline`}
    >
      {/* Kind icon */}
      <span style={{ fontSize: '13px', flexShrink: 0, opacity: 0.7, color: isMissing ? 'var(--color-danger)' : 'var(--color-muted)' }} aria-hidden="true">
        {isMissing ? '⚠' : (KIND_ICON[asset.kind] ?? '▶')}
      </span>

      {/* Name + meta */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '11px', color: isMissing ? 'var(--color-danger)' : 'var(--color-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
          {asset.name}
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '1px' }}>
          <span style={{ fontSize: '9px', color: 'var(--color-subtle)' }}>{asset.kind}</span>
          {asset.durationFrames && (
            <span style={{ fontSize: '9px', color: 'var(--color-subtle)', fontFamily: 'var(--font-mono)' }}>
              {formatDuration(asset.durationFrames, asset.fps)}
            </span>
          )}
          {asset.width && (
            <span style={{ fontSize: '9px', color: 'var(--color-subtle)', fontFamily: 'var(--font-mono)' }}>
              {asset.width}×{asset.height}
            </span>
          )}
          {asset.fileSize && (
            <span style={{ fontSize: '9px', color: 'var(--color-subtle)' }}>{formatFileSize(asset.fileSize)}</span>
          )}
        </div>
      </div>

      {/* Caste dot */}
      <div
        style={{ width: '6px', height: '6px', borderRadius: '50%', background: CASTE_COLOR[asset.caste] ?? 'var(--color-subtle)', flexShrink: 0 }}
        title={asset.caste}
        aria-label={`Status: ${asset.caste}`}
      />

      {/* Actions */}
      <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
        {isMissing ? (
          <button
            className="btn-icon"
            onClick={(e) => { e.stopPropagation(); onRelink(); }}
            style={{ fontSize: '9px', color: 'var(--color-accent)', padding: '2px 5px' }}
            title="Relink media file"
            aria-label="Relink"
          >Relink</button>
        ) : (
          <button
            className="btn-icon"
            onClick={(e) => { e.stopPropagation(); onAddToTimeline(); }}
            style={{ fontSize: '9px', color: 'var(--color-subtle)', padding: '2px 5px' }}
            title="Add to timeline"
            aria-label="Add to timeline"
          >+</button>
        )}
        <button
          className="btn-icon"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{ fontSize: '9px', color: 'var(--color-subtle)', padding: '2px 4px', opacity: 0.5 }}
          title="Remove from bin"
          aria-label="Remove asset"
        >✕</button>
      </div>
    </div>
  );
}
