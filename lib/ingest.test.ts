import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ingestCommits, runBudgetMs, type IngestSteps } from './ingest';
import type { CommitRef, FileChange } from './github';

// Each commit is named by one letter; its SHA is that letter padded to 40 chars.
const commit = (id: string): CommitRef => ({ sha: id.padEnd(40, '0'), date: new Date(0), url: '' });
const commits = (ids: string) => [...ids].map(commit);
const id = (sha: string) => sha[0];
const file = (filename: string): FileChange => ({
  filename,
  service: 'Svc',
  documentType: 'Doc',
  category: 'ai',
});

interface FakeOptions {
  files?: Record<string, string[]>; // commit id → filenames (default ['<id>.md'])
  failFile?: string; // ingestFile throws for this filename
  failCommit?: string; // getFiles throws for this commit id
  alreadyStored?: string; // ingestFile returns false for this filename
  slowCommit?: string; // getFiles waits 60ms for this commit id
  failSave?: boolean; // saveCursor throws
}

function fake(opts: FakeOptions = {}) {
  const saved: string[] = [];
  const ingested: string[] = [];
  const steps: IngestSteps = {
    async getFiles(c) {
      if (opts.slowCommit === id(c.sha)) await new Promise(r => setTimeout(r, 60));
      if (opts.failCommit === id(c.sha)) throw new Error('GitHub 502');
      return (opts.files?.[id(c.sha)] ?? [`${id(c.sha)}.md`]).map(file);
    },
    async ingestFile(_c, f) {
      if (f.filename === opts.failFile) throw new Error('insert failed');
      ingested.push(f.filename);
      return f.filename !== opts.alreadyStored;
    },
    async saveCursor(sha) {
      if (opts.failSave) throw new Error('DB unreachable');
      saved.push(id(sha));
    },
  };
  return { steps, saved, ingested };
}

const later = () => Date.now() + 60_000;

describe('ingestCommits', () => {
  // Vercel logs only what the function prints, not a scheduled run's response
  // body, so the loop's log lines are behavior under test (and kept off stdout).
  let logs: string[];
  let errorLogs: string[];
  beforeEach(() => {
    logs = [];
    errorLogs = [];
    mock.method(console, 'log', (...args: unknown[]) => { logs.push(args.join(' ')); });
    mock.method(console, 'error', (...args: unknown[]) => { errorLogs.push(args.join(' ')); });
  });
  afterEach(() => mock.restoreAll());

  it('logs each file before ingesting it, so a killed run names the file in flight', async () => {
    const { steps } = fake();
    const ingestFile = steps.ingestFile;
    const loggedFirst: boolean[] = [];
    steps.ingestFile = async (c, f) => {
      loggedFirst.push(logs.at(-1) === `[cron] ${c.sha.substring(0, 8)} ${f.filename}`);
      return ingestFile(c, f);
    };
    await ingestCommits(commits('ab'), later(), steps);
    assert.deepEqual(logs, ['[cron] a0000000 a.md', '[cron] b0000000 b.md']);
    assert.deepEqual(loggedFirst, [true, true]);
  });

  it('logs each error when it happens, before the next commit starts', async () => {
    const { steps } = fake({ failFile: 'b.md', failCommit: 'c' });
    const getFiles = steps.getFiles;
    let loggedBeforeC: string[] = [];
    steps.getFiles = async c => {
      if (id(c.sha) === 'c') loggedBeforeC = [...errorLogs];
      return getFiles(c);
    };
    await ingestCommits(commits('abc'), later(), steps);
    assert.deepEqual(loggedBeforeC, ['[cron] b0000000 b.md: Error: insert failed']);
    assert.deepEqual(errorLogs, [
      '[cron] b0000000 b.md: Error: insert failed',
      '[cron] c0000000: Error: GitHub 502',
    ]);
  });

  it('advances the cursor after each fully ingested commit, in order', async () => {
    const { steps, saved } = fake();
    const r = await ingestCommits(commits('abc'), later(), steps);
    assert.deepEqual(saved, ['a', 'b', 'c']);
    assert.equal(r.advanced, 3);
    assert.equal(r.newChanges, 3);
    assert.deepEqual(r.errors, []);
  });

  it('pins the cursor before a failed file but still ingests later commits', async () => {
    const { steps, saved, ingested } = fake({ failFile: 'b.md' });
    const r = await ingestCommits(commits('abc'), later(), steps);
    assert.deepEqual(saved, ['a']);
    assert.deepEqual(ingested, ['a.md', 'c.md']);
    assert.equal(r.advanced, 1);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /^b0000000 b\.md: Error: insert failed$/);
  });

  it('keeps the stored files of a partly failed commit and pins before it', async () => {
    const { steps, saved, ingested } = fake({ files: { b: ['b1.md', 'b2.md'] }, failFile: 'b2.md' });
    const r = await ingestCommits(commits('ab'), later(), steps);
    assert.deepEqual(ingested, ['a.md', 'b1.md']);
    assert.deepEqual(saved, ['a']);
    assert.equal(r.advanced, 1);
  });

  it("pins the cursor when listing a commit's files fails", async () => {
    const { steps, saved, ingested } = fake({ failCommit: 'b' });
    const r = await ingestCommits(commits('abc'), later(), steps);
    assert.deepEqual(saved, ['a']);
    assert.deepEqual(ingested, ['a.md', 'c.md']);
    assert.match(r.errors[0], /^b0000000: Error: GitHub 502$/);
  });

  it('moves past commits that touch no tracked files', async () => {
    const { steps, saved } = fake({ files: { b: [] } });
    const r = await ingestCommits(commits('abc'), later(), steps);
    assert.deepEqual(saved, ['a', 'b', 'c']);
    assert.equal(r.newChanges, 2);
  });

  it('counts only newly stored rows as new changes', async () => {
    const { steps, saved } = fake({ alreadyStored: 'a.md' });
    const r = await ingestCommits(commits('ab'), later(), steps);
    assert.equal(r.newChanges, 1);
    assert.deepEqual(saved, ['a', 'b']);
  });

  it('stops starting commits after the deadline and leaves the rest pending', async () => {
    const { steps, saved, ingested } = fake({ slowCommit: 'a' });
    const r = await ingestCommits(commits('abc'), Date.now() + 30, steps);
    assert.deepEqual(ingested, ['a.md']);
    assert.deepEqual(saved, ['a']);
    assert.equal(r.advanced, 1);
  });

  it('lets a cursor-save failure propagate so the caller reports the repo', async () => {
    const { steps } = fake({ failSave: true });
    await assert.rejects(ingestCommits(commits('a'), later(), steps), /DB unreachable/);
  });
});

describe('runBudgetMs', () => {
  it('leaves a minute for the commit in flight at the 300s limit', () => {
    assert.equal(runBudgetMs(300), 240_000);
  });

  it("still leaves time to work at Hobby's 60s limit without Fluid compute", () => {
    assert.equal(runBudgetMs(60), 30_000);
  });
});
