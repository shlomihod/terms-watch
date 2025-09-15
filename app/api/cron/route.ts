import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getLatestCommits, getRepoList, fetchFileDiff } from '@/lib/github';
import { generateSummary } from '@/lib/ai';

// Force dynamic execution (prevent static optimization)
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const repos = await getRepoList();
    const results = {
      processed: 0,
      errors: [] as string[],
      newChanges: 0,
    };

    for (const repo of repos) {
      try {
        // Get last check info
        const lastCheck = await prisma.lastCheck.findUnique({
          where: { repo: repo.repo },
        });

        // Fetch commits since last check
        const commits = await getLatestCommits(
          repo.repo,
          lastCheck?.checkedAt.toISOString()
        );
        for (const commit of commits) {
          // Process each file change in the commit
          for (const file of commit.files) {
            try {
              // Check if we've already processed this specific file in this commit
              const existing = await prisma.change.findFirst({
                where: { 
                  commitSha: commit.sha,
                  filename: file.filename
                },
              });

              if (!existing) {
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
                      repo.repo,
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
                    // Still no patch available (error fetching or no parent commit)
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

                results.newChanges++;
              }
            } catch (error) {
              results.errors.push(`${file.filename}: ${String(error)}`);
            }
          }
        }

        // Update last check
        if (commits.length > 0) {
          const latestCommit = commits[0];
          await prisma.lastCheck.upsert({
            where: { repo: repo.repo },
            create: {
              id: `lastcheck-${repo.repo}`,
              repo: repo.repo,
              lastCommitSha: latestCommit.sha,
              checkedAt: new Date(),
            },
            update: {
              lastCommitSha: latestCommit.sha,
              checkedAt: new Date(),
            },
          });
        }

        results.processed++;
      } catch (error) {
        results.errors.push(`${repo.repo}: ${String(error)}`);
      }
    }

    return NextResponse.json({
      success: true,
      ...results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
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