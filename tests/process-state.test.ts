import { describe, expect, it } from 'vitest';
import { classifyManagedServer, getOwnedServerMode, groupHasLiveMembers, isOwnedServer } from '../.devcontainer/process-state.mjs';
const root = '/workspaces/TEC';
const pid = 321;
const own = { pid, group: pid, cwd: root, command: 'npm start --port 3000', state: 'S' };
describe('Codespaces managed-server process ownership', () => {
  it('recognizes production npm leaders only for this checkout, detached group and port', () => {
    expect(isOwnedServer(pid, root, own)).toBe(true);
    expect(getOwnedServerMode(pid, root, own)).toBe('production');
    for (const command of ['npm start -- --port 3000', 'npm run start --port=3000', '/usr/bin/node /usr/bin/npm-cli.js start -- --port 3000']) {
      expect(getOwnedServerMode(pid, root, { ...own, command })).toBe('production');
    }
    for (const patch of [{ pid: 111 }, { cwd: '/other/project' }, { group: 111 }, { command: 'npm run test --port 3000' }, { command: 'npm start --port 4000' }, { command: 'npm start --port 3000 --port 4000' }, { command: 'node unrelated-worker.js npm start --port 3000' }, { state: 'Z' }]) expect(isOwnedServer(pid, root, { ...own, ...patch })).toBe(false);
  });
  it('keeps ownership of older managed dev servers so an upgrade can stop them safely', () => {
    for (const command of ['npm run dev --port 3000', '/usr/bin/node /usr/bin/npm-cli.js run dev -- --port 3000']) {
      const dev = { ...own, command };
      expect(getOwnedServerMode(pid, root, dev)).toBe('development');
      expect(classifyManagedServer(pid, root, dev, [dev])).toBe('owned');
    }
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
