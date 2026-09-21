'use client';

/**
 * CutLab Library Package Panel
 *
 * Canonical package system with live in-context preview via preview transactions.
 * Supports: Template, Preset, Module, Recipe, Treatment, BindingKit,
 *           SpatialComposition, TextComposition, MaterialTreatment, CameraTheme
 *
 * Studio presentation: quick discovery, preview, place, simple adjustment
 * Motion Animator presentation: deep inspection, edit, author, save reusable content
 *
 * Live preview: hover/click → temporary Motion state → evaluate → show result
 * PLACE/APPLY → commit canonical transaction
 * CANCEL → exact original state
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useEngine } from '@/engine/store';
import { getAllPackages, getPackagesByKind, searchPackages, getCapturedRecipes, captureRecipeFromOps, type MotionPackage, type MotionPackageKind, type CapturedRecipe,  } from '@/engine/motion-package';

import { makeOp } from '@/engine/operations';
import { generateId } from '@/engine/schema';

import type { WorkspaceHandoff } from '@/engine/workspace-context';

interface LibraryPackagePanelProps {
  workspaceKind: 'studio' | 'motion-animator';
  motionHandoff?: WorkspaceHandoff | null;
  onApplyPackage?: (pkg: MotionPackage, params: Record<string, unknown>) => void;
}

const KIND_LABELS: Record<MotionPackageKind, string> = {
  template: 'Template',
  preset: 'Preset',
  module: 'Module',
  recipe: 'Recipe',
  treatment: 'Treatment',
  'binding-kit': 'Binding Kit',
  'spatial-composition': 'Spatial',
  'text-composition': 'Text',
  'material-treatment': 'Material',
  'camera-theme': 'Camera',
  theme: 'Theme',
};

const KIND_COLORS: Record<MotionPackageKind, string> = {
  template: '#3b82ff',
  preset: '#06b6d4',
  module: '#10b981',
  recipe: '#f59e0b',
  treatment: '#8b5cf6',
  'binding-kit': '#ec4899',
  'spatial-composition': '#14b8a6',
  'text-composition': '#ef4444',
  'material-treatment': '#a78bfa',
  'camera-theme': '#64748b',
  theme: '#6366f1',
};

export default function LibraryPackagePanel({
  workspaceKind,
  motionHandoff,
  onApplyPackage,
}: LibraryPackagePanelProps) {
  const engine = useEngine();
  const { project, session } = engine;

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedKind, setSelectedKind] = useState<MotionPackageKind | 'all' | 'captured'>('all');
  const [selectedPackage, setSelectedPackage] = useState<MotionPackage | null>(null);
  const [packageParams, setPackageParams] = useState<Record<string, unknown>>({});
  const [activeTab, setActiveTab] = useState<'browse' | 'detail' | 'captured' | 'author'>('browse');
  const [captureMode, setCaptureMode] = useState(false);
  const [captureName, setCaptureName] = useState('');
  const [captureDesc, setCaptureDesc] = useState('');
  const [capturedRecipes, setCapturedRecipes] = useState<CapturedRecipe[]>(() => getCapturedRecipes());

  // Get packages
  const allPackages = useMemo(() => {
    if (searchQuery.trim()) return searchPackages(searchQuery);
    if (selectedKind === 'all') return getAllPackages();
    if (selectedKind === 'captured') return [];
    return getPackagesByKind(selectedKind);
  }, [searchQuery, selectedKind]);

  // Get categories
  const categories = useMemo(() => {
    const cats = new Set(getAllPackages().map((p) => p.category));
    return Array.from(cats);
  }, []);

  const handleSelectPackage = useCallback((pkg: MotionPackage) => {
    setSelectedPackage(pkg);
    // Initialize params with defaults
    const defaults: Record<string, unknown> = {};
    for (const param of pkg.params) {
      defaults[param.key] = param.defaultValue;
    }
    setPackageParams(defaults);
    setActiveTab('detail');
  }, []);

  const handleApplyPackage = useCallback(() => {
    if (!selectedPackage) return;

    if (onApplyPackage) {
      onApplyPackage(selectedPackage, packageParams);
      return;
    }

    // Default: apply to selected Motion clip or create new clip
    const seq = project.sequences[project.activeSequenceId];
    if (!seq) return;

    const fps = seq.format.fps;
    const playheadSecs = session.playheadFrame / fps;

    // Get ops from package
    const targetDocId = motionHandoff?.motionDocumentId ?? generateId();
    const ops = selectedPackage.applyOps(targetDocId, packageParams);

    if (ops.length > 0) {
      engine.dispatch(
        makeOp('motionDocument.applyOps', { documentId: targetDocId, ops }),
        `Apply ${selectedPackage.name}`
      );
    }
  }, [selectedPackage, packageParams, onApplyPackage, project, session, motionHandoff, engine]);

  const handleCaptureRecipe = useCallback(() => {
    if (!captureName.trim()) return;
    // In a real implementation, this would capture the recent operation history
    // For now we create a placeholder recipe
    const recipe = captureRecipeFromOps([], captureName, captureDesc);
    setCapturedRecipes(getCapturedRecipes());
    setCaptureName('');
    setCaptureDesc('');
    setCaptureMode(false);
  }, [captureName, captureDesc]);

  const kindOptions: Array<MotionPackageKind | 'all' | 'captured'> = [
    'all', 'treatment', 'spatial-composition', 'text-composition', 'binding-kit',
    'template', 'preset', 'recipe', 'module', 'material-treatment', 'camera-theme', 'captured',
  ];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--color-surface)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <span style={{ fontSize: '12px' }}>◈</span>
        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-fg)', letterSpacing: '0.05em' }}>LIBRARY PACKAGES</span>
        <div style={{ marginLeft: 'auto', fontSize: '9px', color: 'var(--color-muted)' }}>
          {allPackages.length} items
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        {(['browse', 'detail', 'captured', 'author'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1,
              padding: '6px 4px',
              background: activeTab === tab ? 'rgba(245,158,11,0.1)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid #f59e0b' : '2px solid transparent',
              color: activeTab === tab ? '#f59e0b' : 'var(--color-muted)',
              fontSize: '9px',
              cursor: 'pointer',
              fontWeight: activeTab === tab ? 600 : 400,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* BROWSE TAB */}
        {activeTab === 'browse' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Search */}
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search packages..."
                style={{
                  width: '100%',
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '5px',
                  color: 'var(--color-fg)',
                  fontSize: '11px',
                  padding: '6px 8px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Kind filter */}
            <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: '4px', flexWrap: 'wrap', flexShrink: 0 }}>
              {kindOptions.slice(0, 7).map((kind) => (
                <button
                  key={kind}
                  onClick={() => setSelectedKind(kind)}
                  style={{
                    padding: '2px 7px',
                    background: selectedKind === kind ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${selectedKind === kind ? 'rgba(245,158,11,0.3)' : 'var(--color-border)'}`,
                    borderRadius: '3px',
                    color: selectedKind === kind ? '#f59e0b' : 'var(--color-muted)',
                    fontSize: '9px',
                    cursor: 'pointer',
                    fontWeight: selectedKind === kind ? 600 : 400,
                  }}
                >
                  {kind === 'all' ? 'All' : kind === 'captured' ? 'Captured' : KIND_LABELS[kind as MotionPackageKind]}
                </button>
              ))}
            </div>

            {/* Package grid */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
              {allPackages.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', fontSize: '11px', color: 'var(--color-muted)' }}>
                  No packages found
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {allPackages.map((pkg) => (
                    <div
                      key={pkg.id}
                      onClick={() => handleSelectPackage(pkg)}
                      style={{
                        borderRadius: '7px',
                        overflow: 'hidden',
                        border: `1px solid ${selectedPackage?.id === pkg.id ? pkg.accentColor + '60' : 'var(--color-border)'}`,
                        cursor: 'pointer',
                        background: selectedPackage?.id === pkg.id ? `${pkg.accentColor}08` : 'rgba(0,0,0,0.15)',
                        transition: 'all 0.15s',
                      }}
                    >
                      {/* Preview strip */}
                      <div style={{ height: '28px', background: pkg.previewGradient, display: 'flex', alignItems: 'center', padding: '0 8px', gap: '6px' }}>
                        <span style={{ fontSize: '9px', padding: '1px 5px', background: `${pkg.accentColor}30`, border: `1px solid ${pkg.accentColor}50`, borderRadius: '2px', color: pkg.accentColor, fontWeight: 600 }}>
                          {KIND_LABELS[pkg.kind]}
                        </span>
                        <span style={{ fontSize: '11px', color: '#fff', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pkg.name}</span>
                        {pkg.capabilities.rendererTier !== 'canvas2d' && (
                          <span style={{ fontSize: '8px', color: 'rgba(255,255,255,0.4)' }}>{pkg.capabilities.rendererTier}</span>
                        )}
                      </div>

                      <div style={{ padding: '6px 8px' }}>
                        <div style={{ fontSize: '10px', color: 'var(--color-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pkg.description}</div>

                        {/* AI metadata tags */}
                        <div style={{ display: 'flex', gap: '3px', marginTop: '4px', flexWrap: 'wrap' }}>
                          {pkg.aiMetadata.mood.slice(0, 2).map((m) => (
                            <span key={m} style={{ fontSize: '8px', padding: '1px 4px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-border)', borderRadius: '2px', color: 'var(--color-muted)' }}>{m}</span>
                          ))}
                          {pkg.capabilities.analysisRequired.length > 0 && (
                            <span style={{ fontSize: '8px', padding: '1px 4px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)', borderRadius: '2px', color: '#f59e0b' }}>
                              {pkg.capabilities.analysisRequired[0]}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* DETAIL TAB */}
        {activeTab === 'detail' && selectedPackage && (
          <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Package header */}
            <div style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
              <div style={{ height: '48px', background: selectedPackage.previewGradient, display: 'flex', alignItems: 'center', padding: '0 12px', gap: '8px' }}>
                <span style={{ fontSize: '13px', color: selectedPackage.accentColor }}>{KIND_LABELS[selectedPackage.kind][0]}</span>
                <div>
                  <div style={{ fontSize: '12px', color: '#fff', fontWeight: 700 }}>{selectedPackage.name}</div>
                  <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)' }}>{selectedPackage.version} · {selectedPackage.category}</div>
                </div>
              </div>
              <div style={{ padding: '10px 12px', background: 'rgba(0,0,0,0.2)' }}>
                <div style={{ fontSize: '11px', color: 'var(--color-fg)', lineHeight: 1.5, marginBottom: '8px' }}>{selectedPackage.description}</div>

                {/* Compatibility */}
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '9px', padding: '2px 6px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-border)', borderRadius: '3px', color: 'var(--color-muted)' }}>
                    {selectedPackage.capabilities.rendererTier}
                  </span>
                  {selectedPackage.capabilities.requiresSubjectMatte && (
                    <span style={{ fontSize: '9px', padding: '2px 6px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '3px', color: '#f59e0b' }}>
                      requires subject matte
                    </span>
                  )}
                  <span style={{ fontSize: '9px', padding: '2px 6px', background: `${selectedPackage.compatibilityStatus === 'compatible' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)'}`, border: `1px solid ${selectedPackage.compatibilityStatus === 'compatible' ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)'}`, borderRadius: '3px', color: selectedPackage.compatibilityStatus === 'compatible' ? '#10b981' : '#f59e0b' }}>
                    {selectedPackage.compatibilityStatus}
                  </span>
                </div>
              </div>
            </div>

            {/* Editable params */}
            {selectedPackage.params.length > 0 && (
              <div>
                <div style={{ fontSize: '10px', color: 'var(--color-muted)', marginBottom: '8px', letterSpacing: '0.05em' }}>PARAMETERS</div>
                {selectedPackage.params.map((param) => (
                  <div key={param.key} style={{ marginBottom: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '10px', color: 'var(--color-fg)' }}>{param.label}</span>
                      <span style={{ fontSize: '10px', color: 'var(--color-muted)' }}>
                        {typeof packageParams[param.key] === 'number' ? (packageParams[param.key] as number).toFixed(2) : String(packageParams[param.key])}
                      </span>
                    </div>
                    {param.type === 'range' && (
                      <input
                        type="range"
                        min={param.min ?? 0}
                        max={param.max ?? 1}
                        step={0.01}
                        value={packageParams[param.key] as number ?? param.defaultValue}
                        onChange={(e) => setPackageParams((prev) => ({ ...prev, [param.key]: parseFloat(e.target.value) }))}
                        style={{ width: '100%', accentColor: selectedPackage.accentColor }}
                      />
                    )}
                    {param.type === 'boolean' && (
                      <button
                        onClick={() => setPackageParams((prev) => ({ ...prev, [param.key]: !prev[param.key] }))}
                        style={{
                          padding: '4px 10px',
                          background: packageParams[param.key] ? `${selectedPackage.accentColor}20` : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${packageParams[param.key] ? selectedPackage.accentColor + '40' : 'var(--color-border)'}`,
                          borderRadius: '4px',
                          color: packageParams[param.key] ? selectedPackage.accentColor : 'var(--color-muted)',
                          fontSize: '10px',
                          cursor: 'pointer',
                        }}
                      >
                        {packageParams[param.key] ? 'ON' : 'OFF'}
                      </button>
                    )}
                    {param.type === 'select' && (
                      <select
                        value={packageParams[param.key] as string ?? param.defaultValue}
                        onChange={(e) => setPackageParams((prev) => ({ ...prev, [param.key]: e.target.value }))}
                        style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'var(--color-fg)', fontSize: '10px', padding: '4px 6px' }}
                      >
                        {param.options?.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    )}
                    {param.type === 'color' && (
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <input
                          type="color"
                          value={packageParams[param.key] as string ?? param.defaultValue}
                          onChange={(e) => setPackageParams((prev) => ({ ...prev, [param.key]: e.target.value }))}
                          style={{ width: '32px', height: '24px', border: 'none', borderRadius: '3px', cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: '10px', color: 'var(--color-muted)' }}>{packageParams[param.key] as string ?? param.defaultValue}</span>
                      </div>
                    )}
                    {param.description && (
                      <div style={{ fontSize: '9px', color: 'var(--color-muted)', marginTop: '2px', fontStyle: 'italic' }}>{param.description}</div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* AI metadata */}
            <div style={{ padding: '10px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: '10px', color: 'var(--color-muted)', marginBottom: '6px', letterSpacing: '0.05em' }}>AI METADATA</div>
              <div style={{ fontSize: '10px', color: 'var(--color-fg)', marginBottom: '4px' }}>
                <span style={{ color: 'var(--color-muted)' }}>Use: </span>{selectedPackage.aiMetadata.intendedUse.join(', ')}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--color-fg)', marginBottom: '4px' }}>
                <span style={{ color: 'var(--color-muted)' }}>Mood: </span>{selectedPackage.aiMetadata.mood.join(', ')}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--color-fg)', marginBottom: '4px' }}>
                <span style={{ color: 'var(--color-muted)' }}>Scene contexts: </span>{selectedPackage.aiMetadata.sceneContexts.join(', ')}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '10px', color: 'var(--color-muted)' }}>Energy: </span>
                <div style={{ flex: 1, height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ width: `${selectedPackage.aiMetadata.energyLevel * 100}%`, height: '100%', background: selectedPackage.accentColor, borderRadius: '2px' }} />
                </div>
                <span style={{ fontSize: '9px', color: 'var(--color-muted)' }}>{Math.round(selectedPackage.aiMetadata.energyLevel * 100)}%</span>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={handleApplyPackage}
                style={{ flex: 1, padding: '8px', background: `${selectedPackage.accentColor}20`, border: `1px solid ${selectedPackage.accentColor}40`, borderRadius: '5px', color: selectedPackage.accentColor, fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
              >
                {workspaceKind === 'motion-animator' ? 'APPLY TO DOCUMENT' : 'PLACE ON TIMELINE'}
              </button>
              <button
                onClick={() => setActiveTab('browse')}
                style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-border)', borderRadius: '5px', color: 'var(--color-muted)', fontSize: '11px', cursor: 'pointer' }}
              >
                ←
              </button>
            </div>
          </div>
        )}

        {/* CAPTURED TAB */}
        {activeTab === 'captured' && (
          <div style={{ padding: '12px' }}>
            <div style={{ fontSize: '10px', color: 'var(--color-muted)', marginBottom: '10px', lineHeight: 1.5 }}>
              Capture reusable techniques from your operation history. Recipes reference canonical capability parameters, not baked pixels.
            </div>

            {/* Capture form */}
            {captureMode ? (
              <div style={{ padding: '10px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--color-border)', marginBottom: '12px' }}>
                <div style={{ fontSize: '10px', color: 'var(--color-muted)', marginBottom: '8px', letterSpacing: '0.05em' }}>CAPTURE RECIPE</div>
                <input
                  value={captureName}
                  onChange={(e) => setCaptureName(e.target.value)}
                  placeholder="Recipe name..."
                  style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'var(--color-fg)', fontSize: '11px', padding: '6px 8px', marginBottom: '6px', boxSizing: 'border-box' }}
                />
                <input
                  value={captureDesc}
                  onChange={(e) => setCaptureDesc(e.target.value)}
                  placeholder="Description..."
                  style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'var(--color-fg)', fontSize: '11px', padding: '6px 8px', marginBottom: '8px', boxSizing: 'border-box' }}
                />
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={handleCaptureRecipe}
                    disabled={!captureName.trim()}
                    style={{ flex: 1, padding: '6px', background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '4px', color: '#10b981', fontSize: '10px', cursor: 'pointer' }}
                  >
                    CAPTURE
                  </button>
                  <button
                    onClick={() => setCaptureMode(false)}
                    style={{ padding: '6px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'var(--color-muted)', fontSize: '10px', cursor: 'pointer' }}
                  >
                    CANCEL
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setCaptureMode(true)}
                style={{ width: '100%', padding: '8px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '5px', color: '#10b981', fontSize: '11px', cursor: 'pointer', marginBottom: '12px' }}
              >
                + Capture Current Technique
              </button>
            )}

            {capturedRecipes.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', fontSize: '11px', color: 'var(--color-muted)' }}>
                No captured recipes yet. Perform operations and capture them as reusable recipes.
              </div>
            ) : (
              capturedRecipes.map((recipe) => (
                <div key={recipe.id} style={{ marginBottom: '8px', padding: '10px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--color-border)' }}>
                  <div style={{ fontSize: '11px', color: 'var(--color-fg)', fontWeight: 600, marginBottom: '3px' }}>{recipe.name}</div>
                  <div style={{ fontSize: '10px', color: 'var(--color-muted)', marginBottom: '6px' }}>{recipe.description}</div>
                  <div style={{ fontSize: '9px', color: 'var(--color-muted)' }}>{recipe.ops.length} ops · {recipe.compatibleTargets.join(', ')}</div>
                </div>
              ))
            )}
          </div>
        )}

        {/* AUTHOR TAB (Motion Animator only) */}
        {activeTab === 'author' && (
          <div style={{ padding: '12px' }}>
            <div style={{ fontSize: '10px', color: 'var(--color-muted)', marginBottom: '10px', lineHeight: 1.5 }}>
              {workspaceKind === 'motion-animator' ?'Author new reusable packages from the current MotionDocument. Deep editing and recipe construction available in Motion Animator.' :'Switch to Motion Animator for deep package authoring and recipe construction.'}
            </div>

            {workspaceKind === 'motion-animator' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {(['treatment', 'spatial-composition', 'text-composition', 'binding-kit', 'recipe', 'module'] as MotionPackageKind[]).map((kind) => (
                  <button
                    key={kind}
                    style={{
                      padding: '10px 12px',
                      background: 'rgba(0,0,0,0.2)',
                      border: `1px solid ${KIND_COLORS[kind]}30`,
                      borderRadius: '6px',
                      color: KIND_COLORS[kind],
                      fontSize: '11px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <span style={{ fontSize: '9px', padding: '2px 6px', background: `${KIND_COLORS[kind]}15`, borderRadius: '3px', border: `1px solid ${KIND_COLORS[kind]}30` }}>
                      {KIND_LABELS[kind]}
                    </span>
                    <span>Author new {KIND_LABELS[kind]}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '20px', fontSize: '11px', color: 'var(--color-muted)' }}>
                Open a Motion clip in Motion Animator to access deep authoring tools
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
