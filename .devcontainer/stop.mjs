import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { groupIsAlive, inspectManagedServer } from './process-state.mjs';

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const pidFile = new URL('./.state/server.pid', import.meta.url);
if (!existsSync(pidFile)) {
  console.log('No managed TEC server PID. Stop any manually started server with Ctrl+C before backing up.');
  process.exit(0);
}
try {
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  const status = inspectManagedServer(pid, root);
  if (status === 'invalid') throw new Error('Invalid server PID; no process was stopped');
  if (status === 'unowned') throw new Error('PID ownership could not be confirmed; refusing to stop an unrelated process');
  if (status === 'orphaned') throw new Error('A process group is still running without its recorded leader. Stop it manually and do not copy the database yet.');
  if (status === 'stopped') {
    rmSync(pidFile, { force: true });
    console.log('Managed server and its process group have already exited.');
    process.exit(0);
  }
  try { process.kill(-pid, 'SIGTERM'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
  for (let attempt = 0; attempt < 30 && groupIsAlive(pid); attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  if (groupIsAlive(pid)) throw new Error('Server is still stopping; wait before copying the database');
  rmSync(pidFile, { force: true });
  console.log('Managed TEC server stopped. You may now download the SQLite database backup.');
} catch (error) {
  // Keep PID evidence whenever ownership or complete shutdown is uncertain.
  console.error(error.message);
  process.exit(1);
}
