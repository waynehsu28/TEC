import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { service, ServiceError } from '@/lib/service';
import { getRequestAccessError } from '@/lib/request-access';
import { dateSchema, customsRateSideSchema } from '@/lib/validation';
import { CustomsRateError } from '@/lib/customs-exchange-rate';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handler(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try {
    const accessError = getRequestAccessError(req.headers, req.method);
    if (accessError) throw new ServiceError(accessError, 403);
    const write = req.method !== 'GET';
    const { path } = await context.params;
    const [resource, id] = path;
    if (path.length > 2) throw new ServiceError('找不到此 API', 404);
    let body: unknown;
    if (write) {
      const declared = Number(req.headers.get('content-length') ?? '0');
      if (!Number.isFinite(declared) || declared > 4_000_000) throw new ServiceError('資料超過大小限制', 413);
      const text = await req.text();
      if (Buffer.byteLength(text, 'utf8') > 4_000_000) throw new ServiceError('資料超過大小限制', 413);
      try { body = JSON.parse(text); } catch { throw new ServiceError('無效的 JSON 資料'); }
    }
    let result: unknown;
    if (resource === 'customers') {
      if (req.method === 'GET' && !id) result = await service.getCustomers();
      else if (req.method === 'POST' && !id) result = await service.createCustomer(body);
      else if (req.method === 'PUT' && id) result = await service.updateCustomer(id, body);
      else throw new ServiceError('不支援此操作', 405);
    } else if (resource === 'contracts') {
      if (req.method === 'GET' && !id) result = await service.getContracts(req.nextUrl.searchParams.get('customerId') ?? undefined);
      else if (req.method === 'POST' && !id) result = await service.createContract(body);
      else if (req.method === 'PUT' && id) result = await service.updateContract(id, body);
      else throw new ServiceError('不支援此操作', 405);
    } else if (resource === 'settings' && !id) {
      if (req.method === 'GET') result = await service.getSettings();
      else if (req.method === 'PUT') result = await service.updateSettings(body);
      else throw new ServiceError('不支援此操作', 405);
    } else if (resource === 'customs-exchange-rate' && req.method === 'GET' && !id) {
      const date = dateSchema.parse(req.nextUrl.searchParams.get('date') ?? '');
      const side = customsRateSideSchema.parse(req.nextUrl.searchParams.get('side') ?? 'EXPORT');
      result = await service.getCustomsExchangeRate(date, side);
    } else if (resource === 'match' && req.method === 'POST' && !id) result = await service.match(body);
    else if (resource === 'preview' && req.method === 'POST' && !id) result = await service.preview(body);
    else if (resource === 'quotes') {
      if (req.method === 'GET') result = id ? await service.getQuote(id) : await service.getQuotes();
      else if (req.method === 'POST' && !id) result = await service.createQuote(body);
      else throw new ServiceError('不支援此操作', 405);
    } else throw new ServiceError('找不到此 API', 404);
    return NextResponse.json(result, { status: req.method === 'POST' && (resource === 'customers' || resource === 'contracts' || resource === 'quotes') ? 201 : 200 });
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join('；') }, { status: 400 });
    if (error instanceof CustomsRateError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') return NextResponse.json({ error: '代碼、合約編號或版本已存在，請重新確認。' }, { status: 409 });
      if (error.code === 'P2025') return NextResponse.json({ error: '找不到指定資料' }, { status: 404 });
    }
    // Domain engine rejects unsupported rate conditions with ordinary Error objects.
    if (error instanceof Error && !(error instanceof Prisma.PrismaClientKnownRequestError) && !(error instanceof Prisma.PrismaClientInitializationError)) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('Quotation API database operation failed');
    return NextResponse.json({ error: '資料庫操作失敗，請確認已執行 npm run db:setup。' }, { status: 500 });
  }
}
export { handler as GET, handler as POST, handler as PUT };
