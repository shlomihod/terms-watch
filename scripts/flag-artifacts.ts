// Flag OTA "flip-flop" scraping artifacts as minor changes.
//
// Some OpenTermsArchive scrapes intermittently capture/drop a trailing block on a
// page (a help-nav heading, a cookie-consent banner, ...). Each capture/drop lands
// as a separate non-minor Change, polluting the feed with add/remove noise that is
// not a real policy change. This tool detects those rows by an EXACT net-change
// match against known block signatures and flips isMinorChange=true (flag only).
//
// It is post-hoc cleanup, manually triggered, idempotent, and re-runnable. It never
// calls the LLM, never rewrites diffSummary, and cannot conflict with the cron
// pipeline (cron only INSERTs new rows; this only UPDATEs the flag on existing ones).
//
// Usage:
//   npx tsx scripts/flag-artifacts.ts                 — DRY RUN (default): list matches, write nothing
//   npx tsx scripts/flag-artifacts.ts --apply         — flip isMinorChange=true on all matched rows
//   npx tsx scripts/flag-artifacts.ts --only <name>   — restrict to one signature (dry run unless --apply)
//   npx tsx scripts/flag-artifacts.ts --derive <id>   — print a row's net-change as a paste-ready block
//                                                        (use when onboarding a NEW signature)
//
// SAFETY: matching is EXACT net-change equality (single hunk, byte-identical lines
// cancelled, every net non-blank line must equal the known block exactly). This does
// NOT distinguish a genuine block-removal from an artifact — so review the dry-run
// before --apply. The flip is reversible (row stays visible under "Include minor
// changes" and fetchable by id); RSS may lag ~1h (Cache-Control max-age=3600).

import { PrismaClient } from '@prisma/client';

interface ArtifactSignature {
  name: string;
  marker: string;          // substring present in the block; cheap DB pre-filter (case-sensitive)
  block: string[];         // EXACT non-blank net-change lines (derived verbatim from the DB)
  services?: string[];     // optional scope: row.service must be one of these
  documentType?: string;   // optional scope: row.documentType must equal this
}

// Signatures derived byte-exact from real diffContent (scripts/_tw-derive helper).
const SIGNATURES: ArtifactSignature[] = [
  {
    name: 'qwen-cookie-consent',
    services: ['Qwen Chat'],
    documentType: 'Trackers Policy',
    marker: "We'd like to use cookies to remember your preferences",
    block: [
      'Cookie Notice',
      "We'd like to use cookies to remember your preferences and show relevant content. You can accept all cookies for a fully personalized experience, or select only the strictly necessary ones to keep Qwen Studio running securely. For more details, please read our [Cookie Notice](https://qwen.ai/cookies-notice).",
      'Accept all cookiesAccept all strictly necessary cookies',
    ],
  },
  {
    name: 'other-ways-to-get-help',
    services: ['Instagram', 'Threads'],
    marker: 'Other ways to get help',
    block: [
      'Other ways to get help',
      '-'.repeat(22), // markdown setext underline, 22 dashes (= heading length)
    ],
  },
];

type Direction = 'ADD' | 'REMOVE';

// Compute the net change of a diff: drop "\ No newline" sentinels, cancel
// byte-identical +/- lines, return the surviving non-blank side (or null).
function netChange(diff: string): { direction: Direction; lines: string[] } | null {
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
  const netRemoved = rem;
  const addNB = netAdded.filter(l => l.trim() !== '');
  const remNB = netRemoved.filter(l => l.trim() !== '');
  if (addNB.length && remNB.length) return null; // mixed = real edit
  if (!addNB.length && !remNB.length) return null; // empty net = whitespace noise
  return addNB.length ? { direction: 'ADD', lines: addNB } : { direction: 'REMOVE', lines: remNB };
}

function multisetEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((v, i) => v === y[i]);
}

// Does this diff's net change EXACTLY equal the signature's block?
function matches(diff: string, sig: ArtifactSignature): Direction | null {
  const net = netChange(diff);
  if (!net) return null;
  return multisetEqual(net.lines, sig.block) ? net.direction : null;
}

function validateSignatures() {
  const names = new Set<string>();
  for (const s of SIGNATURES) {
    if (names.has(s.name)) throw new Error(`Duplicate signature name: ${s.name}`);
    names.add(s.name);
    if (!s.block.length) throw new Error(`Signature ${s.name}: empty block`);
    if (!s.block.some(l => l.includes(s.marker)))
      throw new Error(`Signature ${s.name}: marker is not a substring of any block line`);
  }
}

function whereFor(sig: ArtifactSignature, includeMinor: boolean) {
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
  npx tsx scripts/flag-artifacts.ts --apply         — flip isMinorChange=true on matched rows
  npx tsx scripts/flag-artifacts.ts --only <name>   — restrict to one signature
  npx tsx scripts/flag-artifacts.ts --derive <id>   — print a row's net-change as a paste-ready block

Signatures: ${SIGNATURES.map(s => s.name).join(', ')}`);
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
    console.log('  block: [');
    for (const l of net.lines) console.log(`    ${JSON.stringify(l)},`);
    console.log('  ]');
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

  validateSignatures();
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
        .map(c => ({ c, dir: matches(c.diffContent, sig) }))
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
      console.log(`\n✨ DRY RUN: ${grandTotal} row(s) would be flagged isMinorChange=true. Re-run with --apply to write.`);
      return;
    }

    const res = await prisma.change.updateMany({ where: { id: { in: matchedIds } }, data: { isMinorChange: true } });
    console.log(`\n✓ Flagged ${res.count} change(s) isMinorChange=true.`);
    console.log('  flipped ids:');
    for (const id of matchedIds) console.log(`    ${id}`);
    console.log('⚠️  RSS (app/rss/route.ts) has Cache-Control max-age=3600; flagged items may linger in RSS up to ~1h. Feed/API update on next request.');
  } finally {
    await prisma.$disconnect();
  }
}

// Run only when invoked directly (so a one-off validator can import the matcher).
if (process.argv[1]?.includes('flag-artifacts')) main();

export { SIGNATURES, netChange, matches, multisetEqual };
