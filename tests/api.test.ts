import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../src/app/api/[...path]/route';
import { GET as pdf } from '../src/app/api/quotes/[id]/pdf/route';
import { service, ServiceError } from '../src/lib/service';
const context = (path: string[]) => ({ params: Promise.resolve({ path }) });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('local and private Codespaces API request boundaries', () => {
  it('rejects non-loopback hosts before reading data', async () => {
    const req = new NextRequest('http://public.example/api/customers', { headers: { host: 'public.example' } });
    expect((await GET(req, context(['customers']))).status).toBe(403);
  });
  it('rejects cross-origin and cross-site writes', async () => {
    for (const headers of [{ origin: 'https://external.example' }, { 'sec-fetch-site': 'cross-site' }] as Record<string, string>[]) {
      const req = new NextRequest('http://localhost:3000/api/customers', { method: 'POST', headers: { host: 'localhost:3000', ...headers }, body: '{}' });
      expect((await POST(req, context(['customers']))).status).toBe(403);
    }
  });
  it('rejects malformed and oversized payloads', async () => {
    const request = (body: string, size?: string) => new NextRequest('http://localhost:3000/api/customers', { method: 'POST', headers: { host: 'localhost:3000', ...(size ? {'content-length': size} : {}) }, body });
    expect((await POST(request('bad json'), context(['customers']))).status).toBe(400);
    expect((await POST(request('{}', '5000000'), context(['customers']))).status).toBe(413);
  });
  it('rejects invalid routes and nonlocal PDF requests', async () => {
    const req = new NextRequest('http://localhost:3000/api/unknown', { headers: {host: 'localhost:3000'} });
    expect((await GET(req, context(['unknown']))).status).toBe(404);
    const remote = new NextRequest('http://external.example/api/quotes/example/pdf', { headers: {host: 'external.example'} });
    expect((await pdf(remote, { params: Promise.resolve({id:'example'}) })).status).toBe(403);
  });
});

describe('Codespaces guard integration', () => {
  const preview = 'freight-test-ab12-3000.app.github.dev';
  function enableCodespaces() {
    vi.stubEnv('CODESPACES', 'true');
    vi.stubEnv('CODESPACE_NAME', 'freight-test-ab12');
    vi.stubEnv('GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN', 'app.github.dev');
  }
  it('permits an exact forwarded preview request and still validates its body', async () => {
    enableCodespaces();
    const headers = { host: 'localhost:3000', 'x-forwarded-host': preview, origin: `https://${preview}`, 'sec-fetch-site': 'same-origin' };
    const req = new NextRequest(`https://${preview}/api/customers`, { method: 'POST', headers, body: 'invalid json' });
    expect((await POST(req, context(['customers']))).status).toBe(400);
    const other = new NextRequest(`https://${preview}/api/customers`, { method: 'POST', headers: { ...headers, origin: 'https://other-workspace-3000.app.github.dev' }, body: '{}' });
    expect((await POST(other, context(['customers']))).status).toBe(403);
  });
  it('uses the same exact-host check on customer PDF downloads', async () => {
    enableCodespaces();
    const quote = vi.spyOn(service, 'getQuote').mockRejectedValue(new ServiceError('找不到報價', 404));
    const req = new NextRequest(`https://${preview}/api/quotes/missing/pdf`, { headers: { host: preview } });
    expect((await pdf(req, { params: Promise.resolve({ id: 'missing' }) })).status).toBe(404);
    expect(quote).toHaveBeenCalledWith('missing');
    quote.mockClear();
    const foreign = new NextRequest('https://other-workspace-3000.app.github.dev/api/quotes/missing/pdf', { headers: { host: 'other-workspace-3000.app.github.dev' } });
    expect((await pdf(foreign, { params: Promise.resolve({ id: 'missing' }) })).status).toBe(403);
    expect(quote).not.toHaveBeenCalled();
  });
});
