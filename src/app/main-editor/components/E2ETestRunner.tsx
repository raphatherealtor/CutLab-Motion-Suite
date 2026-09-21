'use client';

import React, { useState, useCallback } from 'react';
import { runAllTests, summarizeResults, type TestResult, type TestSuiteResult } from '@/engine/e2e-tests';

interface E2ETestRunnerProps {
  onClose: () => void;
}

const STATUS_COLOR: Record<string, string> = {
  pass: '#34D399',
  fail: '#F87171',
  skip: '#94A3B8',
  warn: '#FBBF24',
};

const STATUS_ICON: Record<string, string> = {
  pass: '✓',
  fail: '✗',
  skip: '–',
  warn: '⚠',
};

export default function E2ETestRunner({ onClose }: E2ETestRunnerProps) {
  const [running, setRunning] = useState(false);
  const [suites, setSuites] = useState<TestSuiteResult[]>([]);
  const [liveLog, setLiveLog] = useState<TestResult[]>([]);
  const [summary, setSummary] = useState('');
  const [expandedSuites, setExpandedSuites] = useState<Set<string>>(new Set());

  const handleRun = useCallback(async () => {
    setRunning(true);
    setSuites([]);
    setLiveLog([]);
    setSummary('');

    const results = await runAllTests((result) => {
      setLiveLog(prev => [...prev.slice(-49), result]);
    });

    setSuites(results);
    setSummary(summarizeResults(results));
    setRunning(false);

    // Auto-expand failed suites
    const failedSuites = new Set(
      results.filter(s => s.failed > 0).map(s => s.suite)
    );
    setExpandedSuites(failedSuites);
  }, []);

  const toggleSuite = (suite: string) => {
    setExpandedSuites(prev => {
      const next = new Set(prev);
      if (next.has(suite)) next.delete(suite);
      else next.add(suite);
      return next;
    });
  };

  const totalPassed = suites.reduce((s, r) => s + r.passed, 0);
  const totalFailed = suites.reduce((s, r) => s + r.failed, 0);
  const totalTests = suites.reduce((s, r) => s + r.results.length, 0);

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(7,10,16,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}
      onClick={(e) => { if (e.target === e.currentTarget && !running) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="E2E Test Runner"
    >
      <div style={{ width: '680px', maxHeight: '85vh', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', boxShadow: '0 24px 64px rgba(0,0,0,0.8)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-fg)', flex: 1, letterSpacing: '0.02em' }}>
            CutLab — End-to-End Test Suite
          </span>
          {summary && !running && (
            <span style={{ fontSize: '11px', color: totalFailed > 0 ? '#F87171' : '#34D399', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {totalPassed}/{totalTests} passed
            </span>
          )}
          {!running && (
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--color-subtle)', cursor: 'pointer', fontSize: '16px', padding: '2px 6px' }} aria-label="Close">✕</button>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

          {/* Run button */}
          {!running && suites.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <div style={{ fontSize: '12px', color: 'var(--color-subtle)', marginBottom: '16px' }}>
                Runs 17 test suites covering schema, render plan, compositor, audio mix, WAV encoder, cancellation, progress events, motion integration, persistence, Motion clip add/edit/return, undo/redo, save/reload/relink, gain keyframe audio, export frame/audio comparison, and full workflow integration.
              </div>
              <button
                className="btn-primary"
                onClick={handleRun}
                style={{ fontSize: '13px', padding: '10px 28px' }}
                aria-label="Run all tests"
              >
                Run All Tests
              </button>
            </div>
          )}

          {/* Live log while running */}
          {running && (
            <div style={{ background: 'var(--color-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: '10px 12px' }}>
              <div style={{ fontSize: '10px', color: 'var(--color-subtle)', marginBottom: '8px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Running…</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '200px', overflowY: 'auto' }}>
                {liveLog.map((r, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' }}>
                    <span style={{ color: STATUS_COLOR[r.status], fontWeight: 700, width: '12px', flexShrink: 0 }}>{STATUS_ICON[r.status]}</span>
                    <span style={{ color: 'var(--color-subtle)', fontSize: '10px', flexShrink: 0 }}>{r.suite}</span>
                    <span style={{ color: 'var(--color-fg)' }}>{r.name}</span>
                    {r.durationMs > 0 && <span style={{ color: 'var(--color-subtle)', marginLeft: 'auto', flexShrink: 0 }}>{r.durationMs}ms</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Suite results */}
          {suites.length > 0 && (
            <>
              {/* Summary bar */}
              <div style={{ padding: '10px 14px', background: totalFailed > 0 ? 'rgba(248,113,113,0.08)' : 'rgba(52,211,153,0.08)', border: `1px solid ${totalFailed > 0 ? 'rgba(248,113,113,0.25)' : 'rgba(52,211,153,0.25)'}`, borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', gap: '16px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: totalFailed > 0 ? '#F87171' : '#34D399' }}>
                  {totalFailed > 0 ? `${totalFailed} test${totalFailed !== 1 ? 's' : ''} failed` : 'All tests passed'}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--color-muted)' }}>{summary}</span>
                <button
                  className="btn-ghost"
                  onClick={handleRun}
                  style={{ marginLeft: 'auto', fontSize: '11px', padding: '5px 12px' }}
                  aria-label="Re-run all tests"
                >
                  Re-run
                </button>
              </div>

              {/* Suite list */}
              {suites.map((suite) => (
                <div key={suite.suite} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                  {/* Suite header */}
                  <button
                    onClick={() => toggleSuite(suite.suite)}
                    style={{ width: '100%', background: 'var(--color-elevated)', border: 'none', padding: '9px 12px', display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', textAlign: 'left' }}
                    aria-expanded={expandedSuites.has(suite.suite)}
                  >
                    <span style={{ fontSize: '10px', color: 'var(--color-subtle)', transform: expandedSuites.has(suite.suite) ? 'rotate(90deg)' : 'none', transition: 'transform 150ms', display: 'inline-block' }}>▶</span>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-fg)', flex: 1 }}>{suite.suite}</span>
                    <span style={{ fontSize: '11px', color: '#34D399', fontVariantNumeric: 'tabular-nums' }}>{suite.passed}✓</span>
                    {suite.failed > 0 && <span style={{ fontSize: '11px', color: '#F87171', fontVariantNumeric: 'tabular-nums' }}>{suite.failed}✗</span>}
                    {suite.skipped > 0 && <span style={{ fontSize: '11px', color: '#94A3B8', fontVariantNumeric: 'tabular-nums' }}>{suite.skipped}–</span>}
                    <span style={{ fontSize: '10px', color: 'var(--color-subtle)', fontVariantNumeric: 'tabular-nums' }}>{suite.totalMs}ms</span>
                  </button>

                  {/* Test rows */}
                  {expandedSuites.has(suite.suite) && (
                    <div style={{ borderTop: '1px solid var(--color-border)' }}>
                      {suite.results.map((r, i) => (
                        <div key={i} style={{ padding: '7px 12px 7px 32px', borderBottom: i < suite.results.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                          <span style={{ color: STATUS_COLOR[r.status], fontWeight: 700, fontSize: '12px', flexShrink: 0, marginTop: '1px' }}>{STATUS_ICON[r.status]}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '11px', color: r.status === 'fail' ? '#F87171' : 'var(--color-fg)' }}>{r.name}</div>
                            {r.status !== 'pass' && r.message && (
                              <div style={{ fontSize: '10px', color: 'var(--color-subtle)', marginTop: '2px', fontFamily: 'monospace', wordBreak: 'break-word' }}>{r.message}</div>
                            )}
                          </div>
                          <span style={{ fontSize: '10px', color: 'var(--color-subtle)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{r.durationMs}ms</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        {(running || suites.length > 0) && (
          <div style={{ padding: '10px 20px', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
            <button
              className="btn-ghost"
              onClick={onClose}
              disabled={running}
              style={{ fontSize: '12px', padding: '7px 16px', opacity: running ? 0.5 : 1 }}
              aria-label="Close test runner"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
