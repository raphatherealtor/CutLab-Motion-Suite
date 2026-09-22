/**
 * CutLab Persistence v2 — Section 18
 * Full schema version + migration seam.
 * All new structures persisted: transitions, precomps, cues, masks, etc.
 * Portable project-package boundary.
 */

import type { ProjectData } from './schema';
import { migrateProject, SCHEMA_VERSION } from './schema';
import { migrateDocumentBehaviors } from './motion-document';

const STORAGE_KEY = 'cutlab-project';
const RECENTS_KEY = 'cutlab-recents';
const MAX_RECENTS = 10;

export interface RecentEntry {
  id: string;
  name: string;
  updatedAt: number;
  /** Alias for updatedAt — for compatibility */
  lastModified?: number;
  revision: number;
  thumbnail?: string;
}

// ── Save / Load ───────────────────────────────────────────────

export async function saveProject(project: ProjectData): Promise<void> {
  try {
    const serialized = serializeProject(project);
    localStorage.setItem(`${STORAGE_KEY}-${project.id}`, serialized);
    localStorage.setItem(STORAGE_KEY, project.id); // last opened
    updateRecents(project);
  } catch (e) {
    console.error('[cutlab] save failed', e);
    throw e;
  }
}

export async function loadProject(id: string): Promise<ProjectData | null> {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}-${id}`);
    if (!raw) return null;
    return deserializeProject(raw);
  } catch (e) {
    console.error('[cutlab] load failed', e);
    return null;
  }
}

export async function loadLastProject(): Promise<ProjectData | null> {
  const lastId = localStorage.getItem(STORAGE_KEY);
  if (!lastId) return null;
  return loadProject(lastId);
}

export function listRecents(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RecentEntry[];
  } catch {
    return [];
  }
}

export function removeFromRecents(id: string): void {
  try {
    const recents = listRecents().filter((r) => r.id !== id);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
  } catch (e) {
    console.warn('[cutlab] removeFromRecents failed', e);
  }
}

export function pinRecent(id: string, pinned: boolean): void {
  try {
    const recents = listRecents().map((r) => r.id === id ? { ...r, pinned } : r);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
  } catch (e) {
    console.warn('[cutlab] pinRecent failed', e);
  }
}

/**
 * Save As — creates a new project with a new ID, preserving all content.
 * The source project is NOT modified.
 */
export async function saveProjectAs(project: ProjectData, newName: string): Promise<ProjectData> {
  const { generateId } = await import('./schema');
  const now = Date.now();
  const newProject: ProjectData = {
    ...project,
    id: generateId('proj'),
    name: newName,
    createdAt: now,
    updatedAt: now,
    revision: 0,
    opHistory: [],
    versions: [],
  };
  await saveProject(newProject);
  return newProject;
}

/**
 * Duplicate Project — same as Save As but auto-names as "Copy of X".
 */
export async function duplicateProject(project: ProjectData): Promise<ProjectData> {
  return saveProjectAs(project, `Copy of ${project.name}`);
}

function updateRecents(project: ProjectData): void {
  try {
    const recents = listRecents().filter((r) => r.id !== project.id);
    const entry: RecentEntry = {
      id: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
      revision: project.revision,
    };
    const updated = [entry, ...recents].slice(0, MAX_RECENTS);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn('[cutlab] recents update failed', e);
  }
}

// ── Serialization ─────────────────────────────────────────────

export function serializeProject(project: ProjectData): string {
  // Strip runtime-only fields before serialization
  const clean = stripRuntimeFields(project);
  return JSON.stringify(clean);
}

export function deserializeProject(json: string): ProjectData {
  const raw = JSON.parse(json) as Partial<ProjectData>;
  // Apply schema migration
  const migrated = migrateProject(raw);
  // Migrate legacy graphicParams._behaviors → canonical behaviors[] in all MotionDocuments
  const behaviorMigrated = migrateAllMotionDocumentBehaviors(migrated);
  // Runtime media handles (blob URLs) are never persisted — on reopen every asset
  // without a runtime handle is honestly MISSING until relinked. Stable asset IDs,
  // sourceRefs, transcripts, and MotionDocuments are preserved untouched.
  return markUnlinkedAssetsMissing(behaviorMigrated);
}

/**
 * Assets without a runtime URL have no playable media in this session.
 * Marks them missing (reversible per-asset via the canonical `asset.relink` op,
 * which restores runtimeUrl without replacing the asset id or MotionDocuments).
 */
function markUnlinkedAssetsMissing(project: ProjectData): ProjectData {
  let changed = false;
  const assets: ProjectData['assets'] = {};
  for (const [id, asset] of Object.entries(project.assets)) {
    if (!asset.runtimeUrl && asset.caste !== 'missing' && asset.caste !== 'stub' && asset.caste !== 'failed') {
      assets[id] = { ...asset, caste: 'missing' };
      changed = true;
    } else {
      assets[id] = asset;
    }
  }
  return changed ? { ...project, assets } : project;
}

/**
 * Migrate all MotionDocuments in a project from legacy behavior storage.
 * Converts graphicParams._behaviors → canonical behaviors[] on every object.
 * No-op if already canonical.
 */
function migrateAllMotionDocumentBehaviors(project: ProjectData): ProjectData {
  if (!project.motionDocuments || Object.keys(project.motionDocuments).length === 0) {
    return project;
  }
  let changed = false;
  const newDocs: typeof project.motionDocuments = {};
  for (const [id, doc] of Object.entries(project.motionDocuments)) {
    const migrated = migrateDocumentBehaviors(doc);
    newDocs[id] = migrated;
    if (migrated !== doc) changed = true;
  }
  if (!changed) return project;
  return { ...project, motionDocuments: newDocs };
}

function stripRuntimeFields(project: ProjectData): ProjectData {
  // Remove runtimeUrl from assets (not canonical identity)
  const cleanAssets = Object.fromEntries(
    Object.entries(project.assets).map(([id, asset]) => [
      id,
      { ...asset, runtimeUrl: undefined, waveformPeaks: undefined },
    ])
  );
  // MotionDocuments are fully serializable — stored as plain objects, no runtime fields to strip
  // Ensure motionDocuments is always present
  // Strip runtime-only signal currentValue (not persisted)
  const motionDocuments: typeof project.motionDocuments = {};
  for (const [docId, doc] of Object.entries(project.motionDocuments ?? {})) {
    const cleanSignals = Object.fromEntries(
      Object.entries(doc.signals ?? {}).map(([sigId, sig]) => [
        sigId,
        { ...sig, currentValue: undefined },
      ])
    );
    motionDocuments[docId] = { ...doc, signals: cleanSignals };
  }
  return { ...project, assets: cleanAssets, motionDocuments };
}

// ── Project package (zip boundary) ───────────────────────────

export interface ProjectPackage {
  manifest: ProjectPackageManifest;
  projectJson: string;
}

export interface ProjectPackageManifest {
  schemaVersion: number;
  projectId: string;
  projectName: string;
  createdAt: number;
  exportedAt: number;
  assetCount: number;
  /** Asset source refs — large media files are NOT included in package */
  assetRefs: Array<{
    id: string;
    name: string;
    sourceRef: string;
    caste: string;
  }>;
}

/**
 * Create a portable project package.
 * Distinguishes project metadata from large original media.
 * Media files are referenced by sourceRef but NOT embedded.
 */
export function createProjectPackage(project: ProjectData): ProjectPackage {
  const manifest: ProjectPackageManifest = {
    schemaVersion: SCHEMA_VERSION,
    projectId: project.id,
    projectName: project.name,
    createdAt: project.createdAt,
    exportedAt: Date.now(),
    assetCount: Object.keys(project.assets).length,
    assetRefs: Object.values(project.assets).map((a) => ({
      id: a.id,
      name: a.name,
      sourceRef: a.sourceRef,
      caste: a.caste,
    })),
  };

  return {
    manifest,
    projectJson: serializeProject(project),
  };
}

/**
 * Export project package as a downloadable JSON file.
 */
export function downloadProjectPackage(project: ProjectData): void {
  const pkg = createProjectPackage(project);
  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.name.replace(/[^a-z0-9]/gi, '_')}_v${project.revision}.cutlab`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Import a project package.
 */
