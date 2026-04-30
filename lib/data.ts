import { cache } from 'react';
import { prisma } from '@/lib/db';
import { PAGE_SIZE } from '@/lib/constants';

export async function getChanges() {
  try {
    const changes = await prisma.change.findMany({
      where: {
        isMinorChange: false,
      },
      orderBy: { commitDate: 'desc' },
      take: PAGE_SIZE,
    });

    return changes.map(change => ({
      ...change,
      category: change.category as 'social' | 'ai',
      commitDate: change.commitDate.toISOString(),
      createdAt: change.createdAt.toISOString(),
    }));
  } catch (error) {
    return [];
  }
}

export async function getFilterOptions() {
  try {
    const services = await prisma.change.findMany({
      distinct: ['service'],
      select: { service: true },
      orderBy: { service: 'asc' },
    });

    const documentTypes = await prisma.change.findMany({
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

export const getChangeByCommitPrefix = cache(async (commitId: string) => {
  if (!COMMIT_PREFIX_RE.test(commitId)) return null;
  try {
    const change = await prisma.change.findFirst({
      where: {
        id: { startsWith: commitId },
      },
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
    const changes = await prisma.change.findMany({
      where: {
        isMinorChange: false,
        commitDate: { gte: target.commitDate },
      },
      orderBy: { commitDate: 'desc' },
    });

    return {
      target,
      changes: changes.map(change => ({
        ...change,
        category: change.category as 'social' | 'ai',
        commitDate: change.commitDate.toISOString(),
        createdAt: change.createdAt.toISOString(),
      })),
    };
  } catch (error) {
    return null;
  }
}
