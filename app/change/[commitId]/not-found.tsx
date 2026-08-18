import { Metadata } from 'next';
import { getChanges, getFilterOptions } from '@/lib/data';
import { HomeContent } from '@/app/components/home-content';

// Metadata on a nested not-found file overrides the layout title, but that is
// undocumented — verified against Next 16.3.0 (resolve-metadata.js).
export const metadata: Metadata = {
  title: 'Change Not Found — Terms Watch',
};

// Served with a real HTTP 404 when the page calls notFound(); keeps the
// pre-404 UX of showing the latest feed with a "not found" banner.
export default async function ChangeNotFound() {
  const [changes, filterOptions] = await Promise.all([
    getChanges(),
    getFilterOptions(),
  ]);

  return (
    <HomeContent changes={changes} filterOptions={filterOptions} notFound />
  );
}
