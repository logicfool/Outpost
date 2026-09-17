import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export const ARTWORK_WAIT_MS = 8000;

export function useArtworkReadiness(
  identity: string,
  urls: readonly (string | undefined)[],
  timeoutMs = ARTWORK_WAIT_MS,
) {
  const signature = JSON.stringify([
    identity,
    ...new Set(urls.filter((url): url is string => !!url)),
  ]);
  const expected = useMemo(
    () => [...new Set(urls.filter((url): url is string => !!url))],
    [signature],
  );
  const active = useRef(signature),
    mounted = useRef(true);
  active.current = signature;
  const [state, setState] = useState<{
    signature: string;
    settled: Record<string, 'ready' | 'failed'>;
    expired: boolean;
  }>({ signature, settled: {}, expired: false });
  const current =
    state.signature === signature ? state : { signature, settled: {}, expired: false };
  const ready = current.expired || expected.every((url) => !!current.settled[url]);
  const failed = useMemo(
    () =>
      new Set(
        expected.filter(
          (url) => current.settled[url] === 'failed' || (current.expired && !current.settled[url]),
        ),
      ),
    [signature, current.settled, current.expired],
  );
  const settle = useCallback(
    (url: string, failed = false) => {
      if (!mounted.current || active.current !== signature || !expected.includes(url)) return;
      setState((previous) => {
        const value =
          previous.signature === signature ? previous : { signature, settled: {}, expired: false };
        if (value.expired || value.settled[url]) return value;
        return { ...value, settled: { ...value.settled, [url]: failed ? 'failed' : 'ready' } };
      });
    },
    [signature, expected],
  );
  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(
      () => {
        if (active.current !== signature) return;
        setState((previous) => ({
          ...(previous.signature === signature ? previous : { signature, settled: {} }),
          expired: true,
        }));
      },
      Math.max(0, timeoutMs),
    );
    return () => clearTimeout(timer);
  }, [signature, ready, timeoutMs]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return { ready, failed, settle };
}
