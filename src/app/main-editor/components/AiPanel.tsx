'use client';

import React, { useState, useRef, useCallback, useMemo } from 'react';
import { useEngine } from '@/engine/store';
import { resolveCommand } from '@/engine/commands';
import { runSkill } from '@/engine/skills';

interface AiPanelProps {
  parkedOp: string | null;
  onParkOp: (op: string) => void;
  onConfirmParked: () => void;
  onDiscardParked: () => void;
}

type AiTab = 'command' | 'skills' | 'generate';

// ── Command catalog with categories and shortcut hints ──────────────────────
const COMMAND_CATALOG = [
  {
    category: 'Edit',
    commands: [
      { verb: 'split', hint: 'S', desc: 'Split clip(s) at playhead' },
      { verb: 'delete', hint: '⌫', desc: 'Delete selected clips' },
      { verb: 'ripple delete', hint: '⇧⌫', desc: 'Delete and close gap' },
      { verb: 'duplicate', hint: 'D', desc: 'Duplicate selected clips' },
      { verb: 'close gap', hint: 'W', desc: 'Close gap at playhead' },
      { verb: 'insert gap', hint: null, desc: 'Insert gap at playhead' },
      { verb: 'enable', hint: null, desc: 'Enable selected clips' },
      { verb: 'disable', hint: null, desc: 'Disable selected clips' },
    ],
  },
  {
    category: 'Media',
    commands: [
      { verb: 'relink', hint: null, desc: 'Relink 2+ selected clips' },
      { verb: 'unlink', hint: null, desc: 'Unlink A/V relationship' },
      { verb: 'insert', hint: ',', desc: 'Insert from Source Monitor' },
      { verb: 'overwrite', hint: '.', desc: 'Overwrite from Source Monitor' },
    ],
  },
  {
    category: 'Graphics',
    commands: [
      { verb: 'add title', hint: null, desc: 'Place title graphic at playhead' },
      { verb: 'add lower third', hint: null, desc: 'Place lower third at playhead' },
      { verb: 'add captions', hint: null, desc: 'Generate captions from transcript' },
    ],
  },
  {
    category: 'Transitions',
    commands: [
      { verb: 'cross dissolve', hint: '⌘D', desc: 'Add cross dissolve between clips' },
      { verb: 'fade audio', hint: null, desc: 'Add audio fade to selected clips' },
    ],
  },
  {
    category: 'Navigation',
    commands: [
      { verb: 'next marker', hint: '⇧↓', desc: 'Jump to next marker' },
      { verb: 'prev marker', hint: '⇧↑', desc: 'Jump to previous marker' },
      { verb: 'add marker', hint: 'M', desc: 'Add marker at playhead' },
    ],
  },
  {
    category: 'View',
    commands: [
      { verb: 'toggle guides', hint: 'G', desc: 'Show/hide alignment guides' },
      { verb: 'toggle safe areas', hint: '⇧S', desc: 'Show/hide safe area overlays' },
    ],
  },
  {
    category: 'Sequence',
    commands: [
      { verb: 'precompose', hint: '⌘⇧G', desc: 'Precompose selected clips' },
      { verb: 'freeze', hint: null, desc: 'Freeze frame at playhead' },
      { verb: 'speed 0.5x', hint: null, desc: 'Set clip speed to 50%' },
      { verb: 'speed 2x', hint: null, desc: 'Set clip speed to 200%' },
    ],
  },
];

