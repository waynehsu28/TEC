import { readFileSync, readdirSync, realpathSync } from 'node:fs';

const exited = state => state === 'Z' || state === 'X';
/** Match the detached npm leader we created, rather than any recycled PID. */
export function isOwnedServer(pid, root, leader) {
  return Number.isSafeInteger(pid) && pid > 1 && leader !== null && !exited(leader.state)
    && leader.pid === pid && leader.group === pid && leader.cwd === root
    && /\bnpm(?:-cli\.js)?(?:\s+run)?\s+dev(?:\s|$)/.test(leader.command ?? '')
    && /--port(?:=|\s+)3000(?:\s|$)/.test(leader.command ?? '');
}
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
export function inspectManagedServer(pid, root) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return 'invalid';
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
  return classifyManagedServer(pid, root, leader, processes);
}
export const groupIsAlive = pid => groupHasLiveMembers(pid, listProcessStats());
