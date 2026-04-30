import { NextResponse } from 'next/server';
import { Feed } from 'feed';
import escapeHtml from 'escape-html';
import { prisma } from '@/lib/db';
import { RSS_FEED_SIZE } from '@/lib/constants';

export async function GET() {
  try {
    // Fetch latest changes for RSS feed
    const changes = await prisma.change.findMany({
      orderBy: { commitDate: 'desc' },
      take: RSS_FEED_SIZE,
      where: {
        processed: true,
        isMinorChange: false, // Exclude minor changes from RSS feed
      },
    });

    const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://terms-watch.vercel.app';
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
        json: `${siteUrl}/api/feed`, // Keep reference to old JSON feed if needed
        atom: `${siteUrl}/api/atom`, // Future atom feed if needed
      },
      author: {
        name: 'Terms Watch',
        link: siteUrl,
      },
    });

    // Add each change as a feed item
    changes.forEach(change => {
      // Extract commit ID (first 8 chars) for anchor link
      const commitId = change.id.substring(0, 8);

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

      feed.addItem({
        title: `${change.service} - ${change.documentType}`,
        id: change.id,
        link: `${siteUrl}/change/${commitId}`,
        description: change.diffSummary || `${change.service} updated their ${change.documentType}`,
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
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to generate RSS feed' },
      { status: 500 }
    );
  }
}