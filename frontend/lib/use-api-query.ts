'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet } from './api';

/** One request at a time; only key changes reset data and abort stale work. */
export function useApiQuery<T>(path: string | null, { intervalMs = 0 }: { intervalMs?: number } = {}) {
  const [state, setState] = useState<{ data: T | undefined; error: Error | null; loading: boolean; refreshing: boolean }>({ data: undefined, error: null, loading: !!path, refreshing: false });
  const refreshRef = useRef<() => void>(() => {});
  const scheduleRef = useRef<() => void>(() => {});
  const intervalRef = useRef(intervalMs);
  const refetch = useCallback(() => refreshRef.current(), []);
  // Cadence changes reschedule the next poll without discarding data or in-flight requests.
  useEffect(() => { intervalRef.current = intervalMs; scheduleRef.current(); }, [intervalMs]);
  useEffect(() => {
    let disposed = false;
    let pending = false;
    let queued = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    setState({ data: undefined, error: null, loading: !!path, refreshing: false });
    const schedule = () => {
      window.clearTimeout(timer);
      timer = undefined;
      if (!disposed && !pending && path && !document.hidden && intervalRef.current > 0) timer = window.setTimeout(() => void run(), intervalRef.current);
    };
    const run = async () => {
      window.clearTimeout(timer);
      if (disposed || !path || document.hidden) return;
      if (pending) { queued = true; return; }
      pending = true;
      controller = new AbortController();
      setState(s => ({ ...s, refreshing: true }));
      try {
        const data = await apiGet<T>(path, { signal: controller.signal });
        if (!disposed) setState({ data, error: null, loading: false, refreshing: false });
      } catch (error) {
        if (!disposed && !controller.signal.aborted) setState(s => ({ ...s, error: error instanceof Error ? error : new Error(String(error)), loading: false, refreshing: false }));
      } finally {
        pending = false;
        if (!disposed) {
          if (queued) { queued = false; void run(); }
          else schedule();
        }
      }
    };
    refreshRef.current = () => { void run(); };
    scheduleRef.current = schedule;
    const visibility = () => { window.clearTimeout(timer); if (!document.hidden) void run(); };
    document.addEventListener('visibilitychange', visibility);
    void run();
    return () => { disposed = true; controller?.abort(); window.clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [path]);
  return { ...state, refetch };
}
