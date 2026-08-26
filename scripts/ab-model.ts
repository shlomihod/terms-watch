// Model A/B for terms-watch, scored against agent-established ground truth.
//
// ─────────────────────────────────────────────────────────────────────────────────
// PROTOCOL — INSTRUCTIONS FOR THE AGENT RUNNING THIS
// ─────────────────────────────────────────────────────────────────────────────────
// Read this whole block before running anything. The order of the steps is the point:
// the judge must be established BEFORE any model output is visible to it.
//
// WHY THIS EXISTS
//   An earlier version scored candidate models against the summaries already stored in
//   the DB — i.e. against the incumbent model's own past output. That is not ground
//   truth. It scores the incumbent perfectly by construction, and it cannot detect an
//   error that every model shares. Ground truth here comes from a frontier coding agent
//   reading the raw diff against the rubric in llm.yaml, blind to every model's verdict.
//
// WHAT COUNTS AS AN ERROR — THE ASYMMETRY IS THE WHOLE POINT
//   FALSE NEGATIVE  = a real content change labeled minor. It never reaches the feed and
//                     the subscriber cannot recover it. This is the error that matters.
//   false positive  = a formatting/blurb change surfaced as real. Costs one noisy row.
//   Never collapse these into a single "accuracy" number. A model with more total errors
//   but zero false negatives beats a model with one false negative.
//
// STEP 1 — SAMPLE (once; the sample must stay fixed across every model)
//   npx tsx --env-file=.env scripts/ab-model.ts --export=judge --sample=30
//   Deterministic: rows are ordered by md5(id), so the same 30 rows come back every run
//   and results stay comparable over time. Writes judge/<id>.diff (raw diff, untouched)
//   plus judge/manifest.json. Do NOT hand-pick the sample; do NOT drop the large diffs.
//
// STEP 2 — ESTABLISH GROUND TRUTH (subagents, blind)
//   Spawn subagents over the exported diffs — batches are fine, but every judge MUST be
//   blind: give it ONLY the diff file path, the service/documentType, and the rubric from
//   llm.yaml. Never pass it a stored summary, a model verdict, this script's output, or
//   another judge's labels. A judge that knows what a model said is no longer a judge.
//   Each judge returns, per row: {id, isMinorChange, reason, confidence}.
//   `reason` must quote or cite the specific diff lines it decided on, so a human can
//   audit the label in under a minute. Merge into judge/labels.json as {id: {...}}.
//   Judge the DIFF, not the stored summary. If the diff is too large to read whole, read
//   the added/removed lines — never skim the first page and guess.
//
// STEP 3 — RUN THE MODELS (one process per model; config caching prevents switching)
//   npx tsx --env-file=.env scripts/ab-model.ts <model-id> --ids=<from manifest>
//   Always include the incumbent from llm.yaml as a control — it is a candidate here,
//   not the reference.
//
// STEP 4 — SCORE AGAINST TRUTH
//   npx tsx --env-file=.env scripts/ab-model.ts --score=judge/labels.json
//   Reports FN and FP per model against the judge labels, plus the stored DB labels
//   scored the same way (that number is the incumbent's real historical error rate).
//
// REPORTING RULES
//   State the sample size next to every rate; n=30 does not support a decimal place.
//   Where the judge and every model agree, say so — that row carried no information.
//   If the judge was uncertain, surface the row for a human rather than counting it.
//   The judge is a frontier model, not an oracle: report its labels as auditable
//   judgments with citations, never as facts.
// ─────────────────────────────────────────────────────────────────────────────────
//
// Model swapping: a patched llm.yaml is written to a temp dir and cwd moves there before
// the first generateSummary() call. lib/ai.ts and lib/tracking.ts resolve their YAML from
// process.cwd() lazily, so the repo's own config is never touched.

import { PrismaClient } from '@prisma/client';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateSummary } from '../lib/ai';

// Summaries lib/ai.ts returns WITHOUT calling the LLM (artifact/availability
// short-circuits), plus the failure markers. Such a row has no model judgment in it, so
// it is not a sample.
const NON_LLM = [
  'AI analysis temporarily unavailable.', 'See diff for details.', 'tracking error',
  'tracking issue', 'AI summary not available.', 'AI analysis incomplete.',
  'AI response was invalid.', 'Analysis rate limited', 'Unable to analyze changes.',
];

