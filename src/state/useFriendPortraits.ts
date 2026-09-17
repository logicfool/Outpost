import { useEffect, useRef, useState } from 'react';
import { AppState, type ViewToken } from 'react-native';
import type { AppModel } from './useApp';
import type { Friend } from '../core/chatTypes';
import { friendIdentityDue } from '../core/friendIdentity';

export function useFriendPortraits(model: AppModel) {
  const latest = useRef(model);
  latest.current = model;
  const [visible, setVisible] = useState<string[]>([]);
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<Friend>[] }) => {
      setVisible(
        [
          ...new Set(
            viewableItems.filter((v) => v.isViewable && v.item?.subject).map((v) => v.item.subject),
          ),
        ].slice(0, 20),
      );
    },
  ).current;
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 30,
    minimumViewTime: 500,
  }).current;
  useEffect(() => {
    let alive = true,
      running = false;
    const tick = async () => {
      const m = latest.current;
      if (
        !alive ||
        running ||
        m.active?.demo ||
        m.chat.status !== 'ready' ||
        AppState.currentState !== 'active'
      )
        return;
      const next = visible
        .map((id) => m.chat.friends.find((f) => f.subject === id))
        .find((f): f is Friend => !!f && friendIdentityDue(f));
      if (!next) return;
      running = true;
      try {
        await m.refreshFriendPortrait(next);
      } catch {
      } finally {
        running = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 60000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [visible, model.active?.puuid, model.chat.status]);
  return { onViewableItemsChanged, viewabilityConfig };
}
