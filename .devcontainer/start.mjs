import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getCodespacesPreviewHost } from '../src/lib/request-access.ts';
import { inspectManagedServer } from './process-state.mjs';

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const state = new URL('./.state/', import.meta.url);
const pidFile = new URL('server.pid', state);
const logFile = new URL('server.log', state);
const preview = getCodespacesPreviewHost();
if (!preview) {
  console.error('Codespaces metadata is missing or invalid. For local use, run npm run dev.');
  process.exit(1);
}
// GitHub makes forwarded ports private by default and resets public ports to
// private on Codespace restart. The user must not change visibility to Public.
console.log('Use port 3000 with Private visibility. GitHub provides preview authentication.');
const alive = pid => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
};
const ready = async () => {
  try {
    const response = await fetch('http://127.0.0.1:3000/api/settings', { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return false;
    const data = await response.json();
    return typeof data.companyName === 'string' && typeof data.volumeDivisor === 'string' && typeof data.weightIncrement === 'string';
  } catch { return false; }
};
if (await ready()) {
  console.log(`TEC is already ready: https://${preview}`);
  process.exit(0);
}
mkdirSync(state, { recursive: true });
let pid = existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8').trim()) : 0;
const status = inspectManagedServer(pid, root);
if (status === 'orphaned') {
  console.error('A previous TEC process group is still running without its recorded leader. Stop it manually before restarting; no unrelated process was stopped.');
  process.exit(1);
}
if (status === 'unowned') console.log('Discarding a stale server PID; the unrelated process will not be stopped.');
let child;
if (status !== 'owned') {
  const output = openSync(logFile, 'a', 0o600);
  try {
    child = spawn('npm', ['run', 'dev', '--', '--port', '3000'], {
      cwd: root, detached: true, stdio: ['ignore', output, output], env: process.env,
    });
    child.on('error', error => { console.error(`Cannot start TEC: ${error.message}`); process.exitCode = 1; });
    pid = child.pid ?? 0;
    writeFileSync(pidFile, String(pid), { mode: 0o600 });
    child.unref();
  } finally { closeSync(output); }
}
for (let attempt = 0; attempt < 45; attempt++) {
  if (await ready()) {
    console.log(`TEC is ready: https://${preview}`);
    console.log('Open the Ports tab → port 3000 → Open in Browser. Keep visibility Private.');
    process.exit(0);
  }
  if (!alive(pid) || child?.exitCode != null) break;
  await new Promise(resolve => setTimeout(resolve, 1000));
}
console.error('TEC did not become ready. Check .devcontainer/.state/server.log. No database was deleted.');
if (existsSync(logFile)) console.error(readFileSync(logFile, 'utf8').slice(-4000));
process.exit(1);
