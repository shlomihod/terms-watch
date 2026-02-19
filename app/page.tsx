import { getChanges, getFilterOptions } from '@/lib/data';
import { HomeContent } from '@/app/components/home-content';

// Force dynamic rendering to always fetch fresh data
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs'; // Explicitly use Node.js runtime

export default async function Home() {
  const [changes, filterOptions] = await Promise.all([
    getChanges(),
    getFilterOptions(),
  ]);

  return (
    <HomeContent
      changes={changes}
      filterOptions={filterOptions}
    />
  );
}
