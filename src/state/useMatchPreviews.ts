import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { MatchDetail, MatchSummary } from '../core/types';
import type { AppModel } from './useApp';
import { safeError } from '../core/validation';
import { LivePollingContext } from './useLivePolling';

export interface PreviewIssue {
  code: string;
  message: string;
  retryAt: number;
}

export function useMatchPreviews(model: AppModel, subject?: string) {
  const enabled = useContext(LivePollingContext),
    scope = `${model.active?.puuid ?? ''}:${subject ?? ''}`;
  const [view, setView] = useState<{
    scope: string;
    details: Record<string, MatchDetail>;
    issue?: PreviewIssue;
  }>({ scope, details: {} });
  const cache = useRef<Record<string, MatchDetail>>({}),
    wanted = useRef<string[]>([]),
    blocked = useRef(0);
  const generation = useRef(0),
    running = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const current = useRef({ enabled, loader: model.matchDetail, subject, scope });
  current.current = { enabled, loader: model.matchDetail, subject, scope };
  const foreground = () =>
    AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
  const pump = useRef<() => Promise<void>>(async () => {});
  pump.current = async () => {
    clearTimeout(timer.current);
    if (running.current || !current.current.enabled || !foreground()) return;
    if (blocked.current > Date.now()) {
      timer.current = setTimeout(
        () => void pump.current(),
        Math.min(2147480000, Math.max(200, blocked.current - Date.now())),
      );
      return;
    }
    const id = wanted.current.find((id) => !cache.current[id]);
    if (!id) return;
    const stamp = generation.current,
      { loader, subject: selected, scope: selectedScope } = current.current;
    running.current = true;
    setView((previous) =>
      previous.scope === selectedScope && previous.issue
        ? { ...previous, issue: undefined }
        : previous,
    );
    try {
      const detail = await loader(id, selected);
      if (stamp !== generation.current || current.current.scope !== selectedScope) return;
      const next = { ...cache.current, [id]: detail },
        keys = Object.keys(next);
      if (keys.length > 60) {
        const oldest = keys.find((key) => !wanted.current.includes(key));
        if (oldest) delete next[oldest];
      }
      cache.current = next;
      setView({ scope: selectedScope, details: next });
    } catch (reason) {
      if (stamp === generation.current && current.current.scope === selectedScope) {
        const error = safeError(reason);
        blocked.current = Math.max(Date.now() + 60000, error.retryAt ?? 0);
        setView({
          scope: selectedScope,
          details: cache.current,
          issue: { code: error.code, message: error.message, retryAt: blocked.current },
        });
      }
    } finally {
      if (stamp === generation.current) {
        running.current = false;
        if (current.current.enabled && foreground())
          timer.current = setTimeout(
            () => void pump.current(),
            Math.min(2147480000, Math.max(200, blocked.current - Date.now())),
          );
      }
    }
  };
  useEffect(() => {
    generation.current++;
    cache.current = {};
    wanted.current = [];
    blocked.current = 0;
    running.current = false;
    setView({ scope, details: {} });
    return () => {
      generation.current++;
      clearTimeout(timer.current);
    };
  }, [scope]);
  useEffect(() => {
    if (enabled) void pump.current();
    else clearTimeout(timer.current);
    const listener = AppState.addEventListener('change', (state) => {
      clearTimeout(timer.current);
      if (state === 'active' && current.current.enabled) void pump.current();
    });
    return () => {
      clearTimeout(timer.current);
      listener.remove();
    };
  }, [enabled]);
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 15,
    minimumViewTime: 200,
  }).current;
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { item: MatchSummary; isViewable: boolean }[] }) => {
      wanted.current = viewableItems
        .filter((v) => v.isViewable)
        .slice(0, 6)
        .map((v) => v.item.id);
      void pump.current();
    },
    [],
  );
  return {
    details: view.scope === scope ? view.details : {},
    issue: view.scope === scope ? view.issue : undefined,
    viewabilityConfig,
    onViewableItemsChanged,
  };
}
