import { NextRequest, NextResponse } from 'next/server';
import { service, ServiceError } from '@/lib/service';
import { generateQuotePdf } from '@/lib/pdf';
import { getRequestAccessError } from '@/lib/request-access';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const accessError = getRequestAccessError(req.headers, req.method);
  if (accessError) return NextResponse.json({ error: accessError }, { status: 403 });
  try {
    const { id } = await context.params;
    const quote = await service.getQuote(id);
    const pdf = await generateQuotePdf(quote);
    return new NextResponse(new Uint8Array(pdf), { headers: {
      'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${quote.number}.pdf"`,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Quote PDF generation failed');
    return NextResponse.json({ error: 'PDF 產生失敗，請檢查公司 Logo 與字型檔。' }, { status: 500 });
  }
}
