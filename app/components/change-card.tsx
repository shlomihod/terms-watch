'use client';

import { useState } from 'react';
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
    diffContent: string;
    diffSummary: string | null;
  };
}

export function ChangeCard({ change }: ChangeCardProps) {
  const [showDiff, setShowDiff] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  // Extract commit ID (first 8 chars) from the change ID
  const commitId = change.id.substring(0, 8);

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
        <div className="flex items-center gap-5">
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
            onClick={() => setShowDiff(!showDiff)}
            className="flex items-center gap-1 text-gray-900 hover:text-black text-sm font-semibold transition-colors"
          >
            <span>View Diff</span>
            {showDiff ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </footer>
      
      {showDiff && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <DiffViewer diff={change.diffContent} />
        </div>
      )}
    </article>
  );
}