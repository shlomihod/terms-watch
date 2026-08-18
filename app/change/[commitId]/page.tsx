import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  getFilterOptions,
  getChangeByCommitPrefix,
  getChangesIncludingCommit,
} from '@/lib/data';
import { HomeContent } from '@/app/components/home-content';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

interface PageProps {
  params: Promise<{ commitId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { commitId } = await params;
  const change = await getChangeByCommitPrefix(commitId);

  if (!change) {
    notFound();
  }

  const title = `${change.service} updated their ${change.documentType} — Terms Watch`;
  const description = change.diffSummary || `${change.service} updated their ${change.documentType}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'article',
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
  };
}

export default async function ChangePage({ params }: PageProps) {
  const { commitId } = await params;
  const [result, filterOptions] = await Promise.all([
    getChangesIncludingCommit(commitId),
    getFilterOptions(),
  ]);

  if (!result) {
    notFound();
  }

  return (
    <HomeContent
      changes={result.changes}
      filterOptions={filterOptions}
      scrollToCommitId={commitId}
    />
  );
}
