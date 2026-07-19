import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';

export interface ProblematicService {
  name: string;
  condition: 'availability' | 'all';
}

export interface ContentArtifact {
  name: string;
  marker: string;          // substring present in the block; cheap pre-filter (case-sensitive)
  block: string[];         // EXACT non-blank net-change lines (derived verbatim from the DB)
  block_b?: string[];      // if set: substitution flip-flop — net change must be exactly block↔block_b (either direction)
  services?: string[];     // optional scope: change.service must be one of these
  documentType?: string;   // optional scope: change.documentType must equal this
}

export interface TrackingConfig {
  problematic_services: ProblematicService[];
  content_artifacts?: ContentArtifact[];
}

export type Direction = 'ADD' | 'REMOVE' | 'SWAP';

let trackingConfig: TrackingConfig | null = null;

export function loadTrackingConfig(): TrackingConfig {
  if (!trackingConfig) {
    const configPath = path.join(process.cwd(), 'tracking-issues.yaml');
    try {
      const fileContents = fs.readFileSync(configPath, 'utf8');
      trackingConfig = yaml.load(fileContents) as TrackingConfig;
    } catch (e) {
      // Fall back to empty config so the cron stays alive, but make it LOUD: a
      // present-but-unparseable file would otherwise silently disable all tracking
      // detection (including problematic_services) with no signal at all.
      console.error('[tracking] failed to read/parse tracking-issues.yaml — detection disabled', e);
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

// --- Exact-block content-artifact matching ---------------------------------
// "Flip-flop" scraping artifacts: the scraper intermittently captures/drops a trailing
// block (or alternates between two variants of a block), each toggle landing as a
// separate non-minor Change. We classify them by EXACT net-change (multiset) equality
// against a known block signature (content_artifacts in tracking-issues.yaml). Matching
// is header-, blank-, and trailing-newline-agnostic by design — do NOT tighten it into
// a whole-string/header compare.

// Compute both net sides of a diff: drop "\ No newline" sentinels, cancel byte-identical
// +/- pairs, drop blank lines. Single hunk only (null otherwise).
export function netSides(diff: string): { added: string[]; removed: string[] } | null {
  const all = diff.split('\n');
  if (all.filter(l => l.startsWith('@@')).length !== 1) return null; // single hunk only
  const hdr = all.findIndex(l => l.startsWith('@@'));
  const body = all.slice(hdr + 1);
  const added: string[] = [];
  const removed: string[] = [];
  for (const l of body) {
    if (l.startsWith('\\')) continue;          // "\ No newline at end of file"
    if (l.startsWith('+')) added.push(l.slice(1));
    else if (l.startsWith('-')) removed.push(l.slice(1));
    // context (' ') lines ignored
  }
  const rem = [...removed];
  const netAdded = added.filter(a => {
    const i = rem.indexOf(a);
    if (i >= 0) { rem.splice(i, 1); return false; } // cancel byte-identical pair
    return true;
  });
  return {
    added: netAdded.filter(l => l.trim() !== ''),
    removed: rem.filter(l => l.trim() !== ''),
  };
}

// One-directional net change: the surviving non-blank side, or null when the net is
// empty (whitespace noise) or mixed (a real edit — substitution flip-flops are handled
// separately via block_b in matchArtifact).
export function netChange(diff: string): { direction: Direction; lines: string[] } | null {
  const net = netSides(diff);
  if (!net) return null;
  if (net.added.length && net.removed.length) return null; // mixed = real edit
  if (!net.added.length && !net.removed.length) return null; // empty net = whitespace noise
  return net.added.length
    ? { direction: 'ADD', lines: net.added }
    : { direction: 'REMOVE', lines: net.removed };
}

export function multisetEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((v, i) => v === y[i]);
}

// Does this diff's net change EXACTLY equal the signature, with scope satisfied?
// Returns the direction (for display/tooling) or null. Scoping (service/documentType) is
// applied here so callers don't have to pre-filter. Signatures with block_b are
// substitution flip-flops: the net change must be exactly block↔block_b (either way).
export function matchArtifact(
  diff: string,
  sig: ContentArtifact,
  service: string,
  documentType: string,
): Direction | null {
  if (sig.services && !sig.services.includes(service)) return null;
  if (sig.documentType && sig.documentType !== documentType) return null;
  if (!diff.includes(sig.marker)) return null; // cheap reject before parsing the diff
  if (sig.block_b) {
    const net = netSides(diff);
    if (!net || !net.added.length || !net.removed.length) return null;
    const ab = multisetEqual(net.removed, sig.block) && multisetEqual(net.added, sig.block_b);
    const ba = multisetEqual(net.removed, sig.block_b) && multisetEqual(net.added, sig.block);
    return ab || ba ? 'SWAP' : null;
  }
  const net = netChange(diff);
  if (!net) return null;
  return multisetEqual(net.lines, sig.block) ? net.direction : null;
}

// Pipeline entry point: is this diff a known flip-flop scraping artifact?
export function detectContentArtifact(diff: string, service: string, documentType: string): boolean {
  const artifacts = loadTrackingConfig().content_artifacts ?? [];
  return artifacts.some(sig => matchArtifact(diff, sig, service, documentType) !== null);
}

// Invariants for content_artifacts (mirrors the old validateSignatures in flag-artifacts.ts).
// Throws on the first problem — call from tooling that writes (the back-fill script).
export function validateContentArtifacts(
  list: ContentArtifact[] = loadTrackingConfig().content_artifacts ?? [],
): void {
  const names = new Set<string>();
  for (const s of list) {
    if (names.has(s.name)) throw new Error(`Duplicate content_artifacts name: ${s.name}`);
    names.add(s.name);
    if (!s.block.length) throw new Error(`content_artifacts ${s.name}: empty block`);
    // Blank lines never survive into net sides (netSides drops them), so a signature
    // containing one is dead — it can never match any diff.
    if ([...s.block, ...(s.block_b ?? [])].some(l => l.trim() === ''))
      throw new Error(`content_artifacts ${s.name}: blank block line can never match (net sides drop blank lines)`);
    if (s.block_b) {
      if (!s.block_b.length) throw new Error(`content_artifacts ${s.name}: empty block_b`);
      // A line present in both variants shows up in a real flip diff as context or as a
      // cancelled byte-identical -/+ pair, so it never reaches a net side — yet the swap
      // match requires it on both sides. Such a signature is dead. (Also covers
      // block === block_b.)
      if (s.block.some(l => s.block_b!.includes(l)))
        throw new Error(`content_artifacts ${s.name}: block and block_b share a line — shared lines cancel out of the net change, so the signature can never match`);
    }
    // For substitution signatures both variants appear in every matching diff (one as
    // -, one as +), so the marker may live in either block.
    if (![...s.block, ...(s.block_b ?? [])].some(l => l.includes(s.marker)))
      throw new Error(`content_artifacts ${s.name}: marker is not a substring of any block line`);
  }
}