// ── Skills with full metadata ────────────────────────────────────────────────
const SKILLS_CATALOG = [
  {
    category: 'Dialogue',
    skills: [
      {
        id: 'skill-remove-fillers',
        label: 'Cut Fillers',
        desc: 'Removes ums, uhs, and false starts from transcript',
        changes: 'Ripple-deletes filler word regions from timeline',
        alias: null,
      },
      {
        id: 'skill-remove-dead-air',
        label: 'Remove Dead Air',
        desc: 'Trims pauses longer than 0.8 seconds',
        changes: 'Ripple-deletes silence gaps between words',
        alias: null,
      },
      {
        id: 'skill-tighten',
        label: 'Tighten',
        desc: 'Applies both filler removal and dead air removal',
        changes: 'Combined ripple-delete pass on fillers + silence',
        alias: 'tighten',
      },
      {
        id: 'skill-normalize',
        label: 'Normalize Dialogue',
        desc: 'Sets dialogue clips toward broadcast level',
        changes: 'Sets gain on targeted audio clips (LUFS measurement deferred)',
        alias: null,
      },
      {
        id: 'skill-duck-music',
        label: 'Duck Music',
        desc: 'Reduces non-dialogue audio tracks by 18 dB',
        changes: 'Sets gain on non-targeted audio clips',
        alias: null,
      },
    ],
  },
  {
    category: 'Captions & Words',
    skills: [
      {
        id: 'skill-add-captions',
        label: 'Add Captions',
        desc: 'Generates caption lines from transcript words',
        changes: 'Creates caption items on the caption track',
        alias: 'add captions',
      },
      {
        id: 'skill-add-titles',
        label: 'Add Lower Thirds',
        desc: 'Places lower third graphics from transcript speakers',
        changes: 'Places graphic clips on the graphics track',
        alias: 'add lower third',
      },
    ],
  },
  {
    category: 'Workflow',
    skills: [
      {
        id: 'skill-social',
        label: 'Social 9:16',
        desc: 'Reframes sequence to 9:16 vertical format',
        changes: 'Sets sequence format to 1080×1920, scales video clips',
        alias: null,
      },
      {
        id: 'skill-hook',
        label: '15-Second Hook',
        desc: 'Extracts the strongest 15-second opener',
        changes: 'Trims sequence to first 15 seconds of content',
        alias: null,
      },
    ],
  },
  {
    category: 'Cleanup',
    skills: [
      {
        id: 'skill-dialogue-cleanup',
        label: 'Dialogue Cleanup',
        desc: 'Normalize + duck music + remove fillers in one pass',
        changes: 'Combines normalize, duck, and filler removal ops',
        alias: null,
      },
      {
        id: 'skill-talking-head',
        label: 'Talking Head Cleanup',
        desc: 'Full tighten + normalize + captions pass',
        changes: 'Tighten + normalize + duck + add captions',
        alias: null,
      },
    ],
  },
];

