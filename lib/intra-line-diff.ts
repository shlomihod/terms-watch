import { diffWords, diffChars, Change } from 'diff';

export interface LinePair {
  deletedLine: string;
  addedLine: string;
  deletedIndex: number;
  addedIndex: number;
}

export interface IntraLineDiff {
  changes: Change[];
  useCharacterLevel: boolean;
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
 * Determines whether to use character-level diffing based on heuristics
 */
export function shouldUseCharacterLevel(deletedLine: string, addedLine: string): boolean {
  // Use character-level for very short lines
  if (deletedLine.length <= CHAR_LEVEL_LENGTH_THRESHOLD || addedLine.length <= CHAR_LEVEL_LENGTH_THRESHOLD) {
    return true;
  }

  // Use character-level if lines are very similar (small edit distance)
  const similarity = calculateSimilarity(deletedLine, addedLine);
  if (similarity > CHAR_LEVEL_SIMILARITY_THRESHOLD) {
    return true;
  }

  // Use character-level for single word changes
  const deletedWords = deletedLine.split(/\s+/);
  const addedWords = addedLine.split(/\s+/);
  if (deletedWords.length === 1 && addedWords.length === 1) {
    return true;
  }

  // Use character-level for punctuation/capitalization changes
  const normalizedDeleted = deletedLine.toLowerCase().replace(/[^\w\s]/g, '');
  const normalizedAdded = addedLine.toLowerCase().replace(/[^\w\s]/g, '');
  if (normalizedDeleted === normalizedAdded) {
    return true;
  }

  return false;
}

// Performance constants
const CHAR_LEVEL_LENGTH_THRESHOLD = 10;
const CHAR_LEVEL_SIMILARITY_THRESHOLD = 0.8;
const MAX_SIMILARITY_DISTANCE_RATIO = 0.5; // Stop calculating if distance > 50% of max length

/**
 * Calculates similarity between two strings using optimized Levenshtein distance
 */
function calculateSimilarity(str1: string, str2: string): number {
  const maxLength = Math.max(str1.length, str2.length);
  if (maxLength === 0) return 1;

  // For performance, set a maximum distance threshold
  // If distance exceeds this, we know similarity will be < 0.5
  const maxDistance = Math.floor(maxLength * MAX_SIMILARITY_DISTANCE_RATIO);

  const distance = levenshteinDistance(str1, str2, maxDistance);

  // If distance exceeded threshold, return low similarity
  if (distance > maxDistance) {
    return 0; // Very dissimilar
  }

  return (maxLength - distance) / maxLength;
}

// Cache for memoizing identical string pairs
const levenshteinCache = new Map<string, number>();

/**
 * Optimized Levenshtein distance calculation with early termination and reduced memory usage
 */
function levenshteinDistance(str1: string, str2: string, maxDistance?: number): number {
  // Early exit for identical strings
  if (str1 === str2) return 0;

  // Early exit if length difference exceeds maxDistance
  if (maxDistance && Math.abs(str1.length - str2.length) > maxDistance) {
    return maxDistance + 1;
  }

  // Use cache for performance
  const cacheKey = `${str1.length}:${str2.length}:${str1}:${str2}`;
  if (levenshteinCache.has(cacheKey)) {
    return levenshteinCache.get(cacheKey)!;
  }

  // Ensure str1 is the shorter string for better memory usage
  if (str1.length > str2.length) {
    const result = levenshteinDistance(str2, str1, maxDistance);
    levenshteinCache.set(cacheKey, result);
    return result;
  }

  // Use 1D array instead of matrix (O(min(n,m)) memory instead of O(n*m))
  let prevRow = Array.from({ length: str1.length + 1 }, (_, i) => i);

  for (let i = 1; i <= str2.length; i++) {
    let currentRow = [i];
    let minInRow = i; // Track minimum in current row for early termination

    for (let j = 1; j <= str1.length; j++) {
      const cost = str2[i - 1] === str1[j - 1] ? 0 : 1;
      const distance = Math.min(
        prevRow[j - 1] + cost,    // substitution
        prevRow[j] + 1,          // deletion
        currentRow[j - 1] + 1    // insertion
      );
      currentRow[j] = distance;
      minInRow = Math.min(minInRow, distance);
    }

    // Early termination if all distances in current row exceed maxDistance
    if (maxDistance && minInRow > maxDistance) {
      const result = maxDistance + 1;
      levenshteinCache.set(cacheKey, result);
      return result;
    }

    prevRow = currentRow;
  }

  const result = prevRow[str1.length];

  // Cache the result (but limit cache size to prevent memory leaks)
  if (levenshteinCache.size < 1000) {
    levenshteinCache.set(cacheKey, result);
  } else if (levenshteinCache.size === 1000) {
    // Clear cache when it gets too large
    levenshteinCache.clear();
  }

  return result;
}

/**
 * Computes intra-line diff using smart hybrid approach
 */
export function computeIntraLineDiff(deletedLine: string, addedLine: string): IntraLineDiff {
  const useCharacterLevel = shouldUseCharacterLevel(deletedLine, addedLine);

  let changes: Change[];
  if (useCharacterLevel) {
    changes = diffChars(deletedLine, addedLine);
  } else {
    changes = diffWords(deletedLine, addedLine);
  }

  return {
    changes,
    useCharacterLevel
  };
}

export interface ChangeSegment {
  value: string;
  type: 'added' | 'removed' | 'unchanged';
  className: string;
}

/**
 * Processes intra-line changes into data structure for rendering
 */
export function processIntraLineChanges(
  changes: Change[],
  isAddition: boolean,
  useCharacterLevel: boolean
): ChangeSegment[] {
  return changes.map((change) => {
    if (change.added && isAddition) {
      // Added content in addition line - use darker green
      const bgClass = useCharacterLevel ? 'bg-green-200' : 'bg-green-100';
      return {
        value: change.value,
        type: 'added' as const,
        className: `${bgClass} rounded px-0.5`
      };
    } else if (change.removed && !isAddition) {
      // Removed content in deletion line - use darker red
      const bgClass = useCharacterLevel ? 'bg-red-200' : 'bg-red-100';
      return {
        value: change.value,
        type: 'removed' as const,
        className: `${bgClass} rounded px-0.5`
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