type RuntimeEnvironment = Record<string, string | undefined>;
type RequestHeaders = Pick<Headers, 'get'>;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

/** Only the current Codespace's port 3000, never every *.app.github.dev workspace. */
export function getCodespacesPreviewHost(env: RuntimeEnvironment = process.env): string | null {
  if (env.CODESPACES !== 'true') return null;
  const name = env.CODESPACE_NAME ?? '';
  const domain = (env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN ?? '').toLowerCase();
  // The name plus "-3000" must fit in one DNS label. GitHub's hosted forwarding
  // domain is fixed; invalid or incomplete runtime metadata leaves preview closed.
  if (!/^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/.test(name) || domain !== 'app.github.dev') return null;
  return `${name}-3000.${domain}`;
}

/** This is a host/origin boundary. Private-port authentication belongs to GitHub. */
export function getRequestAccessError(headers: RequestHeaders, method: string, env: RuntimeEnvironment = process.env): string | null {
  const preview = getCodespacesPreviewHost(env);
  const host = (headers.get('host') ?? '').toLowerCase();
  const allowedHost = (value: string) => LOCAL_HOST.test(value) || (preview !== null && value === preview);
  if (!allowedHost(host)) return '僅允許本機或目前 Codespaces 預覽網址存取';

  // A proxy may preserve localhost in Host and put the public name here. Never
  // use an arbitrary forwarded host to authorize an Origin or another Codespace.
  const forwardedHost = headers.get('x-forwarded-host');
  if (forwardedHost !== null && !allowedHost(forwardedHost.toLowerCase())) return '不接受此轉送主機';

  if (method !== 'GET' && method !== 'HEAD') {
    if (headers.get('sec-fetch-site') === 'cross-site') return '拒絕跨來源寫入要求';
    const origin = headers.get('origin');
    const localOrigin = LOCAL_HOST.test(host) && (origin === `http://${host}` || origin === `https://${host}`);
    const previewOrigin = preview !== null && origin === `https://${preview}`;
    if (origin !== null && !localOrigin && !previewOrigin) return '拒絕跨來源寫入要求';
  }
  return null;
}
