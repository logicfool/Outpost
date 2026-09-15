import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { MatchDetail, MatchSummary } from '../core/types';
import type { AppModel } from './useApp';
import { safeError } from '../core/validation';
import { LivePollingContext } from './useLivePolling';

export function useMatchPreviews(model: AppModel, subject?: string) {
  const enabled = useContext(LivePollingContext);
  const [details, setDetails] = useState<Record<string, MatchDetail>>({});
  const cache = useRef<Record<string, MatchDetail>>({}),
    wanted = useRef<string[]>([]),
    blocked = useRef(0);
  const generation = useRef(0),
    running = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const current = useRef({ enabled, loader: model.matchDetail, subject });
  current.current = { enabled, loader: model.matchDetail, subject };
  const pump = useRef<() => Promise<void>>(async () => {});
  pump.current = async () => {
    if (
      running.current ||
      !current.current.enabled ||
      AppState.currentState === 'background' ||
      AppState.currentState === 'inactive' ||
      blocked.current > Date.now()
    )
      return;
    const id = wanted.current.find((id) => !cache.current[id]);
    if (!id) return;
    const stamp = generation.current,
      loader = current.current.loader,
      selected = current.current.subject;
    running.current = true;
    try {
      const detail = await loader(id, selected);
      if (stamp !== generation.current) return;
      const next = { ...cache.current, [id]: detail },
        keys = Object.keys(next);
      if (keys.length > 60) delete next[keys[0]!];
      cache.current = next;
      setDetails(next);
    } catch (reason) {
      if (stamp === generation.current)
        blocked.current = Math.max(Date.now() + 60000, safeError(reason).retryAt ?? 0);
    } finally {
      if (stamp === generation.current) {
        running.current = false;
        timer.current = setTimeout(() => void pump.current(), 200);
      }
    }
  };
  useEffect(() => {
    generation.current++;
    cache.current = {};
    wanted.current = [];
    blocked.current = 0;
    running.current = false;
    setDetails({});
    return () => {
      generation.current++;
      clearTimeout(timer.current);
    };
  }, [model.active?.puuid, subject]);
  useEffect(() => {
    if (enabled) void pump.current();
    else clearTimeout(timer.current);
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
  return { details, viewabilityConfig, onViewableItemsChanged };
}
