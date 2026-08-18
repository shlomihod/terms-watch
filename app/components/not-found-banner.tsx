'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

// Rendered from the /change/[commitId] not-found boundary, which receives no
// route params — so the id is read from the URL after mount. Not usePathname:
// it returns null while the boundary server-renders, which would throw and
// bail the whole page out of SSR. The effect keeps server and first client
// render identical (no id), avoiding a hydration mismatch.
export function NotFoundBanner() {
  const [dismissed, setDismissed] = useState(false);
  const [shortId, setShortId] = useState('');

  useEffect(() => {
    setShortId(window.location.pathname.split('/change/')[1]?.slice(0, 8) ?? '');
  }, []);

  if (dismissed) return null;

  return (
    <div className="flex items-start gap-3 text-sm text-amber-900 bg-amber-50 border border-amber-200 p-3 rounded-lg mb-6">
      <p className="flex-1">
        We couldn&apos;t find the change{shortId && <> <code className="font-mono">{shortId}</code></>}. It may have been removed or the link is incorrect. Showing the latest changes instead.
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="text-amber-900 hover:text-amber-700 flex-shrink-0"
      >
        <X size={16} />
      </button>
    </div>
  );
}
