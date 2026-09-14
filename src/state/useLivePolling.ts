import { useEffect, useRef, useState, useCallback } from 'react';
import { AppState } from 'react-native';
import type { AppModel } from './useApp';

export function useLivePolling(model: AppModel) {
  const [busy, setBusy] = useState(false),
    manual = useRef<() => void>(() => {});
  useEffect(() => {
    let stopped = false,
      running = false,
      failures = 0,
      blockedUntil = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      clearTimeout(timer);
      if (stopped || running || AppState.currentState !== 'active') return;
      if (Date.now() < blockedUntil) {
        timer = setTimeout(() => void tick(), blockedUntil - Date.now());
        return;
      }
      running = true;
      setBusy(true);
      try {
        const result = await model.refreshLive();
        const error = result.status === 'error' ? result : result.data.detailError;
        failures = error ? failures + 1 : 0;
        const delay = error
          ? Math.min(300000, 15000 * 2 ** Math.min(failures, 5))
          : result.status === 'ready' && result.data.state === 'agent_select'
            ? 12000
            : 20000;
        blockedUntil = Math.max(Date.now() + delay, error?.retryAt ?? 0);
      } finally {
        running = false;
        if (!stopped) {
          setBusy(false);
          if (AppState.currentState === 'active')
            timer = setTimeout(() => void tick(), Math.max(1000, blockedUntil - Date.now()));
        }
      }
    };
    manual.current = () => {
      if (!failures) blockedUntil = 0;
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
  }, [model.active?.puuid, model.refreshLive]);
  return { busy, refresh: useCallback(() => manual.current(), []) };
}
