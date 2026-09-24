import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { prisma } from '@/lib/db';
import {
  getRepoList,
  listNewCommits,
  getCommitFiles,
  fetchFileDiff,
  type CommitRef,
  type FileChange,
} from '@/lib/github';
import { ingestCommits, runBudgetMs } from '@/lib/ingest';
import { generateSummary } from '@/lib/ai';

// Force dynamic execution (prevent static optimization)
export const dynamic = 'force-dynamic';

// Function time limit in seconds (the Hobby maximum with Fluid compute; without
// Fluid compute Hobby allows 60). The run budget follows from it, so change only
// this number.
export const maxDuration = 300;

// Stop starting new commits after this (see runBudgetMs). A run killed anyway
// loses nothing: its commit is still after the cursor. Repo i may start commits
// until (i + 1)/n of the budget, so a busy first repo can't starve the next; time
// a repo leaves unused carries over to later repos.
const RUN_BUDGET_MS = runBudgetMs(maxDuration);

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    // Fail closed: never accept requests when the secret is unset.
    return NextResponse.json(
      { error: 'Server misconfigured' },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get('authorization') ?? '';
  const expected = Buffer.from(`Bearer ${cronSecret}`);
  const provided = Buffer.from(authHeader);
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const start = Date.now();
    const repos = await getRepoList();
    const results = {
      processed: 0,
      errors: [] as string[],
      newChanges: 0,
      pending: {} as Record<string, number>,
    };

    for (const [i, repo] of repos.entries()) {
      const deadline = start + (RUN_BUDGET_MS * (i + 1)) / repos.length;
      try {
        const lastCheck = await prisma.lastCheck.findUnique({
          where: { repo: repo.repo },
        });

        const { commits, total, mode } = await listNewCommits(
          repo.repo,
          lastCheck?.lastCommitSha,
          lastCheck?.checkedAt
        );
        // Response bodies of scheduled runs aren't kept, so log the backlog: a repo
        // whose cursor stays put while commits are pending is stuck. The line also
        // tells which repo the lines below belong to.
        console.log(`[cron] ${repo.repo}: ${total} pending after ${lastCheck?.lastCommitSha ?? 'no cursor'} (${mode})`);
        if (mode === 'rewritten') {
          const message = `${repo.repo}: cursor ${lastCheck?.lastCommitSha} is no longer in upstream history; re-listed commits dated from 7 days before the cursor last moved (${lastCheck?.checkedAt.toISOString()})`;
          console.error(`[cron] ${message}`);
          results.errors.push(message);
        }

        const run = await ingestCommits(commits, deadline, {
          getFiles: commit => getCommitFiles(repo.repo, commit.sha),
          ingestFile: (commit, file) => ingestFile(repo.repo, commit, file),
          saveCursor: sha => saveCursor(repo.repo, sha),
        });

        results.newChanges += run.newChanges;
        results.errors.push(...run.errors);
        results.pending[repo.repo] = total - run.advanced;
        results.processed++;
      } catch (error) {
        // DB or GitHub unreachable: the cursor is untouched, so the next run catches up.
        const message = `${repo.repo}: ${String(error)}`;
        console.error(`[cron] ${message}`);
        results.errors.push(message);
      }
    }

    // Any error returns 500 so failed runs show up in Vercel's logs and monitors.
    const ok = results.errors.length === 0;
    return NextResponse.json(
      { success: ok, ...results, timestamp: new Date().toISOString() },
      { status: ok ? 200 : 500 }
    );
  } catch (error) {
    console.error(`[cron] ${String(error)}`);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Allow POST as well for easier testing
export async function POST(request: NextRequest) {
  return GET(request);
}

// Stores one tracked file of a commit; returns false if it was already stored.
// Throws on DB/GitHub errors so ingestCommits pins the cursor and retries it.
async function ingestFile(repo: string, commit: CommitRef, file: FileChange): Promise<boolean> {
  // Check if we've already processed this specific file in this
  // commit. Existence check only — select just the id so the dedup
  // loop never pulls the (multi-KB) diff for already-seen files.
  const existing = await prisma.change.findFirst({
    where: {
      commitSha: commit.sha,
      filename: file.filename
    },
    select: { id: true },
  });

  if (existing) return false;

  // Generate AI summary if we have a diff, or use standard message for new/removed files
  let summary = null;
  let isMinorChange = false;
  let patch = file.patch; // Track the patch (from GitHub or generated)

  if (file.status === 'added') {
    summary = `${file.service} either introduced new ${file.documentType} or these terms are being tracked for the first time.`;
  } else if (file.status === 'removed') {
    summary = `${file.service} ${file.documentType} is no longer being tracked. The document may have been removed or relocated.`;
  } else {
    // If no patch provided by GitHub (file too large), fetch and generate it
    if (!patch && commit.parentSha) {
      const generatedPatch = await fetchFileDiff(
        repo,
        file.filename,
        commit.sha,
        commit.parentSha
      );
      if (generatedPatch) {
        patch = generatedPatch; // Store the generated patch
      }
    }

    // If we have a patch (from GitHub or generated), analyze it
    if (patch) {
      const aiResult = await generateSummary(
        patch,
        file.service,
        file.documentType
      );
      summary = aiResult.summary;
      isMinorChange = aiResult.isMinorChange;

      // Add delay to respect rate limits (~5 requests per second)
      await new Promise(resolve => setTimeout(resolve, 200));
    } else {
      // Still no patch available (no parent commit, or an empty diff)
      summary = `${file.service} updated their ${file.documentType}. Unable to analyze changes.`;
      isMinorChange = false;
    }
  }

  // Store the change with a unique ID
  await prisma.change.create({
    data: {
      id: `${commit.sha.substring(0, 8)}-${file.filename.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 30)}-${Date.now()}`,
      service: file.service,
      category: file.category,
      documentType: file.documentType,
      filename: file.filename,
      commitSha: commit.sha,
      commitDate: commit.date,
      commitUrl: commit.url,
      diffContent: patch || '', // Store the patch (whether from GitHub or generated)
      diffSummary: summary,
      isMinorChange: isMinorChange,
      processed: true,
    },
  });

  return true;
}

// The cursor: every commit up to and including `sha` is fully ingested.
async function saveCursor(repo: string, sha: string) {
  await prisma.lastCheck.upsert({
    where: { repo },
    create: {
      id: `lastcheck-${repo}`,
      repo,
      lastCommitSha: sha,
      checkedAt: new Date(),
    },
    update: {
      lastCommitSha: sha,
      checkedAt: new Date(),
    },
  });
}
