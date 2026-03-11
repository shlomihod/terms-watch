import { Octokit } from '@octokit/rest';
import { createPatch } from 'diff';

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

export interface CommitInfo {
  sha: string;
  parentSha?: string;
  date: Date;
  url: string;
  files: FileChange[];
}

export interface FileChange {
  filename: string;
  patch?: string;
  status?: 'added' | 'removed' | 'modified' | 'renamed';
  service: string;
  documentType: string;
  category: 'social' | 'ai';
}

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

export async function getLatestCommits(repo: string, since?: string): Promise<CommitInfo[]> {
  const repoInfo = REPOS.find(r => r.repo === repo);
  if (!repoInfo) throw new Error(`Unknown repo: ${repo}`);

  try {
    const sinceDate = since ? new Date(since) : null;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Determine if this is a historical backfill or incremental update
    // GitHub API 'since' param filters by committer date, not author date
    // For repos that were rebased/restructured, this causes old commits to be missed
    // So for historical backfills (>30 days), we fetch all and filter by author date
    const isHistoricalBackfill = sinceDate && sinceDate < thirtyDaysAgo;

    const params: {
      owner: string;
      repo: string;
      per_page: number;
      since?: string;
    } = {
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      per_page: 100,
    };

    // Only use 'since' param for recent dates (incremental updates)
    if (since && !isHistoricalBackfill) {
      params.since = since;
    }

    const allCommits = await octokit.paginate(octokit.repos.listCommits, params);

    // For historical backfill, filter by author date in code
    const commits = (isHistoricalBackfill && sinceDate)
      ? allCommits.filter(c => new Date(c.commit.author?.date || '') >= sinceDate)
      : allCommits;

    const commitInfos: CommitInfo[] = [];

    for (const commit of commits) {
      // Get full commit details with file changes
      const { data: fullCommit } = await octokit.repos.getCommit({
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        ref: commit.sha,
      });

      const files: FileChange[] = [];
      
      for (const file of fullCommit.files || []) {
        if (file.filename.endsWith('.md')) {
          const parts = file.filename.split('/');
          if (parts.length >= 2) {
            const service = parts[0];
            const documentName = parts[parts.length - 1].replace('.md', '');
            
            files.push({
              filename: file.filename,
              patch: file.patch,
              status: file.status as 'added' | 'removed' | 'modified' | 'renamed',
              service,
              documentType: documentName,
              category: repoInfo.category,
            });
          }
        }
      }

      if (files.length > 0) {
        commitInfos.push({
          sha: commit.sha,
          parentSha: commit.parents?.[0]?.sha,
          date: new Date(commit.commit.committer?.date || ''),
          url: fullCommit.html_url,
          files,
        });
      }
    }

    return commitInfos;
  } catch (error) {
    throw error;
  }
}


export async function getRepoList() {
  return REPOS;
}

export async function fetchFileDiff(
  repo: string,
  filePath: string,
  currentCommitSha: string,
  parentCommitSha: string
): Promise<string | null> {
  try {
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
  } catch (error) {
    return null;
  }
}