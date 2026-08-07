// Regenerate AI summaries for changes.
// Usage:
//   npx tsx scripts/regen-summaries.ts <id>       — regenerate by change ID (prefix match)
//   npx tsx scripts/regen-summaries.ts --failed    — regenerate all with failed AI summaries
//
// Failed summary markers. lib/ai.ts writes one user-facing string for every failure that
// leaves a change unsummarized — "AI analysis temporarily unavailable. See diff for
// details." — with the specific cause going to the server log. The remaining entries
// match older rows.
//   - "AI analysis temporarily unavailable."   every failure path
//   - "See diff for details."                  tail of that same string
//   - "Unable to analyze changes."             app/api/cron/route.ts, no patch to send
//   - "AI summary not available."              older rows only
//   - "AI analysis incomplete."                older rows only
//   - "AI response was invalid."               older rows only
//   - "Analysis rate limited"                  older rows only
//
// Rows matching a marker but holding no diffContent are listed and skipped: there is no
// input to regenerate from, and sending an empty diff to the LLM overwrites a truthful
// message with a summary of nothing.

import { PrismaClient } from '@prisma/client';
import { generateSummary } from '../lib/ai';

const FAILED_MARKERS = [
  'AI summary not available.',
  'AI analysis temporarily unavailable.',
  'AI analysis incomplete.',
  'AI response was invalid.',
  'Analysis rate limited',
  'See diff for details.',
  'Unable to analyze changes.',
];

async function main() {
  const arg = process.argv[2];

  if (!arg) {
    console.log('Usage:');
    console.log('  npx tsx scripts/regen-summaries.ts <id>       — by change ID (prefix match)');
    console.log('  npx tsx scripts/regen-summaries.ts --failed    — all failed AI summaries');
    process.exit(1);
  }

  const p = new PrismaClient();

  let changes;
  if (arg === '--failed') {
    changes = await p.change.findMany({
      where: { OR: FAILED_MARKERS.map(m => ({ diffSummary: { contains: m } })) },
    });
  } else {
    changes = await p.change.findMany({ where: { id: { startsWith: arg } } });
  }

  if (changes.length === 0) {
    console.log('No matching changes found.');
    await p.$disconnect();
    process.exit(1);
  }

  console.log(`Regenerating ${changes.length} change(s)...\n`);

  let skipped = 0;

  for (const c of changes) {
    console.log(`${c.service} — ${c.documentType} (${c.id.slice(0, 8)})`);

    if (!c.diffContent) {
      console.log('  skipped: no diff stored, nothing to regenerate from\n');
      skipped++;
      continue;
    }

    const result = await generateSummary(c.diffContent, c.service, c.documentType);
    await p.change.update({
      where: { id: c.id },
      data: { diffSummary: result.summary, isMinorChange: result.isMinorChange },
    });
    console.log(`  minor: ${result.isMinorChange}`);
    console.log(`  summary: ${result.summary}\n`);
  }

  await p.$disconnect();
  console.log(skipped > 0 ? `Done. ${skipped} skipped (no diff stored).` : 'Done.');
}

main();
