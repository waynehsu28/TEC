import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DELETE } from '../src/app/api/[...path]/route';
import { GET as pdf } from '../src/app/api/quotes/[id]/pdf/route';
import { service, ServiceError } from '../src/lib/service';

const context = (path: string[]) => ({ params: Promise.resolve({ path }) });
const result = { id: 'delete-target', number: 'AFQ-20261106-0001-R002', revision: 2 };
const localHeaders = { host: 'localhost:3000', origin: 'http://localhost:3000' };

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('quote DELETE API', () => {
  it.each([undefined, 'not json'])('deletes only the URL target without requiring or parsing a JSON body (%s)', async body => {
    const remove = vi.spyOn(service, 'deleteQuote').mockResolvedValue(result);
    const request = new NextRequest('http://localhost:3000/api/quotes/delete-target', { method: 'DELETE', headers: localHeaders, body });
    const response = await DELETE(request, context(['quotes', result.id]));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(remove).toHaveBeenCalledExactlyOnceWith(result.id);
  });

  it('reports an already deleted or unknown quotation as 404', async () => {
    vi.spyOn(service, 'deleteQuote').mockRejectedValue(new ServiceError('找不到報價', 404));
    const request = new NextRequest('http://localhost:3000/api/quotes/missing', { method: 'DELETE', headers: localHeaders });
    const response = await DELETE(request, context(['quotes', 'missing']));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: '找不到報價' });
  });

  it('does not delete collections or resources other than individual quotes', async () => {
    const remove = vi.spyOn(service, 'deleteQuote').mockResolvedValue(result);
    for (const path of [['quotes'], ['customers', result.id], ['contracts', result.id], ['settings']]) {
      const request = new NextRequest(`http://localhost:3000/api/${path.join('/')}`, { method: 'DELETE', headers: localHeaders });
      expect((await DELETE(request, context(path))).status).toBe(405);
    }
    const invalid = new NextRequest('http://localhost:3000/api/quotes/id/extra', { method: 'DELETE', headers: localHeaders });
    expect((await DELETE(invalid, context(['quotes', 'id', 'extra']))).status).toBe(404);
    expect(remove).not.toHaveBeenCalled();
  });

  it('rejects remote hosts, cross-origin writes and cross-site deletes before touching the service', async () => {
    const remove = vi.spyOn(service, 'deleteQuote').mockResolvedValue(result);
    const unsafe: Record<string, string>[] = [
      { host: 'public.example' },
      { ...localHeaders, origin: 'https://other.example' },
      { ...localHeaders, 'sec-fetch-site': 'cross-site' },
      { ...localHeaders, 'x-forwarded-host': 'other.example' },
    ];
    for (const headers of unsafe) {
      const request = new NextRequest('http://localhost:3000/api/quotes/delete-target', { method: 'DELETE', headers });
      expect((await DELETE(request, context(['quotes', result.id]))).status).toBe(403);
    }
    expect(remove).not.toHaveBeenCalled();
  });

  it('permits the current private Codespaces origin without a body and rejects other workspace headers', async () => {
    vi.stubEnv('CODESPACES', 'true');
    vi.stubEnv('CODESPACE_NAME', 'delete-test-ab12');
    vi.stubEnv('GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN', 'app.github.dev');
    const preview = 'delete-test-ab12-3000.app.github.dev';
    const remove = vi.spyOn(service, 'deleteQuote').mockResolvedValue(result);
    const headers = { host: 'localhost:3000', 'x-forwarded-host': preview, origin: `https://${preview}`, 'sec-fetch-site': 'same-origin' };
    const request = new NextRequest(`https://${preview}/api/quotes/delete-target`, { method: 'DELETE', headers });
    expect((await DELETE(request, context(['quotes', result.id]))).status).toBe(200);
    expect(remove).toHaveBeenCalledExactlyOnceWith(result.id);
    remove.mockClear();
    for (const change of [{ origin: 'https://another-space-3000.app.github.dev' }, { 'x-forwarded-host': 'another-space-3000.app.github.dev' }]) {
      const foreign = new NextRequest(`https://${preview}/api/quotes/delete-target`, { method: 'DELETE', headers: { ...headers, ...change } });
      expect((await DELETE(foreign, context(['quotes', result.id]))).status).toBe(403);
    }
    expect(remove).not.toHaveBeenCalled();
  });

  it('returns 404 for a deleted quote PDF instead of rendering a retained internal snapshot', async () => {
    const getQuote = vi.spyOn(service, 'getQuote').mockRejectedValue(new ServiceError('找不到報價', 404));
    const request = new NextRequest('http://localhost:3000/api/quotes/deleted/pdf', { headers: { host: 'localhost:3000' } });
    const response = await pdf(request, { params: Promise.resolve({ id: 'deleted' }) });
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ error: '找不到報價' });
    expect(getQuote).toHaveBeenCalledExactlyOnceWith('deleted');
  });
});
