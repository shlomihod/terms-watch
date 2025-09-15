import { prisma } from '@/lib/db';
import { PAGE_SIZE } from '@/lib/constants';
import { Feed } from '@/app/components/feed';
import { EmailSubscription } from '@/app/components/email-subscription';
import { ClientLayout } from '@/app/components/client-layout';
import { Bot } from 'lucide-react';

// Force dynamic rendering to always fetch fresh data
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs'; // Explicitly use Node.js runtime

async function getChanges() {
  try {
    
    const changes = await prisma.change.findMany({
      where: {
        isMinorChange: false, // By default, don't show minor changes
      },
      orderBy: { commitDate: 'desc' },
      take: PAGE_SIZE, // Initial load for better performance
    });
    
    return changes.map(change => ({
      ...change,
      category: change.category as 'social' | 'ai',
      commitDate: change.commitDate.toISOString(),
      createdAt: change.createdAt.toISOString(),
    }));
  } catch (error) {
    return [];
  }
}

export default async function Home() {
  const changes = await getChanges();

  return (
    <ClientLayout>
      <div className="min-h-screen bg-white">
        <header className="border-b border-gray-200">
          <div className="max-w-6xl mx-auto px-4 py-8">
            <h1 className="font-serif text-4xl font-bold text-gray-900 mb-2">
              Terms Watch
            </h1>
            <p className="text-gray-600 mb-4 leading-relaxed">
              Tracking changes to Terms of Service across major platforms.
              Data sourced from{' '}
              <a
                href="https://opentermsarchive.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-800"
              >
                Open Terms Archive
              </a>
              , monitoring the{' '}
              <a
                href="https://opentermsarchive.org/en/collections/pga/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-800"
              >
                Platform Governance Archive
              </a>
              {' '}and{' '}
              <a
                href="https://opentermsarchive.org/en/collections/genai/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-800"
              >
                Generative AI
              </a>
              {' '}collections.
            </p>
            <div className="flex items-start gap-2 text-sm text-gray-500 bg-gray-50 p-3 rounded-lg mb-6">
              <Bot size={16} className="mt-0.5 flex-shrink-0" />
              <p>
                AI-generated summaries may not capture every detail or may misinterpret changes.
                The AI also filters out minor updates (formatting, URLs, spacing) but may misclassify changes.
                Click &quot;View Diff&quot; for complete information or toggle &quot;Include minor changes&quot; to see all updates.
              </p>
            </div>
            <EmailSubscription />
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 py-8 pb-20">
          <Feed initialChanges={changes} />
        </main>
      </div>
    </ClientLayout>
  );
}