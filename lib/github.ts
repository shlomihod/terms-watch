import { Octokit } from '@octokit/rest';
import { createPatch } from 'diff';
import type { RestEndpointMethodTypes } from '@octokit/rest';

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

export interface CommitRef {
  sha: string;
  parentSha?: string;
  date: Date;
  url: string;
}

export interface NewCommits {
  commits: CommitRef[]; // oldest first
  total: number; // commits waiting after the cursor, including any past this page
  mode: 'cursor' | 'start-date' | 'rewritten';
}

type GitHubCommit = RestEndpointMethodTypes['repos']['listCommits']['response']['data'][number];

const SHA_RE = /^[0-9a-f]{40}$/;
const DAY_MS = 86_400_000;
const REWRITE_MARGIN_DAYS = 7;

function toCommitRef(c: GitHubCommit): CommitRef {
  return {
    sha: c.sha,
    parentSha: c.parents[0]?.sha,
    date: new Date(c.commit.committer?.date || ''),
    url: c.html_url,
  };
}

export interface FileChange {
  filename: string;
  patch?: string;
  status?: 'added' | 'removed' | 'modified' | 'renamed';
  service: string;
  documentType: string;
  category: 'social' | 'ai';
}

// To add a repo or switch sources, insert its LastCheck row with a placeholder
// lastCommitSha (e.g. 'start') and checkedAt = the earliest commit date to
// ingest. The cron lists from that date once, then follows the commit cursor.
const REPOS = [
  {
    owner: 'OpenTermsArchive',
    repo: 'pga-versions',
    category: 'social' as const,
  },
  {
    owner: 'OpenTermsArchive',
    repo: 'genai-eu-versions',
    category: 'ai' as const,
  },
];

// Commits after `cursor` (the last fully ingested commit), oldest first. With a
// cursor, compare returns at most 100 per call and the rest come on the next
// run; the date-listing fallbacks below return every match at once.
//
// Never filter with GitHub's `since`: it walks back from the head and stops at the
// first commit older than the cutoff. Open Terms Archive backdates commits (a
// version assembled from several source pages takes an unchanged page's older
// snapshot date, sometimes weeks earlier), so one backdated commit hides every
// newer commit behind it. Compare follows ancestry, so only push order matters.
export async function listNewCommits(
  repo: string,
  cursor: string | undefined,
  checkedAt: Date | undefined
): Promise<NewCommits> {
  const repoInfo = REPOS.find(r => r.repo === repo);
  if (!repoInfo) throw new Error(`Unknown repo: ${repo}`);

  if (cursor && SHA_RE.test(cursor)) {
    try {
      const { data } = await octokit.repos.compareCommitsWithBasehead({
        owner: repoInfo.owner,
        repo,
        basehead: `${cursor}...HEAD`,
        per_page: 100,
        page: 1,
      });
      if (data.status === 'ahead' || data.status === 'identical') {
        return { commits: data.commits.map(toCommitRef), total: data.total_commits, mode: 'cursor' };
      }
      // 'diverged' or 'behind': upstream history was rewritten (force-push).
    } catch (error) {
      // 404: the cursor commit no longer exists upstream (force-push).
      if (!(error && typeof error === 'object' && 'status' in error && error.status === 404)) {
        throw error;
      }
    }
    const since = new Date((checkedAt ?? new Date()).getTime() - REWRITE_MARGIN_DAYS * DAY_MS);
    return { ...(await listCommitsDatedFrom(repoInfo.owner, repo, since)), mode: 'rewritten' };
  }

  // No cursor yet: a new repo, a source switch, or a placeholder written by
  // scripts/reset-database.ts ('reset-for-full-fetch') or clean-database.ts
  // ('initial'). Ingest everything dated from checkedAt; the first commit
  // ingested becomes the cursor.
  const since = checkedAt ?? new Date(Date.now() - REWRITE_MARGIN_DAYS * DAY_MS);
  return { ...(await listCommitsDatedFrom(repoInfo.owner, repo, since)), mode: 'start-date' };
}

// Every commit dated on or after `since`, oldest first. Filters in code instead of
// with the API's `since` (see listNewCommits), paging until a whole page is older.
async function listCommitsDatedFrom(owner: string, repo: string, since: Date) {
  const kept: GitHubCommit[] = [];
  for (let page = 1; ; page++) {
    const { data } = await octokit.repos.listCommits({ owner, repo, per_page: 100, page });
    const recent = data.filter(c => new Date(c.commit.committer?.date || 0) >= since);
    kept.push(...recent);
    if (data.length < 100 || recent.length === 0) break;
  }
  const commits = kept.reverse().map(toCommitRef);
  return { commits, total: commits.length };
}

// The tracked `<Service>/<Document Type>.md` files a commit touches.
export async function getCommitFiles(repo: string, sha: string): Promise<FileChange[]> {
  const repoInfo = REPOS.find(r => r.repo === repo);
  if (!repoInfo) throw new Error(`Unknown repo: ${repo}`);

  const { data } = await octokit.repos.getCommit({ owner: repoInfo.owner, repo, ref: sha });

  const files: FileChange[] = [];
  for (const file of data.files || []) {
    if (file.filename.endsWith('.md')) {
      const parts = file.filename.split('/');
      if (parts.length >= 2) {
        files.push({
          filename: file.filename,
          patch: file.patch,
          status: file.status as FileChange['status'],
          service: parts[0],
          documentType: parts[parts.length - 1].replace('.md', ''),
          category: repoInfo.category,
        });
      }
    }
  }
  return files;
}

export async function getRepoList() {
  return REPOS;
}

// Rebuilds a patch when GitHub omits it (file too large). A 404 means the file
// didn't exist on that side (added/removed); any other GitHub error propagates
// so the cron retries the file instead of storing it without a diff.
export async function fetchFileDiff(
  repo: string,
  filePath: string,
  currentCommitSha: string,
  parentCommitSha: string
): Promise<string | null> {
  // Fetch file content at parent commit (before change)
  let beforeContent = '';
  try {
    const beforeResponse = await octokit.repos.getContent({
      owner: 'OpenTermsArchive',
      repo,
      path: filePath,
      ref: parentCommitSha,
    });

    if ('content' in beforeResponse.data && beforeResponse.data.content) {
      beforeContent = Buffer.from(beforeResponse.data.content, 'base64').toString('utf-8');
    }
  } catch (error) {
    // File might not exist in parent commit (new file)
    if (error && typeof error === 'object' && 'status' in error && error.status !== 404) {
      throw error;
    }
  }

  // Fetch file content at current commit (after change)
  let afterContent = '';
  try {
    const afterResponse = await octokit.repos.getContent({
      owner: 'OpenTermsArchive',
      repo,
      path: filePath,
      ref: currentCommitSha,
    });

    if ('content' in afterResponse.data && afterResponse.data.content) {
      afterContent = Buffer.from(afterResponse.data.content, 'base64').toString('utf-8');
    }
  } catch (error) {
    // File might not exist in current commit (deleted file)
    if (error && typeof error === 'object' && 'status' in error && error.status !== 404) {
      throw error;
    }
  }

  // Generate unified diff patch
  const patch = createPatch(
    filePath,
    beforeContent,
    afterContent,
    'before',
    'after',
    { context: 3 }
  );

  // Remove the header lines to match GitHub's patch format
  const lines = patch.split('\n');
  const patchBody = lines.slice(4).join('\n'); // Skip the header lines

  return patchBody || null;
}
