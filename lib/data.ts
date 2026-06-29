import { cache } from 'react';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { PAGE_SIZE } from '@/lib/constants';

// Projection for feed/list reads. Omits diffContent — by far the widest column
// (avg ~5.7KB, max ~181KB per row) — because lists only render the summary; the
// full diff loads on demand per card via /api/changes/[id]. Must cover every
// field ChangeCard reads except diffContent.
export const CHANGE_LIST_SELECT = {
  id: true,
  service: true,
  category: true,
  documentType: true,
  commitDate: true,
  commitUrl: true,
  diffSummary: true,
} satisfies Prisma.ChangeSelect;

export async function getChanges() {
  try {
    const changes = await prisma.change.findMany({
      where: {
        isMinorChange: false,
      },
      orderBy: { commitDate: 'desc' },
      take: PAGE_SIZE,
      select: CHANGE_LIST_SELECT,
    });

    return changes.map(change => ({
      ...change,
      category: change.category as 'social' | 'ai',
      commitDate: change.commitDate.toISOString(),
    }));
  } catch (error) {
    return [];
  }
}

export interface FilterOptionsFilters {
  category?: string;
  service?: string;
  documentType?: string;
}

// Services are scoped by category + documentType; document types by category +
// service. This lets each dropdown reflect what's still selectable given the
// other active filters. Called with no args for the unfiltered (full) lists.
export async function getFilterOptions(filters: FilterOptionsFilters = {}) {
  try {
    const { category, service, documentType } = filters;

    const servicesWhere: Record<string, unknown> = {};
    if (category && category !== 'all') servicesWhere.category = category;
    if (documentType) servicesWhere.documentType = documentType;

    const documentTypesWhere: Record<string, unknown> = {};
    if (category && category !== 'all') documentTypesWhere.category = category;
    if (service) documentTypesWhere.service = service;

    const services = await prisma.change.findMany({
      where: servicesWhere,
      distinct: ['service'],
      select: { service: true },
      orderBy: { service: 'asc' },
    });

    const documentTypes = await prisma.change.findMany({
      where: documentTypesWhere,
      distinct: ['documentType'],
      select: { documentType: true },
      orderBy: { documentType: 'asc' },
    });

    return {
      services: services.map(s => s.service),
      documentTypes: documentTypes.map(dt => dt.documentType),
    };
  } catch (error) {
    return { services: [], documentTypes: [] };
  }
}

// Commit IDs are always stored as the first 8 chars of a git SHA. Validating
// the prefix here keeps malformed/empty input from running open-ended
// startsWith scans, and matches the API route's contract.
const COMMIT_PREFIX_RE = /^[a-f0-9]{8}$/i;

// Callers read only metadata (page <title>/description and the commitDate
// anchor below), never the diff, so this uses the list projection.
export const getChangeByCommitPrefix = cache(async (commitId: string) => {
  if (!COMMIT_PREFIX_RE.test(commitId)) return null;
  try {
    const change = await prisma.change.findFirst({
      where: {
        id: { startsWith: commitId },
      },
      select: CHANGE_LIST_SELECT,
    });
    return change;
  } catch (error) {
    return null;
  }
});

export async function getChangesIncludingCommit(commitIdPrefix: string) {
  const target = await getChangeByCommitPrefix(commitIdPrefix);
  if (!target) return null;

  try {
    // The window spans every change newer than the target so the client can
    // scroll to it, so row count is unbounded by design. That stays cheap only
    // because the projection is metadata-only (each diff loads lazily per card);
    // keep diffContent out of it.
    const changes = await prisma.change.findMany({
      where: {
        isMinorChange: false,
        commitDate: { gte: target.commitDate },
      },
      orderBy: { commitDate: 'desc' },
      select: CHANGE_LIST_SELECT,
    });

    return {
      target,
      changes: changes.map(change => ({
        ...change,
        category: change.category as 'social' | 'ai',
        commitDate: change.commitDate.toISOString(),
      })),
    };
  } catch (error) {
    return null;
  }
}
