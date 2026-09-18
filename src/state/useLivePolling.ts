import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { AppState, Platform } from 'react-native';
import { LIVE_POLL_MS, PROFILE_POLL_MS } from '../core/refreshPolicy';
import type { AppModel } from './useApp';
export const LivePollingContext = createContext(true);

export function useLivePolling(model: AppModel) {
  const enabled = useContext(LivePollingContext),
    [busy, setBusy] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    manual = useRef<() => void>(() => {});
  useEffect(() => {
    if (!enabled) return;
    let stopped = false,
      focused = true,
      queued = false;
    const running = { live: false, profile: false };
    const timers: Partial<Record<'live' | 'profile', ReturnType<typeof setTimeout>>> = {};
    const visible = () => !stopped && focused && AppState.currentState === 'active';
    const work = async (kind: 'live' | 'profile') => {
      clearTimeout(timers[kind]);
      if (!visible() || running[kind]) return;
      if (kind === 'profile' && typeof model.refreshProfile !== 'function') return;
      running[kind] = true;
      setBusy(true);
      let next = Date.now() + (kind === 'live' ? LIVE_POLL_MS : PROFILE_POLL_MS);
      try {
        if (kind === 'live') {
          const result = await model.refreshLive();
          next =
            result.status === 'ready'
              ? (result.data.nextCheckAt ?? next)
              : Math.max(next, result.retryAt ?? 0);
        } else {
          const result = await model.refreshProfile();
          next = result?.profileNextCheckAt ?? next;
        }
      } catch {
        next = Date.now() + 2 * LIVE_POLL_MS;
      } finally {
        running[kind] = false;
        if (!stopped) {
          setBusy(running.live || running.profile);
          if (visible())
            timers[kind] = setTimeout(
              () => void work(kind),
              Math.min(2147480000, Math.max(1000, next - Date.now())),
            );
        }
      }
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
      if (!visible()) return;
      setRefreshing(true);
      void Promise.allSettled([work('live'), work('profile')]).finally(() => {
        if (!stopped) setRefreshing(false);
      });
    };
    resume();
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
