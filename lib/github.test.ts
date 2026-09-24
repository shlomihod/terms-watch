import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listNewCommits, getCommitFiles } from './github';

// Live, read-only checks against real Open Terms Archive history that contains
// backdated commits. They need GITHUB_TOKEN (from .env):
//   set -a && source .env && set +a && npm test
const skip = process.env.GITHUB_TOKEN ? false : 'GITHUB_TOKEN not set';
const prefixes = (r: { commits: { sha: string }[] }) => r.commits.map(c => c.sha.substring(0, 8));

describe('listNewCommits', { skip }, () => {
  it('returns the commits behind a backdated head', async () => {
    // ab4040b2, the newest of these four, is dated a day before it was pushed.
    const r = await listNewCommits(
      'pga-versions',
      '7f9fbedca479783e1f79576657aeae15425533e4',
      new Date('2026-09-23T13:35:02Z')
    );
    assert.equal(r.mode, 'cursor');
    assert.deepEqual(prefixes(r).slice(0, 4), ['7f527330', 'c5686e7b', '8c0b00ca', 'ab4040b2']);
  });

  it('returns the commits hidden behind a backdated commit mid-push', async () => {
    // cf61ead3 is backdated (dated 10:35) and sits in front of the newer 388ce092
    // and 547fc4a7.
    const r = await listNewCommits(
      'genai-eu-versions',
      '24a39e2e7e65e1cf54868d0ace239dd42a4ad578',
      new Date('2026-09-21T13:35:15Z')
    );
    assert.deepEqual(prefixes(r).slice(0, 7), [
      '547fc4a7', '388ce092', 'cf61ead3', 'a458022d', '885c7d5a', '8df62b90', '696eac30',
    ]);
  });

  it('pages oldest first, 100 per call, starting right after the cursor', async () => {
    const cursor = '10f386de4f21b6a23ce411deef3bddc8875d461a';
    const r = await listNewCommits('pga-versions', cursor, new Date());
    assert.equal(r.commits.length, 100);
    assert.ok(r.total > 100);
    assert.equal(r.commits[0].parentSha, cursor);
    assert.equal(prefixes(r)[0], 'e0f18491');
  });

  it('starts from checkedAt when lastCommitSha is a placeholder, without date truncation', async () => {
    // scripts/reset-database.ts writes 'reset-for-full-fetch'; clean-database.ts writes 'initial'.
    const r = await listNewCommits('pga-versions', 'reset-for-full-fetch', new Date('2026-09-23T00:00:00Z'));
    assert.equal(r.mode, 'start-date');
    assert.deepEqual(prefixes(r).slice(0, 5), ['7f9fbedc', '7f527330', 'c5686e7b', '8c0b00ca', 'ab4040b2']);
  });

  it('re-lists 7 days before checkedAt when the cursor is no longer in history', async () => {
    // Fixed checkedAt so the test doesn't depend on recent upstream activity.
    const checkedAt = new Date('2026-09-24T00:00:00Z');
    const r = await listNewCommits('pga-versions', '0'.repeat(40), checkedAt);
    assert.equal(r.mode, 'rewritten');
    assert.ok(prefixes(r).includes('ab4040b2')); // dated 2026-09-23, inside the window
    const floor = checkedAt.getTime() - 7 * 86_400_000;
    assert.ok(r.commits.every(c => c.date.getTime() >= floor));
  });
});

describe('getCommitFiles', { skip }, () => {
  it('returns the tracked markdown files of a commit', async () => {
    const files = await getCommitFiles('pga-versions', 'ab4040b2ca82f7541251b42a5dae7afae148c5ed');
    assert.deepEqual(
      files.map(f => [f.filename, f.service, f.documentType, f.category]),
      [['TikTok/Content Monetisation Policy.md', 'TikTok', 'Content Monetisation Policy', 'social']]
    );
  });
});
