import { NextRequest, NextResponse } from 'next/server';
import { getFilterOptions } from '@/lib/data';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const options = await getFilterOptions({
    category: searchParams.get('category') ?? undefined,
    service: searchParams.get('service') ?? undefined,
    documentType: searchParams.get('documentType') ?? undefined,
  });

  return NextResponse.json(options);
}
