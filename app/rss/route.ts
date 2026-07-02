import { NextResponse } from 'next/server';
import { Feed } from 'feed';
import escapeHtml from 'escape-html';
import { prisma } from '@/lib/db';
import { RSS_FEED_SIZE } from '@/lib/constants';
import { getAppBaseUrl, extractCommitId } from '@/lib/url-utils';

export async function GET() {
  try {
    // Fetch latest changes for RSS feed. Select only the fields rendered below —
    // the feed never includes the raw diff, so fetching diffContent (the widest
    // column) here would be ~290KB of pure waste per request.
    const changes = await prisma.change.findMany({
      orderBy: { commitDate: 'desc' },
      take: RSS_FEED_SIZE,
      where: {
        processed: true,
        isMinorChange: false, // Exclude minor changes from RSS feed
      },
      select: {
        id: true,
        service: true,
        documentType: true,
        category: true,
        commitDate: true,
        diffSummary: true,
      },
    });

    const siteUrl = getAppBaseUrl();
    const feedUrl = `${siteUrl}/rss`;

    // Create feed instance with site metadata
    const feed = new Feed({
      title: 'Terms Watch',
      description: 'Track changes to Terms of Service across major platforms',
      id: siteUrl,
      link: siteUrl,
      language: 'en',
      image: `${siteUrl}/favicon.ico`,
      favicon: `${siteUrl}/favicon.ico`,
      copyright: `All rights reserved ${new Date().getFullYear()}, Terms Watch`,
      updated: changes.length > 0 ? changes[0].commitDate : new Date(),
      generator: 'Feed for Node.js',
      feedLinks: {
        rss2: feedUrl,
      },
      author: {
        name: 'Terms Watch',
        link: siteUrl,
      },
    });

    // Add each change as a feed item
    changes.forEach(change => {
      // Extract commit ID (first 8 chars) for anchor link
      const commitId = extractCommitId(change.id);

      // DB-derived fields (service, documentType, diffSummary) originate from
      // upstream commits and LLM output and end up rendered as HTML by feed
      // readers, so they must be HTML-escaped before interpolation.
      const service = escapeHtml(change.service);
      const documentType = escapeHtml(change.documentType);
      const categoryLabel = change.category === 'ai' ? 'AI Services' : 'Social Media';
      const diffSummary = change.diffSummary ? escapeHtml(change.diffSummary) : null;

      const htmlContent = `
        <div>
          <h3>${service} - ${documentType}</h3>
          <p><strong>Category:</strong> ${categoryLabel}</p>
          <p><strong>Date:</strong> ${change.commitDate.toLocaleDateString()}</p>${diffSummary ? `
          <div>
            <h4>Summary of Changes:</h4>
            <p>${diffSummary}</p>
          </div>` : `
          <p>${service} updated their ${documentType}</p>`}
        </div>
      `.trim();

      // The feed lib emits title/description raw inside CDATA. Readers render
      // description as HTML, so it must use the escaped values (like content
      // does); titles are plain text in readers, so entity-escaping would show
      // literally — strip tag-forming chars instead.
      feed.addItem({
        title: `${change.service} - ${change.documentType}`.replace(/[<>]/g, ''),
        id: change.id,
        link: `${siteUrl}/change/${commitId}`,
        description: diffSummary || `${service} updated their ${documentType}`,
        content: htmlContent,
        date: change.commitDate,
        published: change.commitDate,
        category: [
          { name: categoryLabel },
          { name: change.documentType },
          { name: change.service },
        ],
      });
    });

    // Generate RSS 2.0 XML
    const rss = feed.rss2();

    // Return with proper content type
    return new NextResponse(rss, {
      status: 200,
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        // s-maxage lets Vercel's edge cache serve the feed, so most reader polls
        // never reach the DB (plain max-age is browser-only and would not be
        // edge-cached). stale-while-revalidate refreshes it in the background;
        // stale-if-error keeps serving the last good feed if the DB is down.
        'Cache-Control':
          'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=86400',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to generate RSS feed' },
      { status: 500 }
    );
  }
}