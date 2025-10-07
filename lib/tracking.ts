import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';

export interface ProblematicService {
  name: string;
  condition: 'availability' | 'all';
}

export interface TrackingConfig {
  problematic_services: ProblematicService[];
}

let trackingConfig: TrackingConfig | null = null;

export function loadTrackingConfig(): TrackingConfig {
  if (!trackingConfig) {
    const configPath = path.join(process.cwd(), 'tracking-issues.yaml');
    try {
      const fileContents = fs.readFileSync(configPath, 'utf8');
      trackingConfig = yaml.load(fileContents) as TrackingConfig;
    } catch {
      // If file doesn't exist or has issues, use empty config
      trackingConfig = { problematic_services: [] };
    }
  }
  return trackingConfig;
}

// Detect page availability issues in diffs
export function detectAvailabilityPattern(diff: string): 'becoming_unavailable' | 'becoming_available' | null {
  // Error phrases that indicate page unavailability (case-insensitive)
  const errorPatterns = [
    /this page (?:isn't|is not|isn't) available/i,
    /page not found/i,
    /(?<![\w\/])404(?![\w\.\/])/i,  // 404 not in URLs or filenames
    /the (?:link|page) may (?:be broken|have been removed)/i,
    /an? unexpected error (?:has )?occurred/i,
    /try reloading the page/i,
    /come back later/i,
    /temporarily unavailable/i,
    /error loading/i,
    /page cannot be displayed/i,
    /service unavailable/i
  ];

  // Check each line of the diff
  const lines = diff.split('\n');
  let hasAddedError = false;
  let hasRemovedError = false;

  for (const line of lines) {
    // Check if line adds an error message (starts with +)
    if (line.match(/^\+/)) {
      for (const pattern of errorPatterns) {
        if (pattern.test(line)) {
          hasAddedError = true;
          break;
        }
      }
    }
    // Check if line removes an error message (starts with -)
    else if (line.match(/^-/)) {
      for (const pattern of errorPatterns) {
        if (pattern.test(line)) {
          hasRemovedError = true;
          break;
        }
      }
    }
  }

  // Determine the pattern
  if (hasAddedError && !hasRemovedError) {
    return 'becoming_unavailable';
  } else if (hasRemovedError && !hasAddedError) {
    return 'becoming_available';
  }

  return null;
}