export async function importProjectPackage(file: File): Promise<ProjectData | null> {
  try {
    const text = await file.text();
    const pkg = JSON.parse(text) as ProjectPackage;
    if (pkg.projectJson) {
      const project = deserializeProject(pkg.projectJson);
      // Mark all assets as missing (media not included in package)
      const assetsWithMissing = Object.fromEntries(
        Object.entries(project.assets).map(([id, asset]) => [
          id,
          { ...asset, caste: 'missing' as const, runtimeUrl: undefined },
        ])
      );
      return { ...project, assets: assetsWithMissing };
    }
    return null;
  } catch (e) {
    console.error('[cutlab] import failed', e);
    return null;
  }
}

// ── Auto-save state ───────────────────────────────────────────

export function getAutoSaveKey(projectId: string): string {
  return `${STORAGE_KEY}-autosave-${projectId}`;
}

export async function autoSave(project: ProjectData): Promise<void> {
  try {
    localStorage.setItem(getAutoSaveKey(project.id), serializeProject(project));
  } catch (e) {
    console.warn('[cutlab] auto-save failed', e);
  }
}

export async function loadAutoSave(projectId: string): Promise<ProjectData | null> {
  try {
    const raw = localStorage.getItem(getAutoSaveKey(projectId));
    if (!raw) return null;
    return deserializeProject(raw);
  } catch {
    return null;
  }
}
