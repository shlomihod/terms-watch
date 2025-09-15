import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get('category');
    const service = searchParams.get('service');
    const documentType = searchParams.get('documentType');
    const days = searchParams.get('days');
    const includeFormattingOnly = searchParams.get('includeFormattingOnly') === 'true';
    const limit = parseInt(searchParams.get('limit') || '200');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Build where clause
    const where: Record<string, unknown> = {};
    
    if (category && category !== 'all') {
      where.category = category;
    }
    
    if (service) {
      where.service = service;
    }
    
    if (documentType) {
      where.documentType = documentType;
    }
    
    if (days) {
      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - parseInt(days));
      where.commitDate = {
        gte: daysAgo,
      };
    }
    
    // Filter formatting-only changes
    if (!includeFormattingOnly) {
      where.isMinorChange = false;
    }

    // Fetch changes
    const changes = await prisma.change.findMany({
      where,
      orderBy: { commitDate: 'desc' },
      take: limit,
      skip: offset,
    });

    // Get total count for pagination
    const total = await prisma.change.count({ where });

    // Transform dates to strings for JSON serialization
    const serializedChanges = changes.map(change => ({
      ...change,
      commitDate: change.commitDate.toISOString(),
      createdAt: change.createdAt.toISOString(),
    }));

    return NextResponse.json({
      changes: serializedChanges,
      total,
      limit,
      offset,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch changes' },
      { status: 500 }
    );
  }
}