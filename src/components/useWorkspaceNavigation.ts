'use client';
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { parseWorkspaceHash, workspaceHash, type WorkspaceRouteInput } from '@/lib/navigation';

const NAVIGATION_EVENT = 'tec-workspace-navigation';
const subscribeHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
/** Hash navigation survives document reloads and keeps browser Back/Forward useful. */
export function useWorkspaceNavigation() {
  const ready = useSyncExternalStore(subscribeHydration, clientReady, serverReady);
  const generation = useRef(0);
  const subscribe = useCallback((onChange: () => void) => {
    const changed = () => { generation.current++; onChange(); };
    window.addEventListener('hashchange', changed);
    window.addEventListener('popstate', changed);
    window.addEventListener(NAVIGATION_EVENT, changed);
    return () => {
      window.removeEventListener('hashchange', changed);
      window.removeEventListener('popstate', changed);
      window.removeEventListener(NAVIGATION_EVENT, changed);
    };
  }, []);
  const getSnapshot = useCallback(() => `${generation.current}:${window.location.hash}`, []);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => '0:');
  const route = useMemo(() => parseWorkspaceHash(snapshot.slice(snapshot.indexOf(':') + 1)), [snapshot]);
  const token = Number(snapshot.slice(0, snapshot.indexOf(':')));
  const navigate = useCallback((next: WorkspaceRouteInput) => {
    const hash = workspaceHash(next);
    if (window.location.hash === hash) return;
    // Preserve the framework's existing History state when changing only a hash.
    window.history.pushState(window.history.state, '', hash);
    window.dispatchEvent(new Event(NAVIGATION_EVENT));
  }, []);
  const getCurrentRoute = useCallback(() => parseWorkspaceHash(window.location.hash), []);
  const getCurrentToken = useCallback(() => generation.current, []);
  return { route, token, navigate, getCurrentRoute, getCurrentToken, ready };
}
