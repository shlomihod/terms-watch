import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get('category');

    // Build where clause for category filtering
    const where: Record<string, unknown> = {};
    if (category && category !== 'all') {
      where.category = category;
    }

    // Get distinct services and document types for the selected category
    const services = await prisma.change.findMany({
      where,
      distinct: ['service'],
      select: { service: true },
      orderBy: { service: 'asc' },
    });

    const documentTypes = await prisma.change.findMany({
      where,
      distinct: ['documentType'],
      select: { documentType: true },
      orderBy: { documentType: 'asc' },
    });

    return NextResponse.json({
      services: services.map(s => s.service),
      documentTypes: documentTypes.map(dt => dt.documentType),
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch filter options' },
      { status: 500 }
    );
  }
}