import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { AppState } from 'react-native';
import { LIVE_POLL_MS } from '../core/refreshPolicy';
import type { AppModel } from './useApp';
export const LivePollingContext = createContext(true);

export function useLivePolling(model: AppModel) {
  const enabled = useContext(LivePollingContext);
  const [busy, setBusy] = useState(false),
    manual = useRef<() => void>(() => {});
  useEffect(() => {
    if (!enabled) return;
    let stopped = false,
      running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      clearTimeout(timer);
      if (stopped || running || AppState.currentState !== 'active') return;
      running = true;
      setBusy(true);
      let next = Date.now() + LIVE_POLL_MS;
      try {
        const result = await model.refreshLive();
        next =
          result.status === 'ready'
            ? (result.data.nextCheckAt ?? next)
            : Math.max(next, result.retryAt ?? 0);
      } catch {
        next = Date.now() + 2 * LIVE_POLL_MS;
      } finally {
        running = false;
        if (!stopped) {
          setBusy(false);
          if (AppState.currentState === 'active')
            timer = setTimeout(() => void tick(), Math.max(1000, next - Date.now()));
        }
      }
    };
    manual.current = () => {
      void tick();
    };
    void tick();
    const listener = AppState.addEventListener('change', (state) => {
      clearTimeout(timer);
      if (state === 'active') void tick();
    });
    return () => {
      stopped = true;
      clearTimeout(timer);
      listener.remove();
      manual.current = () => {};
    };
  }, [enabled, model.active?.puuid, model.refreshLive]);
  return { busy, refresh: useCallback(() => manual.current(), []) };
}