// Format rules stated in llm.yaml's FORMAT REQUIREMENTS.
function formatViolations(s: string): string[] {
  const v: string[] = [];
  if (s.length > 280) v.push(`len ${s.length} > 280`);
  if (/https?:\/\//i.test(s)) v.push('contains URL');
  if (/[*#`]|^\s*[-•]\s/m.test(s)) v.push('markdown/bullets');
  if (/<[a-z/][^>]*>/i.test(s)) v.push('HTML tag');
  return v;
}

type Judge = Record<string, { isMinorChange: boolean; reason?: string; confidence?: string }>;

// The shape scoreAgainstJudge() reads back out of an ab-<model>.json written by a run.
interface RunRow {
  id: string;
  service: string;
  documentType: string;
  stored: { isMinorChange: boolean; summary: string | null };
  fresh: { isMinorChange: boolean; summary: string };
  violations: string[];
}

// STEP 1 — deterministic random sample across the requested years.
async function exportForJudge(p: PrismaClient, dir: string, n: number) {
  const rows = await p.$queryRawUnsafe<{ id: string }[]>(`
    SELECT id FROM "Change"
    WHERE processed = true AND "diffSummary" IS NOT NULL
      AND "commitDate" >= '2025-01-01' AND "commitDate" < '2027-01-01'
      ${NON_LLM.map(m => `AND "diffSummary" NOT LIKE '%${m.replace(/'/g, "''")}%'`).join(' ')}
    ORDER BY md5(id) LIMIT ${n}
  `);
  const full = await p.change.findMany({ where: { id: { in: rows.map(r => r.id) } } });
  fs.mkdirSync(dir, { recursive: true });
  const manifest = full.map(r => ({
    id: r.id, service: r.service, documentType: r.documentType,
    commitDate: r.commitDate.toISOString().slice(0, 10),
    diffChars: r.diffContent.length, file: path.join(dir, `${r.id.slice(0, 8)}.diff`),
  }));
  for (const r of full) {
    fs.writeFileSync(path.join(dir, `${r.id.slice(0, 8)}.diff`), r.diffContent);
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`exported ${full.length} diffs to ${dir}/`);
  console.log(`years: ${Array.from(new Set(manifest.map(m => m.commitDate.slice(0, 4)))).sort().join(', ')}`);
  console.log(`sizes: min ${Math.min(...manifest.map(m => m.diffChars))} / median ${manifest.map(m => m.diffChars).sort((a, b) => a - b)[Math.floor(manifest.length / 2)]} / max ${Math.max(...manifest.map(m => m.diffChars))} chars`);
  console.log(`\n--ids=${manifest.map(m => m.id.slice(0, 8)).join(',')}`);
}

// STEP 4 — score every model run, and the stored DB labels, against the judge.
function scoreAgainstJudge(judgePath: string) {
  const judge: Judge = JSON.parse(fs.readFileSync(judgePath, 'utf8'));
  const runs = fs.readdirSync('.').filter(f => f.startsWith('ab-') && f.endsWith('.json'));
  const scored: { name: string; fn: string[]; fp: string[]; n: number; bad: number }[] = [];

  const collect = (name: string, verdicts: { id: string; label: string; minor: boolean; bad: boolean }[]) => {
    const fn: string[] = [], fp: string[] = [];
    let n = 0, bad = 0;
    for (const v of verdicts) {
      const truth = judge[v.id] ?? judge[v.id.slice(0, 8)];
      if (!truth) continue;
      n++;
      if (v.bad) bad++;
      if (truth.isMinorChange === v.minor) continue;
      (v.minor ? fn : fp).push(v.label);
    }
    scored.push({ name, fn, fp, n, bad });
  };

  let storedDone = false;
  for (const f of runs) {
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!storedDone) {
      collect('STORED (DB, historical)', (d.results as RunRow[]).map(r => ({
        id: r.id, label: `${r.service} — ${r.documentType}`, minor: r.stored.isMinorChange, bad: false,
      })));
      storedDone = true;
    }
    collect(d.newModel, (d.results as RunRow[]).map(r => ({
      id: r.id, label: `${r.service} — ${r.documentType}`,
      minor: r.fresh.isMinorChange, bad: r.violations.length > 0,
    })));
  }

  console.log(`\nscored against ${judgePath} (${Object.keys(judge).length} labels)\n`);
  console.log('model'.padEnd(34) + 'n'.padStart(4) + 'FALSE NEG'.padStart(11) + 'false pos'.padStart(11) + 'fmt bad'.padStart(9));
  for (const s of scored.sort((a, b) => a.fn.length - b.fn.length || a.fp.length - b.fp.length)) {
    console.log(s.name.padEnd(34) + String(s.n).padStart(4) + String(s.fn.length).padStart(11) + String(s.fp.length).padStart(11) + String(s.bad).padStart(9));
  }
  console.log('\nfalse negatives — real changes that would never reach the feed:');
  for (const s of scored) for (const l of s.fn) console.log(`  ${s.name.split('/').pop()}: ${l}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name: string) => argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

  const scorePath = flag('score');
  if (scorePath) return scoreAgainstJudge(scorePath);

  const exportDir = flag('export');
  const p = new PrismaClient();
  if (exportDir) {
    await exportForJudge(p, exportDir, Number(flag('sample') ?? 30));
    return p.$disconnect();
  }

  const model = argv.find(a => !a.startsWith('--'));
  const idsArg = flag('ids');
  if (!model || !idsArg) {
    console.log('Usage:');
    console.log('  scripts/ab-model.ts --export=judge --sample=30      establish the sample');
    console.log('  scripts/ab-model.ts <model-id> --ids=a,b,c          run one model');
    console.log('  scripts/ab-model.ts --score=judge/labels.json       score all runs vs truth');
    console.log('\nRead the PROTOCOL block at the top of this file first.');
    process.exit(1);
  }

  const repoRoot = process.cwd();
  const ids = idsArg.split(',');
  const rows = await p.change.findMany({ where: { OR: ids.map(id => ({ id: { startsWith: id } })) } });
  rows.sort((a, b) => ids.findIndex(i => a.id.startsWith(i)) - ids.findIndex(i => b.id.startsWith(i)));
  await p.$disconnect();

  const cfg = yaml.load(fs.readFileSync(path.join(repoRoot, 'llm.yaml'), 'utf8')) as { model: { name: string } };
  const incumbent = cfg.model.name;
  const abRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-model-'));
  cfg.model.name = model;
  fs.writeFileSync(path.join(abRoot, 'llm.yaml'), yaml.dump(cfg));
  fs.copyFileSync(path.join(repoRoot, 'tracking-issues.yaml'), path.join(abRoot, 'tracking-issues.yaml'));
  process.chdir(abRoot);

  console.log(`\nmodel: ${model}${model === incumbent ? '  (incumbent)' : ''}   samples: ${rows.length}\n`);

  const results = [];
  for (const r of rows) {
    const t0 = Date.now();
    const fresh = await generateSummary(r.diffContent, r.service, r.documentType);
    const ms = Date.now() - t0;
    const violations = formatViolations(fresh.summary);
    results.push({
      id: r.id, service: r.service, documentType: r.documentType,
      commitDate: r.commitDate, diffChars: r.diffContent.length, ms,
      stored: { isMinorChange: r.isMinorChange, summary: r.diffSummary },
      fresh, violations,
    });
    console.log(`${r.service} — ${r.documentType}  minor=${fresh.isMinorChange}  (${r.diffContent.length} chars, ${ms}ms)${violations.length ? '  FORMAT: ' + violations.join(', ') : ''}`);
    console.log(`  ${fresh.summary}`);
  }

  const out = path.join(repoRoot, `ab-${model.replace(/[^a-z0-9.]+/gi, '-')}.json`);
  fs.writeFileSync(out, JSON.stringify({ incumbent, newModel: model, results }, null, 2));
  console.log(`\nwrote ${out} — now score with --score=judge/labels.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
