'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

export function NotFoundBanner({ commitId }: { commitId: string }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const shortId = commitId.slice(0, 8);

  return (
    <div className="flex items-start gap-3 text-sm text-amber-900 bg-amber-50 border border-amber-200 p-3 rounded-lg mb-6">
      <p className="flex-1">
        We couldn&apos;t find the change <code className="font-mono">{shortId}</code>. It may have been removed or the link is incorrect. Showing the latest changes instead.
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
