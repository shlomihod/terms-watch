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

export async function getChangeByCommitPrefix(commitId: string) {
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
}
