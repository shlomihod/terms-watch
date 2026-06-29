'use client';

import { useState, useCallback } from 'react';
import { ChevronDown, ChevronUp, Bot, Link2 } from 'lucide-react';
import { format } from 'date-fns';
import { PlatformLogo } from './platform-logo';
import { DiffViewer } from './diff-viewer';
import { getChangeShareLink } from '@/lib/url-utils';

interface ChangeCardProps {
  change: {
    id: string;
    service: string;
    category: 'social' | 'ai';
    documentType: string;
    commitDate: string;
    commitUrl: string;
    // Absent in feed/list payloads — fetched lazily on first "View Diff".
    diffContent?: string;
    diffSummary: string | null;
  };
}

export function ChangeCard({ change }: ChangeCardProps) {
  const [showDiff, setShowDiff] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  // The diff is the widest column, so it isn't shipped with the list. Load it
  // on demand the first time the user expands this card, then keep it cached.
  const [diff, setDiff] = useState<string | null>(change.diffContent ?? null);
  const [diffStatus, setDiffStatus] = useState<'idle' | 'loading' | 'error'>('idle');

  // Extract commit ID (first 8 chars) from the change ID
  const commitId = change.id.substring(0, 8);

  const loadDiff = useCallback(async () => {
    if (diff !== null || diffStatus === 'loading') return;
    setDiffStatus('loading');
    try {
      // Fetch by the full, unique change.id — NOT the 8-char commitId prefix,
      // which is only the commit SHA and is shared by every file changed in the
      // same commit. Resolving the diff by the prefix could return a sibling
      // row's diff.
      const response = await fetch(`/api/changes/${encodeURIComponent(change.id)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setDiff(data.diffContent ?? '');
      setDiffStatus('idle');
    } catch {
      setDiffStatus('error');
    }
  }, [change.id, diff, diffStatus]);

  const handleToggleDiff = () => {
    const next = !showDiff;
    setShowDiff(next);
    if (next) loadDiff();
  };

  // Copy share link to clipboard
  const handleCopyLink = async () => {
    try {
      const shareUrl = getChangeShareLink(commitId);
      await navigator.clipboard.writeText(shareUrl);
      setCopyStatus('copied');

      // Reset status after 2 seconds
      setTimeout(() => {
        setCopyStatus('idle');
      }, 2000);
    } catch (error) {
      console.warn('Failed to copy link to clipboard:', error);
      setCopyStatus('error');

      // Reset status after 2 seconds
      setTimeout(() => {
        setCopyStatus('idle');
      }, 2000);
    }
  };

  return (
    <article id={commitId} className="border border-gray-200 rounded-lg p-6 hover:shadow-sm transition-shadow bg-white" style={{scrollMarginTop: '1rem'}}>
      <header className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <PlatformLogo service={change.service} size={20} />
          <h2 className="font-serif text-xl text-gray-900">{change.service}</h2>
        </div>
        <time className="text-gray-500 text-sm font-mono">
          {format(new Date(change.commitDate), 'MMM dd, yyyy')}
        </time>
      </header>
      
      <p className="text-gray-800 mb-4 leading-relaxed">
        {change.diffSummary || `${change.service} updated their ${change.documentType}.`}
      </p>
      
      <footer className="flex items-center justify-between">
        <div className="flex gap-2 items-center">
          <span 
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              change.category === 'ai' 
                ? 'bg-gray-900 text-white' 
                : 'bg-gray-800 text-white'
            }`}
          >
            {change.category === 'ai' ? 'Generative AI' : 'Social Media'}
          </span>
          <span className="border border-gray-400 text-gray-700 px-2 py-0.5 rounded-full text-xs">
            {change.documentType}
          </span>
          {change.diffSummary && (
            <span className="flex items-center gap-1 text-gray-500 text-xs">
              <Bot size={12} />
              <span>AI Summary</span>
            </span>
          )}
        </div>
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 sm:gap-5">
          <button
            onClick={handleCopyLink}
            className="flex items-center gap-1 text-gray-600 hover:text-gray-900 text-sm transition-colors"
            title="Copy link to this change"
          >
            <Link2 size={14} />
            <span>
              {copyStatus === 'copied' ? 'Copied!' : copyStatus === 'error' ? 'Failed' : 'Copy Link'}
            </span>
          </button>
          <a
            href={change.commitUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-600 hover:text-gray-900 text-sm transition-colors"
          >
            Source
          </a>
          <button
            onClick={handleToggleDiff}
            className="flex items-center gap-1 text-gray-900 hover:text-black text-sm font-semibold transition-colors"
          >
            <span>View Diff</span>
            {showDiff ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </footer>

      {showDiff && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          {diffStatus === 'loading' && (
            <div className="text-gray-500 text-sm py-2">Loading diff…</div>
          )}
          {diffStatus === 'error' && (
            <div className="text-gray-600 text-sm py-2">
              Failed to load diff.{' '}
              <button onClick={loadDiff} className="underline hover:text-gray-900">
                Retry
              </button>
            </div>
          )}
          {diff !== null && diffStatus !== 'loading' && <DiffViewer diff={diff} />}
        </div>
      )}
    </article>
  );
}