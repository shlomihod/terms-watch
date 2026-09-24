import type { CommitRef, FileChange } from '@/lib/github';

export interface IngestSteps {
  getFiles(commit: CommitRef): Promise<FileChange[]>;
  // Returns true if it stored a new row, false if the file was already stored.
  ingestFile(commit: CommitRef, file: FileChange): Promise<boolean>;
  saveCursor(sha: string): Promise<void>;
}

export interface IngestResult {
  newChanges: number;
  advanced: number; // commits the cursor moved past
  errors: string[];
}

// How long a run may keep starting commits, given the function's time limit in
// seconds: leave a minute for the commit in flight (its LLM call has no timeout
// of its own), or half the limit if that's shorter.
export function runBudgetMs(maxDurationSeconds: number): number {
  return Math.max(maxDurationSeconds - 60, maxDurationSeconds / 2) * 1000;
}

// Ingests `commits` (oldest first) and moves the cursor past each one, but only
// across an unbroken run of fully ingested commits: a failed file pins the cursor
// before its commit so the next run retries it. Commits after a failure are still
// ingested now; the retry finds them already stored. Stops starting new commits
// after `deadline` (epoch ms), leaving the rest for the next run. A saveCursor
// failure (DB down) propagates to the caller.
//
// Logs a line per file before ingesting it and each error as it happens: Vercel
// keeps only what the function prints, so if a run is killed (e.g. a hung LLM
// call), the last line names the file in flight.
export async function ingestCommits(
  commits: CommitRef[],
  deadline: number,
  steps: IngestSteps
): Promise<IngestResult> {
  const result: IngestResult = { newChanges: 0, advanced: 0, errors: [] };
  const fail = (message: string) => {
    console.error(`[cron] ${message}`);
    result.errors.push(message);
  };
  let pinned = false;

  for (const commit of commits) {
    if (Date.now() > deadline) break;

    const sha8 = commit.sha.substring(0, 8);
    let ok = true;
    try {
      for (const file of await steps.getFiles(commit)) {
        console.log(`[cron] ${sha8} ${file.filename}`);
        try {
          if (await steps.ingestFile(commit, file)) result.newChanges++;
        } catch (error) {
          ok = false;
          fail(`${sha8} ${file.filename}: ${String(error)}`);
        }
      }
    } catch (error) {
      ok = false;
      fail(`${sha8}: ${String(error)}`);
    }

    if (!ok) pinned = true;
    if (!pinned) {
      await steps.saveCursor(commit.sha);
      result.advanced++;
    }
  }

  return result;
}
