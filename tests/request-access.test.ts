import { describe, expect, it } from 'vitest';
import { getCodespacesPreviewHost, getRequestAccessError } from '../src/lib/request-access';
const codespace = { CODESPACES: 'true', CODESPACE_NAME: 'freight-test-ab12', GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev' };
const preview = 'freight-test-ab12-3000.app.github.dev';
const access = (headers: Record<string, string>, method = 'GET', env: Record<string, string | undefined> = {}) => getRequestAccessError(new Headers(headers), method, env);

describe('exact Codespaces preview host selection', () => {
  it('requires complete Codespaces runtime metadata', () => {
    expect(getCodespacesPreviewHost(codespace)).toBe(preview);
    for (const env of [{}, { ...codespace, CODESPACES: 'false' }, { ...codespace, CODESPACES: '1' }, { ...codespace, CODESPACE_NAME: undefined }, { ...codespace, GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: undefined }]) expect(getCodespacesPreviewHost(env)).toBeNull();
  });
  it('rejects unexpected forwarding domains and malformed names instead of broadening access', () => {
    for (const domain of ['github.dev', 'evil.example', 'https://app.github.dev', 'app.github.dev.evil.example', 'app.github.dev:443', '*.app.github.dev']) expect(getCodespacesPreviewHost({ ...codespace, GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: domain })).toBeNull();
    for (const name of ['', 'other.space', '-bad', 'bad-', 'bad/name', 'bad:443', 'x'.repeat(59)]) expect(getCodespacesPreviewHost({ ...codespace, CODESPACE_NAME: name })).toBeNull();
  });
});

describe('request host and Origin boundaries', () => {
  it.each(['localhost:3000', '127.0.0.1:3000', '[::1]:3000'])('preserves local reads and same-origin writes for %s', host => {
    expect(access({ host })).toBeNull();
    expect(access({ host, origin: `http://${host}`, 'sec-fetch-site': 'same-origin' }, 'POST')).toBeNull();
    expect(access({ host }, 'POST')).toBeNull(); // local CLI / readiness requests
  });
  it('keeps the cloud preview closed outside Codespaces', () => {
    expect(access({ host: preview })).not.toBeNull();
    expect(access({ host: 'localhost:3000', origin: `https://${preview}` }, 'POST')).not.toBeNull();
  });
  it('allows HTTPS same-origin browser writes whether the proxy forwards the public or local Host', () => {
    expect(access({ host: preview, origin: `https://${preview}` }, 'POST', codespace)).toBeNull();
    expect(access({ host: 'localhost:3000', 'x-forwarded-host': preview, origin: `https://${preview}` }, 'POST', codespace)).toBeNull();
    expect(access({ host: preview }, 'GET', codespace)).toBeNull();
    expect(access({ host: 'localhost:3000' }, 'GET', codespace)).toBeNull();
  });
  it('rejects all other workspaces, ports, suffix lookalikes and public hosts', () => {
    for (const host of ['other-workspace-3000.app.github.dev', 'freight-test-ab12-4000.app.github.dev', `${preview}.evil.example`, `${preview}:8080`, 'public.example']) expect(access({ host }, 'GET', codespace)).not.toBeNull();
  });
  it('rejects cross-origin and cross-site writes even for a trusted Host', () => {
    for (const origin of ['https://other-workspace-3000.app.github.dev', `http://${preview}`, 'https://evil.example', 'null']) expect(access({ host: preview, origin }, 'POST', codespace)).not.toBeNull();
    expect(access({ host: preview, origin: `https://${preview}`, 'sec-fetch-site': 'cross-site' }, 'POST', codespace)).not.toBeNull();
  });
  it('never authorizes a spoofed forwarding Host, including comma-separated proxy chains', () => {
    for (const forwarded of ['evil.example', 'other-workspace-3000.app.github.dev', `${preview}, localhost:3000`, `${preview}.evil.example`, '']) {
      expect(access({ host: 'localhost:3000', 'x-forwarded-host': forwarded, origin: `https://${preview}` }, 'POST', codespace)).not.toBeNull();
      expect(access({ host: preview, 'x-forwarded-host': forwarded }, 'GET', codespace)).not.toBeNull();
    }
  });
  it('does not accept arbitrary forwarded hosts as authorization for otherwise rejected Hosts', () => {
    expect(access({ host: 'evil.example', 'x-forwarded-host': preview }, 'GET', codespace)).not.toBeNull();
  });
});
