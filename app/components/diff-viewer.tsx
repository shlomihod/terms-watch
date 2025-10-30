'use client';

import { useState } from 'react';
import { Eye, Columns } from 'lucide-react';
import {
  detectLineChanges,
  computeIntraLineDiff,
  processIntraLineChanges,
  type LinePair
} from '@/lib/intra-line-diff';

interface DiffViewerProps {
  diff: string;
}

type ViewMode = 'unified' | 'split';

interface DiffLineProps {
  line: string;
  index: number;
  linePairs: LinePair[];
  processedIndices: Set<number>;
}

function DiffLine({ line, index, linePairs, processedIndices }: DiffLineProps) {
  // Skip technical diff headers and git artifacts
  if (line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++')) {
    // Add a subtle separator for sections
    if (line.startsWith('@@')) {
      return (
        <div className="my-3 border-t border-gray-200 pt-3">
          <span className="text-xs text-gray-400 uppercase tracking-wide">Section Change</span>
        </div>
      );
    }
    return null; // Skip --- and +++ lines
  }

  // Skip empty lines that aren't meaningful
  if (!line.trim() && !line.startsWith(' ')) {
    return null;
  }

  // Find if this line is part of a modification pair
  const isPartOfPair = processedIndices.has(index);
  const linePair = linePairs.find(pair =>
    pair.deletedIndex === index || pair.addedIndex === index
  );

  // Style additions and deletions
  let className = 'text-gray-700 leading-relaxed';
  let prefix = '';

  if (line.startsWith('+')) {
    className = 'text-green-700 bg-green-50 px-2 py-0.5 rounded';
    prefix = '+ ';
  } else if (line.startsWith('-')) {
    className = 'text-red-700 bg-red-50 px-2 py-0.5 rounded';
    prefix = '− ';
  } else if (line.trim()) {
    className = 'text-gray-600 px-2';
  }

  // Remove the leading + or - from the display
  const displayLine = line.startsWith('+') || line.startsWith('-')
    ? line.substring(1)
    : line;

  if (!displayLine.trim()) return null;

  // If this line is part of a modification pair, apply intra-line highlighting
  if (isPartOfPair && linePair) {
    const isAddition = line.startsWith('+');
    const isDeletion = line.startsWith('-');

    if (isAddition || isDeletion) {
      const { changes, useCharacterLevel } = computeIntraLineDiff(
        linePair.deletedLine,
        linePair.addedLine
      );

      const changeSegments = processIntraLineChanges(changes, isAddition, useCharacterLevel);

      return (
        <div className={className}>
          {prefix && <span className="font-semibold">{prefix}</span>}
          {changeSegments.map((segment, segmentIndex) => (
            <span key={segmentIndex} className={segment.className}>
              {segment.value}
            </span>
          ))}
        </div>
      );
    }
  }

  // Regular line rendering without intra-line highlighting
  return (
    <div className={className}>
      {prefix && <span className="font-semibold">{prefix}</span>}
      {displayLine.trim()}
    </div>
  );
}

function UnifiedView({ lines }: { lines: string[] }) {
  const { pairs, processedIndices } = detectLineChanges(lines);

  return (
    <div className="space-y-1 text-sm font-mono">
      {lines.map((line, index) => (
        <DiffLine
          key={index}
          line={line}
          index={index}
          linePairs={pairs}
          processedIndices={processedIndices}
        />
      )).filter(Boolean)}
    </div>
  );
}

