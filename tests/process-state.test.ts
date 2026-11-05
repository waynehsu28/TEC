import { describe, expect, it } from 'vitest';
import { classifyManagedServer, groupHasLiveMembers, isOwnedServer } from '../.devcontainer/process-state.mjs';
const root = '/workspaces/TEC';
const pid = 321;
const own = { pid, group: pid, cwd: root, command: 'npm run dev --port 3000', state: 'S' };
describe('Codespaces managed-server process ownership', () => {
  it('recognizes only the detached npm dev leader for this checkout and port', () => {
    expect(isOwnedServer(pid, root, own)).toBe(true);
    expect(isOwnedServer(pid, root, { ...own, command: '/usr/bin/node /usr/bin/npm-cli.js run dev -- --port 3000' })).toBe(true);
    for (const patch of [{ cwd: '/other/project' }, { group: 111 }, { command: 'npm run test --port 3000' }, { command: 'npm run dev --port 4000' }, { state: 'Z' }]) expect(isOwnedServer(pid, root, { ...own, ...patch })).toBe(false);
  });
  it('classifies a recycled PID as unowned, so startup may discard it without signalling it', () => {
    const foreign = { ...own, command: 'node unrelated-worker.js' };
    expect(classifyManagedServer(pid, root, foreign, [foreign])).toBe('unowned');
    expect(classifyManagedServer(pid, root, { ...own, cwd: '', command: '' }, [own])).toBe('unowned');
  });
  it('does not declare a missing leader stopped while its Next child remains alive', () => {
    const child = { pid: 322, group: pid, state: 'S' };
    expect(classifyManagedServer(pid, root, null, [child])).toBe('orphaned');
    expect(groupHasLiveMembers(pid, [child])).toBe(true);
  });
  it('does not declare a zombie leader stopped while its child still writes', () => {
    const zombie = { ...own, state: 'Z' };
    expect(classifyManagedServer(pid, root, zombie, [zombie, { pid: 322, group: pid, state: 'R' }])).toBe('orphaned');
  });
  it('allows stopped status only when all recorded group members have exited', () => {
    expect(classifyManagedServer(pid, root, null, [])).toBe('stopped');
    const zombie = { ...own, state: 'Z' };
    expect(classifyManagedServer(pid, root, zombie, [zombie, { pid: 322, group: pid, state: 'X' }])).toBe('stopped');
    expect(groupHasLiveMembers(pid, [{ pid: 888, group: 888, state: 'S' }])).toBe(false);
  });
  it('rejects unsafe PID values before a process group can be selected', () => {
    for (const value of [0, 1, -1, NaN, Infinity, 1.5]) {
      expect(classifyManagedServer(value, root, own, [own])).toBe('invalid');
      expect(groupHasLiveMembers(value, [own])).toBe(false);
    }
  });
});
