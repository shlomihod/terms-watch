import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get('category');
    const service = searchParams.get('service');
    const documentType = searchParams.get('documentType');

    // Build where clause for services (filtered by category + documentType)
    const servicesWhere: Record<string, unknown> = {};
    if (category && category !== 'all') {
      servicesWhere.category = category;
    }
    if (documentType) {
      servicesWhere.documentType = documentType;
    }

    // Build where clause for document types (filtered by category + service)
    const documentTypesWhere: Record<string, unknown> = {};
    if (category && category !== 'all') {
      documentTypesWhere.category = category;
    }
    if (service) {
      documentTypesWhere.service = service;
    }

    // Get distinct services and document types with appropriate filters
    const services = await prisma.change.findMany({
      where: servicesWhere,
      distinct: ['service'],
      select: { service: true },
      orderBy: { service: 'asc' },
    });

    const documentTypes = await prisma.change.findMany({
      where: documentTypesWhere,
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