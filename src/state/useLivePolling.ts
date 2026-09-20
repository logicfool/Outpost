import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { AppState, Platform } from 'react-native';
import { LIVE_POLL_MS, PROFILE_POLL_MS, completedLiveTransition } from '../core/refreshPolicy';
import type { AppModel } from './useApp';
export const LivePollingContext = createContext(true);
type Lane = 'live' | 'profile';

export function useLivePolling(model: AppModel) {
  const enabled = useContext(LivePollingContext),
    [busy, setBusy] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    manual = useRef<() => void>(() => {});
  const initialLive = useRef(model.snapshot?.liveGame);
  initialLive.current = model.snapshot?.liveGame;
  useEffect(() => {
    if (!enabled) return;
    let stopped = false,
      focused = true,
      queued = false,
      manualPending = false,
      lastLive = initialLive.current;
    const running: Partial<Record<Lane, Promise<void>>> = {},
      timers: Partial<Record<Lane, ReturnType<typeof setTimeout>>> = {};
    const visible = () => !stopped && focused && AppState.currentState === 'active';
    const work = (kind: Lane, reason: 'auto' | 'manual' = 'auto'): Promise<void> => {
      clearTimeout(timers[kind]);
      if (!visible()) return Promise.resolve();
      const old = running[kind];
      if (old)
        return reason === 'manual'
          ? old.then(() => (visible() ? work(kind, 'manual') : undefined))
          : old;
      if (kind === 'profile' && typeof model.refreshProfile !== 'function')
        return Promise.resolve();
      setBusy(true);
      const run = async () => {
        let next = Date.now() + (kind === 'live' ? LIVE_POLL_MS : PROFILE_POLL_MS);
        try {
          if (kind === 'live') {
            const result = await model.refreshLive(reason);
            next =
              result.status === 'ready'
                ? (result.data.nextCheckAt ?? next)
                : Math.max(next, result.retryAt ?? 0);
            const ended = completedLiveTransition(lastLive, result);
            lastLive = result;
            if (ended && visible()) {
              clearTimeout(timers.profile);
              timers.profile = setTimeout(() => void work('profile'), 1000);
            }
          } else {
            const result = await model.refreshProfile(reason);
            next = result?.profileNextCheckAt ?? next;
          }
        } catch {
          next = Date.now() + 2 * LIVE_POLL_MS;
        } finally {
          delete running[kind];
          if (!stopped) {
            setBusy(!!running.live || !!running.profile);
            if (visible())
              timers[kind] = setTimeout(
                () => void work(kind),
                Math.min(2147480000, Math.max(1000, next - Date.now())),
              );
          }
        }
      };
      const promise = Promise.resolve().then(run);
      running[kind] = promise;
      return promise;
    };
    const resume = () => {
      if (queued) return;
      queued = true;
      void Promise.resolve().then(() => {
        queued = false;
        if (visible()) {
          void work('live');
          void work('profile');
        }
      });
    };
    manual.current = () => {
      if (!visible() || manualPending) return;
      manualPending = true;
      setRefreshing(true);
      void Promise.allSettled([work('live', 'manual'), work('profile', 'manual')]).finally(() => {
        manualPending = false;
        if (!stopped) setRefreshing(false);
      });
    };
    const cancel = () => {
      clearTimeout(timers.live);
      clearTimeout(timers.profile);
    };
    const change = AppState.addEventListener('change', (state) => {
      cancel();
      if (state === 'active') resume();
    });
    const blur =
      Platform.OS === 'android'
        ? AppState.addEventListener('blur', () => {
            focused = false;
            cancel();
          })
        : undefined;
    const focus =
      Platform.OS === 'android'
        ? AppState.addEventListener('focus', () => {
            focused = true;
            resume();
          })
        : undefined;
    resume();
    return () => {
      stopped = true;
      cancel();
      change.remove();
      blur?.remove();
      focus?.remove();
      manual.current = () => {};
    };
  }, [enabled, model.active?.puuid, model.refreshLive, model.refreshProfile]);
  return { busy, refreshing, refresh: useCallback(() => manual.current(), []) };
}
