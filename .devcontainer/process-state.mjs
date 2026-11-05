import { readFileSync, readdirSync, realpathSync } from 'node:fs';

const exited = state => state === 'Z' || state === 'X';
/** Match our detached npm leader, including older managed development servers. */
export function getOwnedServerMode(pid, root, leader) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || leader === null || exited(leader.state)
    || leader.pid !== pid || leader.group !== pid || leader.cwd !== root) return null;
  const command = /^(?:(?:\S*\/)?node\s+)?(?:\S*\/)?npm(?:-cli\.js)?\s+(?:run\s+)?(dev|start)(?:\s+--)?\s+--port(?:=|\s+)3000\s*$/.exec(leader.command ?? '');
  return command ? command[1] === 'start' ? 'production' : 'development' : null;
}
export const isOwnedServer = (pid, root, leader) => getOwnedServerMode(pid, root, leader) !== null;
export function groupHasLiveMembers(pid, processes) {
  return Number.isSafeInteger(pid) && pid > 1 && processes.some(item => item.group === pid && !exited(item.state));
}
/** Pure decision helper: live children of a missing leader are never "stopped". */
export function classifyManagedServer(pid, root, leader, processes) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return 'invalid';
  if (leader !== null && !exited(leader.state)) return isOwnedServer(pid, root, leader) ? 'owned' : 'unowned';
  return groupHasLiveMembers(pid, processes) ? 'orphaned' : 'stopped';
}
export function listProcessStats() {
  const result = [];
  for (const id of readdirSync('/proc')) {
    if (!/^\d+$/.test(id)) continue;
    try {
      const raw = readFileSync(`/proc/${id}/stat`, 'utf8');
      const fields = raw.slice(raw.lastIndexOf(')') + 2).split(' ');
      result.push({ pid: Number(id), state: fields[0], group: Number(fields[2]) });
    } catch (error) {
      // Processes can exit while /proc is enumerated. Permission or I/O failures
      // must fail closed, instead of incorrectly declaring a group stopped.
      if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error;
    }
  }
  return result;
}
export function inspectManagedServerDetails(pid, root) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return { status: 'invalid', mode: null };
  const processes = listProcessStats();
  let leader = processes.find(item => item.pid === pid) ?? null;
  if (leader !== null && !exited(leader.state)) {
    try {
      leader = { ...leader, cwd: realpathSync(`/proc/${pid}/cwd`), command: readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ') };
    } catch {
      // A leader with unreadable ownership metadata must never be signalled.
      leader = { ...leader, cwd: '', command: '' };
    }
  }
  const status = classifyManagedServer(pid, root, leader, processes);
  return { status, mode: status === 'owned' ? getOwnedServerMode(pid, root, leader) : null };
}
export const inspectManagedServer = (pid, root) => inspectManagedServerDetails(pid, root).status;
export const groupIsAlive = pid => groupHasLiveMembers(pid, listProcessStats());
