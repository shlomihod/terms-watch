import { PrismaClient } from '@prisma/client';
import { getRepoList } from '../lib/github';

const prisma = new PrismaClient();

async function cleanDatabase() {
  try {
    console.log('🧹 Cleaning database...');

    // Delete all changes (keeping LastCheck intact)
    const deleteResult = await prisma.change.deleteMany({});
    console.log(`✓ Deleted ${deleteResult.count} change records`);

    // Verify LastCheck dates
    const lastChecks = await prisma.lastCheck.findMany();
    console.log('\n📅 Current LastCheck dates:');
    lastChecks.forEach(check => {
      console.log(`  - ${check.repo}: ${check.checkedAt.toISOString()}`);
    });

    // If for some reason LastCheck records are missing, recreate them
    if (lastChecks.length === 0) {
      console.log('\n⚠️  No LastCheck records found, creating them...');
      const checkDate = new Date('2025-01-01T00:00:00Z');
      const repos = await getRepoList();

      await prisma.lastCheck.createMany({
        data: repos.map(repo => ({
          id: `lastcheck-${repo.repo}`,
          repo: repo.repo,
          lastCommitSha: 'initial',
          checkedAt: checkDate,
        })),
      });
      console.log('✓ Created LastCheck records set to Jan 1, 2025');
    }

    console.log('\n✨ Database cleaned successfully!');
    console.log('LastCheck dates preserved.');
    console.log('Ready for fresh data fetch.');
  } catch (error) {
    console.error('❌ Error cleaning database:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

cleanDatabase();
