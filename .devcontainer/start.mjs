import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { getCodespacesPreviewHost } from '../src/lib/request-access.ts';
import { inspectManagedServerDetails } from './process-state.mjs';

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
const ready = async (timeout = 2000) => {
  try {
    const response = await fetch('http://127.0.0.1:3000/api/settings', { signal: AbortSignal.timeout(timeout) });
    if (!response.ok) return false;
    const data = await response.json();
    return typeof data.companyName === 'string' && typeof data.volumeDivisor === 'string' && typeof data.weightIncrement === 'string';
  } catch { return false; }
};
const portIsInUse = () => new Promise((resolve, reject) => {
  const socket = createConnection({ host: '127.0.0.1', port: 3000 });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', error => {
    socket.destroy();
    if (error.code === 'ECONNREFUSED') resolve(false);
    else reject(new Error(`Cannot check port 3000 (${error.code ?? 'connection error'}). No server was started.`));
  });
  socket.setTimeout(2000, () => { socket.destroy(); reject(new Error('Timed out checking port 3000. No server was started.')); });
});
const prepare = script => new Promise((resolve, reject) => {
  console.log(`Preparing TEC: npm run ${script}`);
  const child = spawn('npm', ['run', script], { cwd: root, stdio: 'inherit', env: script === 'build' ? { ...process.env, NODE_ENV: 'production' } : process.env });
  child.once('error', error => reject(new Error(`Cannot run ${script}: ${error.message}`)));
  child.once('exit', (code, signal) => {
    if (code === 0) resolve();
    else reject(Object.assign(new Error(`npm run ${script} failed (${signal ? `signal ${signal}` : `exit ${code}`}). No server was started.`), { exitCode: code ?? 1 }));
  });
});

try {
  mkdirSync(state, { recursive: true });
  let pid = existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8').trim()) : 0;
  const { status, mode } = inspectManagedServerDetails(pid, root);
  if (status === 'orphaned') throw new Error('A previous TEC process group is still running without its recorded leader. Stop it manually before restarting; no unrelated process was stopped.');
  if (status === 'owned') {
    if (mode === 'production' && await ready()) {
      console.log(`TEC production preview is already ready: https://${preview}`);
      process.exit(0);
    }
    throw new Error(`The managed ${mode} server is still running${mode === 'production' ? ' but is not ready' : ''}. Run npm run codespaces:stop, then npm run codespaces:start to build and start the production preview.`);
  }
  if (await portIsInUse()) throw new Error('Port 3000 is already in use by a server that this starter cannot verify as its production preview. Stop that server in its original terminal before running npm run codespaces:start. No process was stopped.');
  if (status === 'unowned') console.log('Discarding a stale server PID; the unrelated process will not be stopped.');

  // Every stopped-service start builds the current checkout, never an old .next.
  await prepare('db:setup');
  await prepare('build');
  const output = openSync(logFile, 'a', 0o600);
  let child;
  try {
    child = spawn('npm', ['start', '--', '--port', '3000'], {
      cwd: root, detached: true, stdio: ['ignore', output, output], env: { ...process.env, NODE_ENV: 'production' },
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    pid = child.pid;
    writeFileSync(pidFile, String(pid), { mode: 0o600 });
    child.unref();
  } finally { closeSync(output); }

  // Compilation has finished before this readiness deadline begins.
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await ready(Math.min(2000, Math.max(1, deadline - Date.now())))) {
      console.log(`TEC production preview is ready: https://${preview}`);
      console.log('Open the Ports tab → port 3000 → Open in Browser. Keep visibility Private.');
      process.exit(0);
    }
    if (!alive(pid) || child.exitCode != null) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(1000, Math.max(0, deadline - Date.now()))));
  }
  console.error('TEC did not become ready. Check .devcontainer/.state/server.log. No database was deleted.');
  if (existsSync(logFile)) console.error(readFileSync(logFile, 'utf8').slice(-4000));
  process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = error.exitCode ?? 1;
}
