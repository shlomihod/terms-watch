import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    // Validate ID format (must be exactly 8 characters)
    if (!id || id.length !== 8) {
      return NextResponse.json(
        { error: 'Invalid ID format. Expected 8-character commit ID.' },
        { status: 400 }
      );
    }

    // Query database for change with ID starting with the provided prefix
    const change = await prisma.change.findFirst({
      where: {
        id: {
          startsWith: id,
        },
      },
    });

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
