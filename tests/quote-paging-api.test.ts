import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../src/app/api/[...path]/route';
import { service } from '../src/lib/service';
import { quoteRecord } from './fixtures/quotation';

const context = (path: string[]) => ({ params: Promise.resolve({ path }) });
const emptyPage = { items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 };
function request(path = 'quotes', query = '', headers: Record<string, string> = { host: 'localhost:3000' }) {
  return new NextRequest(`http://localhost:3000/api/${path}${query ? `?${query}` : ''}`, { headers });
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('bounded quotation collection API', () => {
  it('returns a paginated collection with validated defaults rather than the legacy unbounded list', async () => {
    const list = vi.spyOn(service, 'listQuotes').mockResolvedValue(emptyPage);
    const legacy = vi.spyOn(service, 'getQuotes');
    const response = await GET(request(), context(['quotes']));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(emptyPage);
    expect(list).toHaveBeenCalledExactlyOnceWith({ page: 1, pageSize: 20, q: '', customerId: '', status: '', transportMode: '' });
    expect(legacy).not.toHaveBeenCalled();
  });

  it('passes intersecting filters, trimmed Unicode text and literal punctuation to the bounded service', async () => {
    const page = { ...emptyPage, page: 2, pageSize: 50, total: 72, totalPages: 2 };
    const list = vi.spyOn(service, 'listQuotes').mockResolvedValue(page);
    const q = " 美國 %_' OR 1=1 -- ";
    const query = new URLSearchParams({ page: '2', pageSize: '50', q, customerId: 'customer-a', status: 'Accepted', transportMode: 'SEA' });
    const response = await GET(request('quotes', query.toString()), context(['quotes']));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(page);
    expect(list).toHaveBeenCalledExactlyOnceWith({ page: 2, pageSize: 50, q: q.trim(), customerId: 'customer-a', status: 'Accepted', transportMode: 'SEA' });
  });

  it('routes overview to its aggregate endpoint while preserving on-demand full record retrieval', async () => {
    const overview = { total: 237, quoted: 71, accepted: 128, recent: [] };
    const aggregate = vi.spyOn(service, 'getQuoteOverview').mockResolvedValue(overview);
    const detail = vi.spyOn(service, 'getQuote').mockResolvedValue(quoteRecord());
    const list = vi.spyOn(service, 'listQuotes').mockResolvedValue(emptyPage);

    const overviewResponse = await GET(request('quotes/overview'), context(['quotes', 'overview']));
    expect(overviewResponse.status).toBe(200);
    expect(await overviewResponse.json()).toEqual(overview);
    expect(aggregate).toHaveBeenCalledExactlyOnceWith();
    expect(detail).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();

    const detailResponse = await GET(request('quotes/test-quote'), context(['quotes', 'test-quote']));
    expect(detailResponse.status).toBe(200);
    expect(await detailResponse.json()).toEqual(quoteRecord());
    expect(detail).toHaveBeenCalledExactlyOnceWith('test-quote');
  });

  it('rejects invalid, excessive and ambiguous query values before running a list query', async () => {
    const list = vi.spyOn(service, 'listQuotes').mockResolvedValue(emptyPage);
    const invalid = [
      'page=0', 'page=-1', 'page=1.5', 'page=1000001', 'page=NaN',
      'pageSize=0', 'pageSize=21', 'pageSize=101', 'pageSize=50000',
      'status=accepted', 'status=Deleted', 'transportMode=RAIL',
      `q=${'字'.repeat(121)}`, `customerId=${'a'.repeat(101)}`,
      'page=1&page=2', 'page=1&page=1', 'q=a&q=b', 'status=Draft&status=Accepted',
    ];
    for (const query of invalid) {
      const response = await GET(request('quotes', query), context(['quotes']));
      expect(response.status, query).toBe(400);
      expect((await response.json()).error, query).toEqual(expect.any(String));
    }
    expect(list).not.toHaveBeenCalled();
  });

  it('accepts every supported page size and empty optional filters without inventing a cap on the total', async () => {
    const list = vi.spyOn(service, 'listQuotes').mockResolvedValue({ ...emptyPage, total: 100_000, totalPages: 5_000 });
    for (const pageSize of [20, 50, 100]) {
      const response = await GET(request('quotes', `pageSize=${pageSize}&q=&customerId=&status=&transportMode=`), context(['quotes']));
      expect(response.status).toBe(200);
      expect((await response.json()).total).toBe(100_000);
      expect(list).toHaveBeenLastCalledWith({ page: 1, pageSize, q: '', customerId: '', status: '', transportMode: '' });
    }
  });

  it('keeps public and forged forwarded hosts out of both collection and overview before accessing data', async () => {
    const list = vi.spyOn(service, 'listQuotes').mockResolvedValue(emptyPage);
    const overview = vi.spyOn(service, 'getQuoteOverview').mockResolvedValue({ total: 0, quoted: 0, accepted: 0, recent: [] });
    const unsafe: Record<string, string>[] = [{ host: 'public.example' }, { host: 'localhost:3000', 'x-forwarded-host': 'public.example' }];
    for (const headers of unsafe) {
      expect((await GET(request('quotes', 'page=1', headers), context(['quotes']))).status).toBe(403);
      expect((await GET(request('quotes/overview', '', headers), context(['quotes', 'overview']))).status).toBe(403);
    }
    expect(list).not.toHaveBeenCalled();
    expect(overview).not.toHaveBeenCalled();
  });

  it('permits the exact private Codespaces forwarded host and rejects another workspace', async () => {
    vi.stubEnv('CODESPACES', 'true');
    vi.stubEnv('CODESPACE_NAME', 'paging-test-ab12');
    vi.stubEnv('GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN', 'app.github.dev');
    const preview = 'paging-test-ab12-3000.app.github.dev';
    const list = vi.spyOn(service, 'listQuotes').mockResolvedValue(emptyPage);
    const headers = { host: 'localhost:3000', 'x-forwarded-host': preview, origin: `https://${preview}` };
    const allowed = new NextRequest(`https://${preview}/api/quotes?pageSize=20`, { headers });
    expect((await GET(allowed, context(['quotes']))).status).toBe(200);
    expect(list).toHaveBeenCalledOnce();
    list.mockClear();
    const other = new NextRequest(`https://${preview}/api/quotes?pageSize=20`, { headers: { ...headers, 'x-forwarded-host': 'another-space-3000.app.github.dev' } });
    expect((await GET(other, context(['quotes']))).status).toBe(403);
    expect(list).not.toHaveBeenCalled();
  });
});
