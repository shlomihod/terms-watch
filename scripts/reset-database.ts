import { prisma } from '../lib/db';
import { getRepoList } from '../lib/github';

async function resetForCron() {
  try {
    console.log('🧹 Clearing all changes from database...');
    const deletedCount = await prisma.change.deleteMany({});
    console.log(`   ✓ Deleted ${deletedCount.count} changes\n`);

    console.log('📅 Resetting LastCheck dates to January 1, 2025...');

    const repos = await getRepoList();

    for (const repo of repos) {
      await prisma.lastCheck.upsert({
        where: { repo: repo.repo },
        update: {
          checkedAt: new Date('2025-01-01T00:00:00Z'),
          lastCommitSha: 'reset-for-full-fetch'
        },
        create: {
          id: `lastcheck-${repo.repo}`,
          repo: repo.repo,
          checkedAt: new Date('2025-01-01T00:00:00Z'),
          lastCommitSha: 'reset-for-full-fetch'
        },
      });
      console.log(`   ✓ Reset ${repo.repo} to January 1, 2025`);
    }

    console.log('\n✨ Database ready for cron job!');
    console.log('\nNext step: Call the cron endpoint from your dev server:');
    console.log('curl -X GET "http://localhost:3000/api/cron" \\');
    console.log('  -H "Authorization: Bearer YOUR_CRON_SECRET"');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

resetForCron();
