import { diffWords, Change } from 'diff';

export interface LinePair {
  deletedLine: string;
  addedLine: string;
  deletedIndex: number;
  addedIndex: number;
}

export interface ChangeSegment {
  value: string;
  type: 'added' | 'removed' | 'unchanged';
  className: string;
}

/**
 * Detects adjacent line pairs that represent modifications (deletion followed by addition)
 */
export function detectLineChanges(lines: string[]): { pairs: LinePair[]; processedIndices: Set<number> } {
  const pairs: LinePair[] = [];
  const processedIndices = new Set<number>();

  for (let i = 0; i < lines.length - 1; i++) {
    if (processedIndices.has(i)) continue;

    const currentLine = lines[i];
    const nextLine = lines[i + 1];

    // Look for deletion followed by addition
    if (currentLine.startsWith('-') && nextLine.startsWith('+')) {
      pairs.push({
        deletedLine: currentLine.substring(1).trim(),
        addedLine: nextLine.substring(1).trim(),
        deletedIndex: i,
        addedIndex: i + 1
      });
      processedIndices.add(i);
      processedIndices.add(i + 1);
    }
  }

  return { pairs, processedIndices };
}

/**
 * Computes intra-line diff using word-level diffing
 */
export function computeIntraLineDiff(deletedLine: string, addedLine: string): Change[] {
  return diffWords(deletedLine, addedLine);
}

/**
 * Processes intra-line changes into data structure for rendering
 */
export function processIntraLineChanges(
  changes: Change[],
  isAddition: boolean
): ChangeSegment[] {
  return changes.map((change) => {
    if (change.added && isAddition) {
      // Added content in addition line
      return {
        value: change.value,
        type: 'added' as const,
        className: 'bg-green-100 rounded px-0.5'
      };
    } else if (change.removed && !isAddition) {
      // Removed content in deletion line
      return {
        value: change.value,
        type: 'removed' as const,
        className: 'bg-red-100 rounded px-0.5'
      };
    } else if (!change.added && !change.removed) {
      // Unchanged content
      return {
        value: change.value,
        type: 'unchanged' as const,
        className: ''
      };
    }
    return null;
  }).filter((segment): segment is ChangeSegment => segment !== null);
}