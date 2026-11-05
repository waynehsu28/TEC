import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../src/app/api/[...path]/route';
import { GET as pdf } from '../src/app/api/quotes/[id]/pdf/route';
const context = (path: string[]) => ({ params: Promise.resolve({ path }) });
describe('local-only API request boundaries', () => {
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
