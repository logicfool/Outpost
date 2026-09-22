import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { demoParty } from '../core/demo';
import type { Party } from '../core/partyTypes';
import type { RiotClient } from '../core/riot';
import type { Section } from '../core/types';
import { AppError, safeError } from '../core/validation';
import { getRuntime } from '../platform/runtime';
import type { AppModel } from './useApp';

export const PARTY_POLL_MS = 10000;

export interface PartyModel {
  section: Section<Party> | undefined;
  busy: boolean;
  working: string | null;
  error: string | null;
  refresh(): void;
  run(action: string, command: (client: RiotClient) => Promise<Party>): Promise<boolean>;
  dismissError(): void;
}

export function useParty(model: AppModel, active: boolean): PartyModel {
  const accountId = model.active?.puuid,
    demo = !!model.active?.demo;
  const [section, setSection] = useState<Section<Party> | undefined>(undefined);
  const [busy, setBusy] = useState(false),
    [working, setWorking] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  const generation = useRef(0),
    inFlight = useRef(false);

  useEffect(() => {
    generation.current++;
    setSection(undefined);
    setError(null);
    setWorking(null);
  }, [accountId]);

  const load = useCallback(
    async (fresh: boolean) => {
      if (!accountId || inFlight.current) return;
      const stamp = generation.current;
      inFlight.current = true;
      setBusy(true);
      try {
        const next = demo
          ? { status: 'ready' as const, data: demoParty(Date.now()), fetchedAt: Date.now() }
          : await (await getRuntime()).party(accountId, fresh);
        if (stamp === generation.current) setSection(next);
      } catch (reason) {
        const e = safeError(reason);
        if (stamp === generation.current)
          setSection({ status: 'error', code: e.code, message: e.message });
      } finally {
        inFlight.current = false;
        if (stamp === generation.current) setBusy(false);
      }
    },
    [accountId, demo],
  );

  useEffect(() => {
    if (!active || !accountId) return;
    void load(false);

    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void load(false);
    }, PARTY_POLL_MS);
    return () => clearInterval(timer);
  }, [active, accountId, load]);

  const refresh = useCallback(() => {
    void load(true);
  }, [load]);

  const run = useCallback(
    async (action: string, command: (client: RiotClient) => Promise<Party>) => {
      if (!accountId || working) return false;
      const stamp = generation.current;
      setWorking(action);
      setError(null);
      try {
        if (demo) throw new AppError('DEMO_ONLY', 'Demo parties never contact Riot.');
        const data = await (await getRuntime()).partyCommand(accountId, command);
        if (stamp === generation.current)
          setSection({ status: 'ready', data, fetchedAt: Date.now() });
        return true;
      } catch (reason) {
        if (stamp === generation.current) setError(safeError(reason).message);
        if (stamp === generation.current) void load(true);
        return false;
      } finally {
        if (stamp === generation.current) setWorking(null);
      }
    },
    [accountId, demo, working, load],
  );

  return {
    section,
    busy,
    working,
    error,
    refresh,
    run,
    dismissError: useCallback(() => setError(null), []),
  };
}
