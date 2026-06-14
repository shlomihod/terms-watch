// Back-fill OTA "flip-flop" scraping artifacts as "tracking errors" on EXISTING rows.
//
// Live classification now happens automatically in the cron/AI pipeline: lib/ai.ts
// generateSummary() calls detectContentArtifact() (lib/tracking.ts), which matches the
// `content_artifacts` signatures in tracking-issues.yaml and returns
// { isMinorChange: true, summary: 'Unstable content (tracking error).' }. New scrapes are
// classified at write time, and new signatures are onboarded by editing tracking-issues.yaml
// (no code change).
//
// This script is the back-fill/finder for rows that predate a signature: it scans the DB
// for existing Changes whose net-change EXACTLY matches a signature and sets the same two
// columns (isMinorChange=true, diffSummary='Unstable content (tracking error).'). It never
// calls the LLM, is idempotent and re-runnable, and cannot conflict with the cron pipeline
// (cron only INSERTs new rows; this only UPDATEs existing ones).
//
// Usage:
//   npx tsx scripts/flag-artifacts.ts                 — DRY RUN (default): list matches, write nothing
//   npx tsx scripts/flag-artifacts.ts --apply         — set isMinorChange=true + tracking-error summary on matches
//   npx tsx scripts/flag-artifacts.ts --only <name>   — restrict to one signature (dry run unless --apply)
//   npx tsx scripts/flag-artifacts.ts --derive <id>   — print a row's net-change as a paste-ready YAML block
//                                                        (use when onboarding a NEW signature into tracking-issues.yaml)
//
// SAFETY: matching is EXACT net-change equality (single hunk, byte-identical lines
// cancelled, every net non-blank line must equal the known block exactly). This does NOT
// distinguish a genuine block-removal from an artifact — so review the dry-run before
// --apply. The flip is reversible (row stays visible under "Include minor changes" and
// fetchable by id); RSS may lag ~1h (Cache-Control max-age=3600), as may the site's RSC cache.

import { PrismaClient } from '@prisma/client';
import {
  loadTrackingConfig,
  validateContentArtifacts,
  netChange,
  matchArtifact,
  type ContentArtifact,
  type Direction,
} from '../lib/tracking';

// Signatures are the single source of truth in tracking-issues.yaml (same list the pipeline
// classifies against). If the file fails to parse, loadTrackingConfig logs loudly and this
// is empty → the script finds nothing.
const SIGNATURES: ContentArtifact[] = loadTrackingConfig().content_artifacts ?? [];

const TRACKING_ERROR_SUMMARY = 'Unstable content (tracking error).';

function whereFor(sig: ContentArtifact, includeMinor: boolean) {
  return {
    ...(includeMinor ? {} : { isMinorChange: false }),
    diffContent: { contains: sig.marker },
    ...(sig.documentType ? { documentType: sig.documentType } : {}),
    ...(sig.services ? { service: { in: sig.services } } : {}),
  };
}

const label = (c: { service: string; documentType: string; id: string }) =>
  `${c.service} — ${c.documentType} (${c.id.slice(0, 8)})`;

function usage(): never {
  console.log(`Usage:
  npx tsx scripts/flag-artifacts.ts                 — DRY RUN: list matches, write nothing
  npx tsx scripts/flag-artifacts.ts --apply         — set isMinorChange=true + tracking-error summary on matches
  npx tsx scripts/flag-artifacts.ts --only <name>   — restrict to one signature
  npx tsx scripts/flag-artifacts.ts --derive <id>   — print a row's net-change as a paste-ready YAML block

Signatures (from tracking-issues.yaml): ${SIGNATURES.map(s => s.name).join(', ') || '(none)'}`);
  process.exit(1);
}

async function deriveMode(prisma: PrismaClient, idPrefix: string) {
  const rows = await prisma.change.findMany({
    where: { id: { startsWith: idPrefix } },
    select: { id: true, service: true, documentType: true, diffContent: true },
  });
  if (!rows.length) { console.log(`No rows with id starting ${idPrefix}`); return; }
  for (const r of rows) {
    const net = netChange(r.diffContent);
    console.log(`\n# ${label(r)}`);
    if (!net) { console.log('  (not a single-hunk one-directional net change — cannot derive)'); continue; }
    console.log(`  direction: ${net.direction}`);
    console.log('  block:'); // paste under a new content_artifacts entry in tracking-issues.yaml
    for (const l of net.lines) console.log(`    - ${JSON.stringify(l)}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) usage();

  const apply = args.includes('--apply');
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
  const deriveIdx = args.indexOf('--derive');
  const derive = deriveIdx >= 0 ? args[deriveIdx + 1] : null;

  if (only && !SIGNATURES.some(s => s.name === only)) {
    console.error(`Unknown signature "${only}". Valid: ${SIGNATURES.map(s => s.name).join(', ')}`);
    process.exit(1);
  }

  validateContentArtifacts(SIGNATURES); // loud throw on a malformed signature before any write
  const prisma = new PrismaClient();
  try {
    if (derive) { await deriveMode(prisma, derive); return; }

    const sigs = only ? SIGNATURES.filter(s => s.name === only) : SIGNATURES;
    const matchedIds: string[] = [];
    let grandTotal = 0;

    for (const sig of sigs) {
      const candidates = await prisma.change.findMany({
        where: whereFor(sig, false),
        select: { id: true, service: true, documentType: true, diffContent: true },
        orderBy: { commitDate: 'desc' },
      });
      const hits = candidates
        .map(c => ({ c, dir: matchArtifact(c.diffContent, sig, c.service, c.documentType) }))
        .filter((x): x is { c: typeof candidates[number]; dir: Direction } => x.dir !== null);

      console.log(`\n🔎 ${sig.name}: ${hits.length} matched / ${candidates.length} marker candidate(s)` +
        (candidates.length - hits.length ? `  (${candidates.length - hits.length} marker-hit but unmatched — possible signature drift or unrelated)` : ''));
      for (const { c, dir } of hits) {
        console.log(`   [${dir}] ${label(c)}`);
        matchedIds.push(c.id);
      }
      grandTotal += hits.length;
    }

    if (grandTotal === 0) { console.log('\nNo flip-flop artifacts found.'); return; }

    if (!apply) {
      console.log(`\n✨ DRY RUN: ${grandTotal} row(s) would be set isMinorChange=true + diffSummary="${TRACKING_ERROR_SUMMARY}". Re-run with --apply to write.`);
      return;
    }

    const res = await prisma.change.updateMany({
      where: { id: { in: matchedIds } },
      data: { isMinorChange: true, diffSummary: TRACKING_ERROR_SUMMARY },
    });
    console.log(`\n✓ Flagged ${res.count} change(s) as tracking errors (isMinorChange=true, diffSummary set).`);
    console.log('  flipped ids:');
    for (const id of matchedIds) console.log(`    ${id}`);
    console.log('⚠️  RSS (app/rss/route.ts) has Cache-Control max-age=3600; flagged items may linger in RSS up to ~1h. Feed/API update on next request (the site\'s RSC cache may also lag).');
  } finally {
    await prisma.$disconnect();
  }
}

main();
