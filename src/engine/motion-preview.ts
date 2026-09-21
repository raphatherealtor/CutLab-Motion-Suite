/**
 * CutLab Motion Preview Transactions
 * Temporary Motion preview states that don't pollute Studio history.
 */

import type { MotionDocument } from './motion-document';
import { applyMotionTransaction } from './motion-document';
import type { ProjectData } from './schema';
import { resolveMotionDocument } from './motion-bridge';
import { makeOp } from './operations';
import type { OpEnvelope } from './operations';

export interface MotionPreviewState {
  documentId: string;
  previewDocument: MotionDocument;
  canonicalDocument: MotionDocument;
  description: string;
  previewOps: Array<{ documentId: string; type: string; payload: Record<string, unknown> }>;
  createdAt: number;
}

export class MotionPreviewManager {
  private previews = new Map<string, MotionPreviewState>();

  startPreview(
    project: ProjectData,
    documentId: string,
    ops: Array<{ documentId: string; type: string; payload: Record<string, unknown> }>,
    description: string
  ): MotionPreviewState | null {
    const canonical = resolveMotionDocument(project, documentId);
    if (!canonical) return null;

    // Apply ops via transaction
    const tx = { ops: ops as any, description };
    const previewDocument = applyMotionTransaction(canonical, tx);

    const state: MotionPreviewState = {
      documentId,
      previewDocument,
      canonicalDocument: canonical,
      description,
      previewOps: ops,
      createdAt: Date.now(),
    };

    this.previews.set(documentId, state);
    return state;
  }

  updatePreview(
    documentId: string,
    additionalOps: Array<{ documentId: string; type: string; payload: Record<string, unknown> }>
  ): MotionPreviewState | null {
    const existing = this.previews.get(documentId);
    if (!existing) return null;

    const allOps = [...existing.previewOps, ...additionalOps];
    const tx = { ops: allOps as any, description: existing.description };
    const previewDocument = applyMotionTransaction(existing.canonicalDocument, tx);

    const updated: MotionPreviewState = { ...existing, previewDocument, previewOps: allOps };
    this.previews.set(documentId, updated);
    return updated;
  }

  getPreviewDocument(documentId: string): MotionDocument | null {
    return this.previews.get(documentId)?.previewDocument ?? null;
  }

  hasPreview(documentId: string): boolean {
    return this.previews.has(documentId);
  }

  commitPreview(documentId: string): { ops: OpEnvelope[]; description: string } | null {
    const preview = this.previews.get(documentId);
    if (!preview) return null;

    const ops: OpEnvelope[] = [
      makeOp('motion.document.register' as any, { document: preview.previewDocument }, 'user'),
    ];

    this.previews.delete(documentId);
    return { ops, description: preview.description };
  }

  cancelPreview(documentId: string): MotionDocument | null {
    const preview = this.previews.get(documentId);
    if (!preview) return null;
    this.previews.delete(documentId);
    return preview.canonicalDocument;
  }

  clearAll(): void {
    this.previews.clear();
  }
}

export const motionPreviewManager = new MotionPreviewManager();