export default function AiPanel({
  parkedOp,
  onParkOp,
  onConfirmParked,
  onDiscardParked,
}: AiPanelProps) {
  const engine = useEngine();
  const [tab, setTab] = useState<AiTab>('command');
  const [commandValue, setCommandValue] = useState('');
  const [running, setRunning] = useState<string | null>(null);
  const [commandHistory, setCommandHistory] = useState<Array<{ id: string; text: string; result: string; ago: string }>>([]);
  const [cmdSearch, setCmdSearch] = useState('');
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredCommands = useMemo(() => {
    if (!cmdSearch.trim()) return COMMAND_CATALOG;
    const q = cmdSearch.toLowerCase();
    return COMMAND_CATALOG.map((cat) => ({
      ...cat,
      commands: cat.commands.filter(
        (c) => c.verb.includes(q) || c.desc.toLowerCase().includes(q)
      ),
    })).filter((cat) => cat.commands.length > 0);
  }, [cmdSearch]);

  const handleCommand = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const input = commandValue.trim();
    if (!input) return;

    const result = resolveCommand(
      input,
      engine.project,
      engine.session.playheadFrame,
      Array.from(engine.session.selectedClipIds)
    );

    const histEntry = {
      id: `cmd-${Date.now()}`,
      text: input,
      result: result.recognized ? 'ok' : 'unknown',
      ago: 'just now',
    };
    setCommandHistory((prev) => [histEntry, ...prev.slice(0, 9)]);
    setCommandValue('');

    if (!result.recognized) return;

    if (result.requiresConfirm || result.ops.length === 0) {
      engine.parkOps(result.ops, result.description);
    } else {
      engine.dispatchBatch(result.ops, result.description);
    }
  }, [commandValue, engine]);

  const handleSkill = useCallback((skillId: string, label: string) => {
    setRunning(skillId);
    setTimeout(() => {
      const result = runSkill(skillId, engine.project);
      setRunning(null);
      if (result.ops.length > 0) {
        engine.parkOps(result.ops, `${label} — ${result.editCount} ops proposed`);
      } else {
        engine.parkOps([], `${label}: ${result.description}`);
      }
    }, 200);
  }, [engine]);

  const handleCatalogCommand = useCallback((verb: string) => {
    setCommandValue(verb);
    inputRef.current?.focus();
  }, []);

  return (
    <div style={{
      width: '288px',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: 'var(--color-surface)',
      borderRight: '1px solid var(--color-border)',
      overflow: 'hidden',
    }}>
      {/* Panel header */}
      <div style={{ padding: '8px 10px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: '3px', marginBottom: '8px', alignItems: 'center' }}>
          <button
            className={`tab-pill${tab === 'command' ? ' active' : ''}`}
            onClick={() => setTab('command')}
            aria-pressed={tab === 'command'}
            title="Command palette — type or click to run editor commands"
          >
            Command
          </button>
          <button
            className={`tab-pill${tab === 'skills' ? ' active' : ''}`}
            onClick={() => setTab('skills')}
            aria-pressed={tab === 'skills'}
            title="Skills — AI-powered editing recipes"
          >
            Skills
          </button>
          <button
            className={`tab-pill${tab === 'generate' ? ' active' : ''}`}
            onClick={() => setTab('generate')}
            aria-pressed={tab === 'generate'}
            title="Generate — describe edits in natural language"
          >
            Generate
          </button>
          <div style={{ flex: 1 }} />
          <span className="status-jewel jewel-ok" aria-hidden="true" title="Engine ready" />
        </div>
      </div>

      {/* Parked confirm banner */}
      {parkedOp && (
        <div style={{
          margin: '0 10px 8px',
          background: 'rgba(139,92,246,0.1)',
          border: '1px solid rgba(139,92,246,0.35)',
          borderRadius: 'var(--radius)',
          padding: '10px 12px',
          flexShrink: 0,
        }}>
          <div style={{ fontSize: '11px', color: 'var(--color-muted)', marginBottom: '6px', lineHeight: 1.5 }}>
            {parkedOp}
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              className="parked-confirm"
              onClick={onConfirmParked}
              style={{
                flex: 1,
                background: 'rgba(139,92,246,0.25)',
                border: '1px solid rgba(139,92,246,0.5)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-fg)',
                fontSize: '12px',
                fontWeight: 600,
                padding: '6px 0',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
              }}
              aria-label="Apply proposed operations"
            >
              Apply
            </button>
            <button
              onClick={onDiscardParked}
              style={{
                background: 'transparent',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-muted)',
                fontSize: '12px',
                fontWeight: 500,
                padding: '6px 12px',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
              }}
              aria-label="Discard proposed operations"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>

        {/* ── COMMAND TAB ── */}
        {tab === 'command' && (
          <div style={{ padding: '0 10px 16px' }}>
            {/* Command input */}
            <form onSubmit={handleCommand} style={{ marginBottom: '10px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'var(--color-well)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius)',
                  padding: '6px 10px',
                }}
                onClick={() => inputRef.current?.focus()}
              >
                <span style={{ fontSize: '12px', color: 'var(--color-accent)', fontFamily: 'var(--font-mono)', flexShrink: 0 }} aria-hidden="true">&gt;</span>
                <input
                  ref={inputRef}
                  type="text"
                  value={commandValue}
                  onChange={(e) => setCommandValue(e.target.value)}
                  placeholder="split, tighten, cross dissolve…"
                  className="command-input"
                  aria-label="CutLab command input"
                  autoComplete="off"
                  spellCheck={false}
                />
                {commandValue && (
                  <button
                    type="submit"
                    style={{
                      background: 'rgba(59,130,255,0.2)',
                      border: '1px solid rgba(59,130,255,0.4)',
                      borderRadius: '3px',
                      padding: '2px 6px',
                      fontSize: '10px',
                      color: 'var(--color-accent)',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-mono)',
                      flexShrink: 0,
                    }}
                    aria-label="Submit command"
                  >
                    ↵
                  </button>
                )}
              </div>
            </form>

            {/* Command search */}
            <div style={{ marginBottom: '10px' }}>
              <input
                type="search"
                value={cmdSearch}
                onChange={(e) => setCmdSearch(e.target.value)}
                placeholder="Search commands…"
                style={{
                  width: '100%',
                  background: 'var(--color-well)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '5px 8px',
                  fontSize: '11px',
                  color: 'var(--color-fg)',
                  fontFamily: 'var(--font-sans)',
                  outline: 'none',
                }}
                aria-label="Search command catalog"
              />
            </div>

            {/* Command history */}
            {commandHistory.length > 0 && !cmdSearch && (
              <div style={{ marginBottom: '12px' }}>
                <div className="section-header-label" style={{ marginBottom: '5px', paddingLeft: '2px' }}>Recent</div>
                <div style={{ background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                  {commandHistory.slice(0, 5).map((cmd) => (
                    <button
                      key={cmd.id}
                      onClick={() => { setCommandValue(cmd.text); inputRef.current?.focus(); }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '5px 10px',
                        borderBottom: '1px solid var(--color-border)',
                        width: '100%',
                        background: 'transparent',
                        border: 'none',
                        borderBottom: '1px solid var(--color-border)',
                        cursor: 'pointer',
                        textAlign: 'left',
                      } as React.CSSProperties}
                      title="Click to re-run"
                    >
                      <span style={{ fontSize: '10px', color: cmd.result === 'ok' ? 'var(--color-success)' : 'var(--color-danger)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                        {cmd.result === 'ok' ? '✓' : '?'}
                      </span>
                      <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--color-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cmd.text}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Command catalog */}
            {filteredCommands.map((cat) => (
              <div key={cat.category} style={{ marginBottom: '12px' }}>
                <div className="section-header-label" style={{ marginBottom: '5px', paddingLeft: '2px' }}>{cat.category}</div>
                <div style={{ background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                  {cat.commands.map((cmd, i) => (
                    <button
                      key={cmd.verb}
                      onClick={() => handleCatalogCommand(cmd.verb)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '6px 10px',
                        width: '100%',
                        background: 'transparent',
                        border: 'none',
                        borderBottom: i < cat.commands.length - 1 ? '1px solid var(--color-border)' : 'none',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'background 100ms',
                      } as React.CSSProperties}
                      title={cmd.desc}
                    >
                      <span style={{ flex: 1, fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--color-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cmd.verb}
                      </span>
                      {cmd.hint && (
                        <kbd style={{
                          fontSize: '9px',
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--color-subtle)',
                          background: 'rgba(244,247,255,0.06)',
                          border: '1px solid var(--color-border)',
                          borderRadius: '3px',
                          padding: '1px 4px',
                          flexShrink: 0,
                        }}>
                          {cmd.hint}
                        </kbd>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {filteredCommands.length === 0 && (
              <div style={{ padding: '16px', textAlign: 'center', fontSize: '12px', color: 'var(--color-muted)' }}>
                No commands match "{cmdSearch}"
              </div>
            )}
          </div>
        )}

        {/* ── SKILLS TAB ── */}
        {tab === 'skills' && (
          <div style={{ padding: '0 10px 16px' }}>
            <div style={{ fontSize: '11px', color: 'var(--color-subtle)', lineHeight: 1.5, marginBottom: '12px', padding: '8px 10px', background: 'rgba(59,130,255,0.05)', border: '1px solid rgba(59,130,255,0.12)', borderRadius: 'var(--radius-sm)' }}>
              Skills inspect real project state and propose canonical ops. Review before applying.
            </div>
            {SKILLS_CATALOG.map((cat) => (
              <div key={cat.category} style={{ marginBottom: '14px' }}>
                <div className="section-header-label" style={{ marginBottom: '6px', paddingLeft: '2px' }}>{cat.category}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {cat.skills.map((skill) => (
                    <div key={skill.id} style={{
                      background: 'var(--color-well)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      overflow: 'hidden',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 10px' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-fg)', marginBottom: '1px' }}>
                            {skill.label}
                          </div>
                          <div style={{ fontSize: '10px', color: 'var(--color-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {skill.desc}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                          <button
                            onClick={() => setExpandedSkill(expandedSkill === skill.id ? null : skill.id)}
                            style={{
                              background: 'transparent',
                              border: '1px solid var(--color-border)',
                              borderRadius: '3px',
                              padding: '3px 6px',
                              fontSize: '10px',
                              color: 'var(--color-subtle)',
                              cursor: 'pointer',
                              fontFamily: 'var(--font-sans)',
                            }}
                            aria-label={`${expandedSkill === skill.id ? 'Hide' : 'Show'} details for ${skill.label}`}
                            title="Show what this skill changes"
                          >
                            {expandedSkill === skill.id ? '▲' : '▼'}
                          </button>
                          <button
                            className="skill-chip"
                            onClick={() => handleSkill(skill.id, skill.label)}
                            disabled={running === skill.id}
                            style={{
                              opacity: running === skill.id ? 0.6 : 1,
                              fontSize: '11px',
                              padding: '3px 10px',
                            }}
                            aria-label={`Run skill: ${skill.label}`}
                          >
                            {running === skill.id ? '…' : 'Run'}
                          </button>
                        </div>
                      </div>
                      {expandedSkill === skill.id && (
                        <div style={{
                          padding: '6px 10px 8px',
                          borderTop: '1px solid var(--color-border)',
                          background: 'rgba(244,247,255,0.02)',
                        }}>
                          <div style={{ fontSize: '10px', color: 'var(--color-muted)', lineHeight: 1.5, marginBottom: skill.alias ? '5px' : 0 }}>
                            <span style={{ color: 'var(--color-subtle)', fontWeight: 600 }}>Changes: </span>
                            {skill.changes}
                          </div>
                          {skill.alias && (
                            <div style={{ fontSize: '10px', color: 'var(--color-subtle)', marginTop: '3px' }}>
                              <span style={{ fontWeight: 600 }}>Command alias: </span>
                              <kbd style={{
                                fontFamily: 'var(--font-mono)',
                                background: 'rgba(244,247,255,0.06)',
                                border: '1px solid var(--color-border)',
                                borderRadius: '3px',
                                padding: '1px 4px',
                                fontSize: '9px',
                              }}>
                                {skill.alias}
                              </kbd>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── GENERATE TAB ── */}
        {tab === 'generate' && (
          <div style={{ padding: '12px 10px' }}>
            <div style={{ fontSize: '12px', color: 'var(--color-muted)', lineHeight: 1.6, marginBottom: '12px' }}>
              Describe what you want to create. The agent will propose canonical ops for your review.
            </div>
            <div style={{
              background: 'var(--color-well)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius)',
              padding: '8px 10px',
            }}>
              <textarea
                placeholder="e.g. Add a lower third for the speaker at 0:14, then duck the music…"
                style={{
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--color-fg)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  width: '100%',
                  resize: 'none',
                  minHeight: '80px',
                } as React.CSSProperties}
                aria-label="AI generation prompt"
              />
            </div>
            <div style={{ marginTop: '8px', fontSize: '10px', color: 'var(--color-subtle)' }}>
              All proposed edits land on the real timeline. Undo works normally.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
