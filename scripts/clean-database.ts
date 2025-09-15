import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanDatabase() {
  try {
    console.log('🧹 Cleaning database...');
    
    // Delete all changes (keeping LastCheck intact)
    const deleteResult = await prisma.change.deleteMany({});
    console.log(`✓ Deleted ${deleteResult.count} change records`);
    
    // Verify LastCheck dates are still at Aug 1, 2025
    const lastChecks = await prisma.lastCheck.findMany();
    console.log('\n📅 Current LastCheck dates:');
    lastChecks.forEach(check => {
      console.log(`  - ${check.repo}: ${check.checkedAt.toISOString()}`);
    });
    
    // If for some reason LastCheck records are missing, recreate them
    if (lastChecks.length === 0) {
      console.log('\n⚠️  No LastCheck records found, creating them...');
      const checkDate = new Date('2025-08-01T00:00:00Z');
      
      await prisma.lastCheck.createMany({
        data: [
          {
            id: 'lastcheck-pga',
            repo: 'pga-versions',
            lastCommitSha: 'initial',
            checkedAt: checkDate,
          },
          {
            id: 'lastcheck-genai',
            repo: 'GenAI-versions',
            lastCommitSha: 'initial',
            checkedAt: checkDate,
          },
        ],
      });
      console.log('✓ Created LastCheck records set to Aug 1, 2025');
    }
    
    console.log('\n✨ Database cleaned successfully!');
    console.log('LastCheck dates preserved at Aug 1, 2025');
    console.log('Ready for fresh data fetch from that date forward.');
  } catch (error) {
    console.error('❌ Error cleaning database:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

cleanDatabase();