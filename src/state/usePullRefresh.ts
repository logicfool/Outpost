import { useCallback, useEffect, useRef, useState } from 'react';
import { yieldToUI } from '../core/cooperative';

export function usePullRefresh(action: () => Promise<unknown>, scope?: string) {
  const [refreshing, setRefreshing] = useState(false),
    run = useRef(action),
    epoch = useRef(0),
    pending = useRef(false);
  run.current = action;
  useEffect(() => {
    epoch.current++;
    pending.current = false;
    setRefreshing(false);
    return () => {
      epoch.current++;
      pending.current = false;
    };
  }, [scope]);
  const refresh = useCallback(() => {
    if (pending.current) return;
    pending.current = true;
    setRefreshing(true);
    const stamp = epoch.current,
      work = run.current;
    void yieldToUI()
      .then(() => {
        if (epoch.current === stamp) return work();
      })

      .catch(() => {})
      .finally(() => {
        if (epoch.current === stamp) {
          pending.current = false;
          setRefreshing(false);
        }
      });
  }, []);
  return { refreshing, refresh };
}
