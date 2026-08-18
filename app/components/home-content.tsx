import { Feed } from '@/app/components/feed';
import { EmailSubscription } from '@/app/components/email-subscription';
import { ClientLayout } from '@/app/components/client-layout';
import { NotFoundBanner } from '@/app/components/not-found-banner';
import { Bot } from 'lucide-react';

interface Change {
  id: string;
  service: string;
  category: 'social' | 'ai';
  documentType: string;
  commitDate: string;
  commitUrl: string;
  diffContent?: string;
  diffSummary: string | null;
  isMinorChange?: boolean;
}

interface HomeContentProps {
  changes: Change[];
  filterOptions: {
    services: string[];
    documentTypes: string[];
  };
  scrollToCommitId?: string;
  notFound?: boolean;
}

export function HomeContent({ changes, filterOptions, scrollToCommitId, notFound }: HomeContentProps) {
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
                href="https://opentermsarchive.org/en/collections/genai-eu/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-800"
              >
                Generative AI Governance Archive
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
          {notFound && <NotFoundBanner />}
          <Feed
            initialChanges={changes}
            availableServices={filterOptions.services}
            availableDocumentTypes={filterOptions.documentTypes}
            scrollToCommitId={scrollToCommitId}
          />
        </main>
      </div>
    </ClientLayout>
  );
}
