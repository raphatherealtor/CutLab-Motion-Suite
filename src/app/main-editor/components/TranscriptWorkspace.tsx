'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { useEngine } from '@/engine/store';
import { makeOp } from '@/engine/operations';
import { fromSeconds, toSeconds, toTimecode } from '@/engine/time';
import type { TranscriptWord } from '@/engine/schema';
import { generateId } from '@/engine/schema';


// Attack guard: don't cut directly against consonant attacks
const ATTACK_GUARD_SECS = 0.04;
// Micro-padding: leave natural speech breath
const MICRO_PAD_SECS = 0.06;

export default function TranscriptWorkspace() {
  const engine = useEngine();
  const { project, activeSequence, dispatch, session, updateSession } = engine;
  const fps = activeSequence?.format.fps ?? 29.97;

  const [search, setSearch] = useState('');
  const [selectedWordIds, setSelectedWordIds] = useState<Set<string>>(new Set());
  const [speakerFilter, setSpeakerFilter] = useState<string>('all');
  const [showFillers, setShowFillers] = useState(true);
  const [showDeadAir, setShowDeadAir] = useState(true);

  // Gather all transcript words from all assets used in the active sequence
  const allWords = useMemo(() => {
    if (!activeSequence) return [];
    const words: (TranscriptWord & { assetId: string })[] = [];
    for (const clip of activeSequence.clips) {
      if (!clip.assetId) continue;
      const asset = project.assets[clip.assetId];
      if (!asset?.transcriptWords) continue;
      for (const w of asset.transcriptWords) {
        words.push({ ...w, assetId: clip.assetId });
      }
    }
    return words.sort((a, b) => toSeconds(a.startTime) - toSeconds(b.startTime));
  }, [activeSequence, project.assets]);

  const speakers = useMemo(() => {
    const s = new Set<string>();
    allWords.forEach((w) => { if (w.speaker) s.add(w.speaker); });
    return Array.from(s);
  }, [allWords]);

  const filteredWords = useMemo(() => {
    let list = allWords;
    if (speakerFilter !== 'all') list = list.filter((w) => w.speaker === speakerFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((w) => w.text.toLowerCase().includes(q) || w.speaker?.toLowerCase().includes(q));
    }
    return list;
  }, [allWords, search, speakerFilter]);

  const currentWordId = useMemo(() => {
    const t = session.playheadFrame / fps;
    const w = allWords.find((w) => toSeconds(w.startTime) <= t && toSeconds(w.endTime) > t);
    return w?.id ?? null;
  }, [allWords, session.playheadFrame, fps]);

  const handleWordClick = useCallback((word: TranscriptWord) => {
    const frame = Math.round(toSeconds(word.startTime) * fps);
    updateSession({ playheadFrame: frame, playing: false });
  }, [fps, updateSession]);

  const handleWordSelect = useCallback((wordId: string, e: React.MouseEvent) => {
    setSelectedWordIds((prev) => {
      const next = new Set(prev);
      if (e.shiftKey) {
        const ids = filteredWords.map((w) => w.id);
        const lastSelected = Array.from(prev).pop();
        if (lastSelected) {
          const fromIdx = ids.indexOf(lastSelected);
          const toIdx = ids.indexOf(wordId);
          const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
          for (let i = start; i <= end; i++) next.add(ids[i]);
        } else {
          next.add(wordId);
        }
      } else if (e.ctrlKey || e.metaKey) {
        if (next.has(wordId)) next.delete(wordId); else next.add(wordId);
      } else {
        next.clear();
        next.add(wordId);
      }
      return next;
    });
  }, [filteredWords]);

  const handleDeleteSelected = useCallback(() => {
    if (!activeSequence || selectedWordIds.size === 0) return;
    const ops = [];
    for (const wordId of selectedWordIds) {
      const word = allWords.find((w) => w.id === wordId);
      if (!word) continue;
      // Natural speech cut: attack guard + micro-padding
      const deleteStart = fromSeconds(Math.max(0, toSeconds(word.startTime) - MICRO_PAD_SECS + ATTACK_GUARD_SECS), 30000);
      const deleteEnd = fromSeconds(toSeconds(word.endTime) + MICRO_PAD_SECS - ATTACK_GUARD_SECS, 30000);
      ops.push(makeOp('timeline.rippleDeleteRange', { sequenceId: activeSequence.id, startTime: deleteStart, endTime: deleteEnd }));
    }
    if (ops.length > 0) {
      engine.dispatchBatch(ops, `Delete ${selectedWordIds.size} word(s)`);
      setSelectedWordIds(new Set());
    }
  }, [activeSequence, selectedWordIds, allWords, fps, engine]);

  const handleTightenSelection = useCallback(() => {
    if (!activeSequence || selectedWordIds.size < 2) return;
    const selected = allWords.filter((w) => selectedWordIds.has(w.id));
    if (selected.length < 2) return;
    const ops = [];
    for (let i = 0; i < selected.length - 1; i++) {
      const gapStart = fromSeconds(toSeconds(selected[i].endTime) + ATTACK_GUARD_SECS, 30000);
      const gapEnd = fromSeconds(toSeconds(selected[i + 1].startTime) - ATTACK_GUARD_SECS, 30000);
      if (toSeconds(gapEnd) > toSeconds(gapStart) + 0.05) {
        ops.push(makeOp('timeline.rippleDeleteRange', { sequenceId: activeSequence.id, startTime: gapStart, endTime: gapEnd }));
      }
    }
    if (ops.length > 0) engine.dispatchBatch(ops, 'Tighten selection');
  }, [activeSequence, selectedWordIds, allWords, engine]);

  const handleKeepSpeaker = useCallback((speaker: string) => {
    if (!activeSequence) return;
    const ops = [];
    let i = 0;
    while (i < allWords.length) {
      if (allWords[i].speaker !== speaker) {
        const start = fromSeconds(Math.max(0, toSeconds(allWords[i].startTime) - MICRO_PAD_SECS), 30000);
        let j = i;
        while (j < allWords.length && allWords[j].speaker !== speaker) j++;
        const end = fromSeconds(toSeconds(allWords[j > 0 ? j - 1 : i].endTime) + MICRO_PAD_SECS, 30000);
        ops.push(makeOp('timeline.rippleDeleteRange', { sequenceId: activeSequence.id, startTime: start, endTime: end }));
        i = j;
      } else {
        i++;
      }
    }
    if (ops.length > 0) engine.dispatchBatch(ops, `Keep speaker: ${speaker}`);
  }, [activeSequence, allWords, engine]);

  const handleGenerateCaptions = useCallback(() => {
    if (!activeSequence) return;
    const captionTrack = activeSequence.tracks.find((t) => t.kind === 'caption');
    if (!captionTrack) return;
    const ops = [];
    let i = 0;
    while (i < allWords.length) {
      const startWord = allWords[i];
      let endIdx = i;
      let charCount = 0;
      while (endIdx < allWords.length && charCount < 42) {
        charCount += allWords[endIdx].text.length + 1;
        endIdx++;
      }
      const endWord = allWords[endIdx - 1];
      const caption = {
        id: generateId('cap'),
        trackId: captionTrack.id,
        startTime: startWord.startTime,
        endTime: endWord.endTime,
        text: allWords.slice(i, endIdx).map((w) => w.text).join(' '),
        style: {},
        wordTimings: allWords.slice(i, endIdx).map((w) => ({
          wordId: w.id,
          startTime: w.startTime,
          endTime: w.endTime,
          semanticMetadata: {},
        })),
      };
      ops.push(makeOp('caption.upsert', { sequenceId: activeSequence.id, caption }));
      i = endIdx;
    }
    if (ops.length > 0) engine.dispatchBatch(ops, 'Generate captions');
  }, [activeSequence, allWords, engine]);

  const handleExportSRT = useCallback(() => {
    if (!activeSequence) return;
    const captions = activeSequence.captions ?? [];
    if (captions.length === 0) { alert('No captions to export. Generate captions first.'); return; }
    const fps = activeSequence.format.fps;
    const srt = captions.map((cap, i) => {
      const startSecs = toSeconds(cap.startTime);
      const endSecs = toSeconds(cap.endTime);
      const fmt = (s: number) => {
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.floor(s % 60);
        const ms = Math.round((s % 1) * 1000);
        return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
      };
      return `${i + 1}\n${fmt(startSecs)} --> ${fmt(endSecs)}\n${cap.text}\n`;
    }).join('\n');
    const blob = new Blob([srt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activeSequence, project.name]);

  const handleNextSpeaker = useCallback(() => {
    const t = session.playheadFrame / fps;
    const next = allWords.find((w) => {
      const prevWord = allWords[allWords.indexOf(w) - 1];
      return toSeconds(w.startTime) > t && w.speaker !== prevWord?.speaker;
    });
    if (next) updateSession({ playheadFrame: Math.round(toSeconds(next.startTime) * fps) });
  }, [allWords, session.playheadFrame, fps, updateSession]);

  if (allWords.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '24px', textAlign: 'center' }}>
        <div style={{ fontSize: '22px', marginBottom: '8px', opacity: 0.25 }} aria-hidden="true">💬</div>
        <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginBottom: '3px' }}>No transcript</div>
        <div style={{ fontSize: '11px', color: 'var(--color-subtle)', lineHeight: 1.5 }}>Import media with transcript data to enable word-level editing.</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', gap: '5px', alignItems: 'center' }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '3px 7px' }}>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search words…"
            style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--color-fg)', fontFamily: 'var(--font-sans)', fontSize: '11px', flex: 1 }}
            aria-label="Search transcript" />
        </div>
        {speakers.length > 0 && (
          <select value={speakerFilter} onChange={(e) => setSpeakerFilter(e.target.value)}
            style={{ fontSize: '10px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: '3px', color: 'var(--color-muted)', padding: '2px 4px' }}
            aria-label="Filter by speaker">
            <option value="all">All speakers</option>
            {speakers.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>

      {/* Action bar */}
      <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
        <button className="btn-ghost"
          onClick={handleDeleteSelected}
          disabled={selectedWordIds.size === 0}
          style={{ fontSize: '10px', padding: '2px 7px', color: selectedWordIds.size > 0 ? 'var(--color-danger)' : 'var(--color-subtle)', opacity: selectedWordIds.size > 0 ? 1 : 0.5 }}
          aria-label="Delete selected words">
          Delete ({selectedWordIds.size})
        </button>
        <button className="btn-ghost"
          onClick={handleTightenSelection}
          disabled={selectedWordIds.size < 2}
          style={{ fontSize: '10px', padding: '2px 7px', color: selectedWordIds.size >= 2 ? 'var(--color-accent)' : 'var(--color-subtle)', opacity: selectedWordIds.size >= 2 ? 1 : 0.5 }}
          aria-label="Tighten selected region">
          Tighten
        </button>
        {speakers.length > 0 && speakerFilter !== 'all' && (
          <button className="btn-ghost"
            onClick={() => handleKeepSpeaker(speakerFilter)}
            style={{ fontSize: '10px', padding: '2px 7px', color: 'var(--color-accent-3)' }}
            aria-label={`Keep only ${speakerFilter}`}>
            Keep {speakerFilter}
          </button>
        )}
        <button className="btn-ghost"
          onClick={handleNextSpeaker}
          style={{ fontSize: '10px', padding: '2px 7px', color: 'var(--color-subtle)' }}
          aria-label="Next speaker change">
          Next Speaker
        </button>
        <button className="btn-ghost"
          onClick={handleGenerateCaptions}
          style={{ fontSize: '10px', padding: '2px 7px', color: 'var(--color-accent)' }}
          aria-label="Generate captions from transcript">
          Captions
        </button>
        <button className="btn-ghost"
          onClick={handleExportSRT}
          style={{ fontSize: '10px', padding: '2px 7px', color: 'var(--color-subtle)' }}
          aria-label="Export SRT file">
          SRT
        </button>
      </div>

      {/* Highlight toggles */}
      <div style={{ padding: '3px 8px', borderBottom: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', gap: '6px', alignItems: 'center' }}>
        <button
          onClick={() => setShowFillers(!showFillers)}
          style={{ fontSize: '9px', padding: '1px 5px', borderRadius: '10px', background: showFillers ? 'rgba(251,191,36,0.15)' : 'transparent', border: `1px solid ${showFillers ? 'rgba(251,191,36,0.4)' : 'transparent'}`, color: showFillers ? 'rgba(251,191,36,0.9)' : 'var(--color-subtle)', cursor: 'pointer' }}
          aria-pressed={showFillers}
        >Fillers</button>
        <button
          onClick={() => setShowDeadAir(!showDeadAir)}
          style={{ fontSize: '9px', padding: '1px 5px', borderRadius: '10px', background: showDeadAir ? 'rgba(139,92,246,0.15)' : 'transparent', border: `1px solid ${showDeadAir ? 'rgba(139,92,246,0.3)' : 'transparent'}`, color: showDeadAir ? 'var(--color-accent-2)' : 'var(--color-subtle)', cursor: 'pointer' }}
          aria-pressed={showDeadAir}
        >Dead Air</button>
        <span style={{ fontSize: '9px', color: 'var(--color-subtle)', marginLeft: 'auto' }}>{filteredWords.length} words</span>
      </div>

      {/* Word flow */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px', lineHeight: 1.8 }}>
        {filteredWords.map((word) => {
          const isSelected = selectedWordIds.has(word.id);
          const isCurrent = word.id === currentWordId;
          const isFiller = word.isFiller && showFillers;
          const isDeadAir = word.isDeadAir && showDeadAir;

          return (
            <span
              key={word.id}
              onClick={(e) => { handleWordClick(word); handleWordSelect(word.id, e); }}
              style={{
                display: 'inline-block',
                margin: '1px 2px',
                padding: '1px 4px',
                borderRadius: '3px',
                fontSize: '12px',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                background: isSelected
                  ? 'rgba(59,130,255,0.25)'
                  : isCurrent
                  ? 'rgba(59,130,255,0.12)'
                  : isFiller
                  ? 'rgba(251,191,36,0.12)'
                  : isDeadAir
                  ? 'rgba(139,92,246,0.1)'
                  : 'transparent',
                color: isSelected
                  ? 'var(--color-accent)'
                  : isCurrent
                  ? 'var(--color-fg)'
                  : isFiller
                  ? 'rgba(251,191,36,0.8)'
                  : isDeadAir
                  ? 'var(--color-accent-2)'
                  : 'var(--color-muted)',
                border: isCurrent ? '1px solid rgba(59,130,255,0.3)' : '1px solid transparent',
                fontWeight: isCurrent ? 600 : 400,
                textDecoration: isFiller ? 'line-through' : 'none',
                opacity: word.confidence !== undefined && word.confidence < 0.5 ? 0.6 : 1,
                transition: 'background 80ms',
              }}
              title={`${word.speaker ? word.speaker + ' · ' : ''}${toTimecode(word.startTime, fps)} — ${toTimecode(word.endTime, fps)}${word.confidence !== undefined ? ` · ${Math.round(word.confidence * 100)}%` : ''}`}
              aria-label={`Word: ${word.text}`}
            >
              {word.text}
            </span>
          );
        })}
      </div>
    </div>
  );
}
