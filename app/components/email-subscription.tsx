'use client';

import { Mail } from 'lucide-react';

export function EmailSubscription() {
  return (
    <div className="bg-gray-50 rounded-lg p-6 mb-6">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="text-center sm:text-left">
          <h3 className="font-medium text-gray-900 mb-1">Never miss an update</h3>
          <p className="text-sm text-gray-600">Get a daily digest of terms changes delivered to your inbox (excluding minor updates)</p>
        </div>
        <div className="flex gap-3">
          <a
            href="https://follow.it/terms-watch?leanpub"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 bg-gray-900 text-white rounded-full font-medium text-sm hover:bg-gray-700 transition-colors"
            aria-label="Subscribe to daily email updates"
          >
            <Mail size={20} />
            <span>Get Daily Updates</span>
          </a>
          <a 
            href="/rss" 
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 bg-white text-gray-700 border border-gray-300 rounded-full font-medium text-sm hover:bg-gray-100 transition-colors"
            aria-label="RSS Feed"
          >
            RSS Feed
          </a>
        </div>
      </div>
    </div>
  );
}