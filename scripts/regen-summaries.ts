// Regenerate AI summaries for changes.
// Usage:
//   npx tsx scripts/regen-summaries.ts <id>       — regenerate by change ID (prefix match)
//   npx tsx scripts/regen-summaries.ts --failed    — regenerate all with failed AI summaries
//
// Failed summary markers come from lib/ai.ts error paths:
//   - "AI summary not available."              (line 126 — no API key)
//   - "AI analysis temporarily unavailable."   (line 170 — empty LLM response)
//   - "AI analysis incomplete."                (line 181 — missing summary field)
//   - "AI response was invalid."               (line 211 — JSON parse failure)
//   - "Analysis rate limited"                  (line 220 — 429 error)
//   - "See diff for details."                  (line 226 — other API error)

import { PrismaClient } from '@prisma/client';
import { generateSummary } from '../lib/ai';

const FAILED_MARKERS = [
  'AI summary not available.',
  'AI analysis temporarily unavailable.',
  'AI analysis incomplete.',
  'AI response was invalid.',
  'Analysis rate limited',
  'See diff for details.',
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

  for (const c of changes) {
    console.log(`${c.service} — ${c.documentType} (${c.id.slice(0, 8)})`);
    const result = await generateSummary(c.diffContent, c.service, c.documentType);
    await p.change.update({
      where: { id: c.id },
      data: { diffSummary: result.summary, isMinorChange: result.isMinorChange },
    });
    console.log(`  minor: ${result.isMinorChange}`);
    console.log(`  summary: ${result.summary}\n`);
  }

  await p.$disconnect();
  console.log('Done.');
}

main();
