import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Change ids are "<sha8>-<sanitized-filename>-<timestamp>", all within
    // [a-zA-Z0-9-]. Reject anything off that charset and bound the length.
    if (!id || id.length > 80 || !/^[a-zA-Z0-9-]+$/.test(id)) {
      return NextResponse.json(
        { error: 'Invalid ID format.' },
        { status: 400 }
      );
    }

    // A full change id is unique → exact match. A bare 8-char commit-SHA prefix
    // (share links) can match several rows from the same commit, so resolve it
    // deterministically to the most recent rather than an arbitrary sibling.
    const change =
      id.length === 8
        ? await prisma.change.findFirst({
            where: { id: { startsWith: id } },
            orderBy: { commitDate: 'desc' },
          })
        : await prisma.change.findUnique({ where: { id } });

    // Return 404 if no change found
    if (!change) {
      return NextResponse.json(
        { error: 'Change not found' },
        { status: 404 }
      );
    }

    // Transform dates to strings for JSON serialization
    const serializedChange = {
      ...change,
      commitDate: change.commitDate.toISOString(),
      createdAt: change.createdAt.toISOString(),
    };

    return NextResponse.json(serializedChange);
  } catch (error) {
    console.error('Error fetching change:', error);
    return NextResponse.json(
      { error: 'Failed to fetch change' },
      { status: 500 }
    );
  }
}
