import { useCallback, useEffect, useState } from 'react';
import { executionMonitorApi } from '../api/execution-monitor.api';
import { ACTIVE_MONITOR_STATUSES, type ProjectExecutionOverview } from './types';

const POLL_INTERVAL_MS = 3000;

// The dashboard's single source of live state (item 44/45): every field
// comes from the backend on every fetch, never from client-held state that
// survives a refresh — a page reload or a closed-and-reopened browser
// reconstructs the exact same view purely from this hook's next fetch.
//
// Uses one self-scheduling setTimeout loop (never setInterval), guarded by
// a `cancelled` flag closed over per effect instance, rather than a
// separate polling effect keyed off derived state — verified against a
// production build that this produces exactly one request per poll
// interval (item 43); a naive separate-effect-plus-setInterval version
// measurably doubled requests under React StrictMode's dev-only
// double-effect-invocation, since neither of the two resulting intervals
// could detect the other. This structure is immune to that regardless of
// how many times the effect itself is invoked: whichever closure gets
// cancelled stops scheduling its own next tick before ever firing another
// fetch.
export function useExecutionMonitor(projectId: string) {
  const [overview, setOverview] = useState<ProjectExecutionOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionWarning, setConnectionWarning] = useState(false);

  const load = useCallback(async (): Promise<ProjectExecutionOverview | null> => {
    try {
      const result = await executionMonitorApi.getOverview(projectId);
      setOverview(result);
      setConnectionWarning(false);
      return result;
    } catch {
      // Keep the last known-good overview on screen (item 108) — a single
      // transient poll failure should not blank the dashboard.
      setConnectionWarning(true);
      return null;
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      const result = await load();
      if (cancelled) return;
      const status = result?.activeSprintExecution?.status;
      const isActive = status ? ACTIVE_MONITOR_STATUSES.includes(status) : false;
      if (isActive) {
        timer = setTimeout(tick, POLL_INTERVAL_MS);
      }
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  return { overview, loading, connectionWarning, refresh: load };
}