function SplitView({ lines }: { lines: string[] }) {
  const { pairs, processedIndices } = detectLineChanges(lines);

  // Build mapped structure with proper indices
  interface SplitLine {
    content: string | null;
    originalIndex: number | null;
    isSection?: boolean;
  }

  const leftLines: SplitLine[] = [];
  const rightLines: SplitLine[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Skip technical headers
    if (line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++')) {
      if (line.startsWith('@@')) {
        leftLines.push({ content: '@@SECTION@@', originalIndex: null, isSection: true });
        rightLines.push({ content: '@@SECTION@@', originalIndex: null, isSection: true });
      }
      i++;
      continue;
    }

    if (processedIndices.has(i)) {
      // This is part of a modification pair
      const pair = pairs.find(p => p.deletedIndex === i || p.addedIndex === i);
      if (pair && pair.deletedIndex === i) {
        // This is the deletion line, next should be addition
        leftLines.push({ content: lines[i], originalIndex: i });
        rightLines.push({ content: lines[i + 1], originalIndex: i + 1 });
        i += 2; // Skip both lines since we processed them as a pair
      } else if (pair && pair.addedIndex === i) {
        // This is the addition line of a pair, but we'll process it when we encounter the deletion line
        // This should rarely happen since pairs are detected as deletion followed by addition
        // Skip this line as it will be processed with its pair
        i++;
      } else {
        // Shouldn't happen, but defensive programming
        i++;
      }
    } else if (line.startsWith('-')) {
      // Pure deletion
      leftLines.push({ content: line, originalIndex: i });
      rightLines.push({ content: null, originalIndex: null });
      i++;
    } else if (line.startsWith('+')) {
      // Pure addition
      leftLines.push({ content: null, originalIndex: null });
      rightLines.push({ content: line, originalIndex: i });
      i++;
    } else {
      // Context line
      leftLines.push({ content: line, originalIndex: i });
      rightLines.push({ content: line, originalIndex: i });
      i++;
    }
  }

  // Ensure both arrays have the same length
  const maxLength = Math.max(leftLines.length, rightLines.length);
  while (leftLines.length < maxLength) {
    leftLines.push({ content: null, originalIndex: null });
  }
  while (rightLines.length < maxLength) {
    rightLines.push({ content: null, originalIndex: null });
  }

  return (
    <div className="text-sm font-mono">
      {/* Column headers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div className="text-xs font-bold text-gray-900 uppercase tracking-wide">
          Before
        </div>
        <div className="text-xs font-bold text-gray-900 uppercase tracking-wide">
          After
        </div>
      </div>

      {/* Content rows */}
      <div className="space-y-1">
        {leftLines.map((leftLine, index) => {
          const rightLine = rightLines[index];

          // Handle section separators (span full width)
          if (leftLine?.isSection) {
            return (
              <div key={index} className="w-full my-3 border-t border-gray-200 pt-3">
                <span className="text-xs text-gray-400 uppercase tracking-wide">Section Change</span>
              </div>
            );
          }

          // Regular content row with two columns
          return (
            <div key={index} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left column content */}
              <div>
                {leftLine?.content && (
                  <div className="md:hidden text-xs font-bold text-gray-900 mb-1 uppercase tracking-wide">
                    Before
                  </div>
                )}
                {leftLine?.content ? (
                  <DiffLine
                    line={leftLine.content}
                    index={leftLine.originalIndex ?? -1}
                    linePairs={pairs}
                    processedIndices={processedIndices}
                  />
                ) : (
                  <div className="h-6 hidden md:block" aria-hidden="true"></div> // Empty placeholder only on desktop
                )}
              </div>

              {/* Right column content */}
              <div>
                {rightLine?.content && (
                  <div className="md:hidden text-xs font-bold text-gray-900 mb-1 uppercase tracking-wide">
                    After
                  </div>
                )}
                {rightLine?.content ? (
                  <DiffLine
                    line={rightLine.content}
                    index={rightLine.originalIndex ?? -1}
                    linePairs={pairs}
                    processedIndices={processedIndices}
                  />
                ) : (
                  <div className="h-6 hidden md:block" aria-hidden="true"></div> // Empty placeholder only on desktop
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DiffViewer({ diff }: DiffViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('unified');

  if (!diff) {
    return (
      <div className="text-gray-500 text-sm p-4 bg-gray-50 rounded font-mono">
        No diff available for this change.
      </div>
    );
  }

  const lines = diff.split('\n').filter(line =>
    // Remove git artifacts
    !line.startsWith('\\ No newline at end of file')
  );

  return (
    <div className="bg-gray-50 rounded-lg overflow-hidden">
      {/* View toggle header */}
      <div className="flex items-center justify-between p-3 border-b border-gray-200 bg-white">
        <span
          id="diff-viewer-label"
          className="text-sm font-medium text-gray-700"
        >
          Diff Viewer
        </span>
        <div
          role="group"
          aria-labelledby="diff-viewer-label"
          aria-label="Choose diff view mode"
          className="flex rounded-md bg-gray-100 p-1"
        >
          <button
            onClick={() => setViewMode('unified')}
            aria-label="Switch to unified diff view"
            aria-pressed={viewMode === 'unified'}
            className={`flex items-center gap-2 px-3 py-1 text-xs font-medium rounded transition-colors ${
              viewMode === 'unified'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Eye size={12} aria-hidden="true" />
            Unified
          </button>
          <button
            onClick={() => setViewMode('split')}
            aria-label="Switch to split diff view"
            aria-pressed={viewMode === 'split'}
            className={`flex items-center gap-2 px-3 py-1 text-xs font-medium rounded transition-colors ${
              viewMode === 'split'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Columns size={12} aria-hidden="true" />
            Split
          </button>
        </div>
      </div>

      {/* Diff content */}
      <div className="p-4 overflow-x-auto">
        {viewMode === 'unified' ? (
          <UnifiedView lines={lines} />
        ) : (
          <SplitView lines={lines} />
        )}
      </div>
    </div>
  );
}