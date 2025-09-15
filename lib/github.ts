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
    repo: 'GenAI-versions',
    category: 'ai' as const,
  },
];

export async function getLatestCommits(repo: string, since?: string): Promise<CommitInfo[]> {
  const repoInfo = REPOS.find(r => r.repo === repo);
  if (!repoInfo) throw new Error(`Unknown repo: ${repo}`);

  try {
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

    if (since) {
      params.since = since;
    }

    const commits = await octokit.paginate(octokit.repos.listCommits, params);
    
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
              service: formatServiceName(service),
              documentType: formatDocumentType(documentName),
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

function formatServiceName(name: string): string {
  // Handle special cases
  const serviceMap: Record<string, string> = {
    'facebook': 'Facebook',
    'instagram': 'Instagram',
    'x': 'X',
    'twitter': 'X',
    'youtube': 'YouTube',
    'tiktok': 'TikTok',
    'linkedin': 'LinkedIn',
    'snapchat': 'Snapchat',
    'pinterest': 'Pinterest',
    'reddit': 'Reddit',
    'whatsapp': 'WhatsApp',
    'chatgpt': 'ChatGPT',
    'claude.ai': 'Claude',
    'claude': 'Claude',
    'cursor': 'Cursor',
    'github copilot': 'GitHub Copilot',
    'github-copilot': 'GitHub Copilot',
    'bard': 'Google Bard',
    'midjourney': 'Midjourney',
    'dall-e': 'DALL-E',
    'perplexity': 'Perplexity',
    'copilot': 'Microsoft Copilot',
  };

  const lower = name.toLowerCase();
  return serviceMap[lower] || name.split('-').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');
}

function formatDocumentType(name: string): string {
  // Handle common document types
  const typeMap: Record<string, string> = {
    'terms': 'Terms of Service',
    'terms-of-service': 'Terms of Service',
    'privacy': 'Privacy Policy',
    'privacy-policy': 'Privacy Policy',
    'community-guidelines': 'Community Guidelines',
    'guidelines': 'Community Guidelines',
    'cookies': 'Cookie Policy',
    'cookie-policy': 'Cookie Policy',
    'data-policy': 'Data Policy',
    'acceptable-use': 'Acceptable Use Policy',
    'developer-terms': 'Developer Terms',
    'api-terms': 'API Terms',
  };

  const lower = name.toLowerCase();
  return typeMap[lower] || name.split('-').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');
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