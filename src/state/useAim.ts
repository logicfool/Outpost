import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { Account } from '../core/types';
import type { AimEdit, AimPreset, AimState, Sensitivity } from '../core/aimTypes';
import type { Crosshair } from '../core/crosshair';
import { importCrosshairCode } from '../core/crosshair';
import {
  validateAimPreset,
  aimSnapshot,
  crosshairToRiot,
  prepareAimDocument,
} from '../core/aimSettings';
import { AppError, safeError } from '../core/validation';
import { getRuntime } from '../platform/runtime';
import { randomId } from '../platform/secure';
const DEMO_KEY = 'outpost.demo.aim.v1';
let demo = { state: {} as AimState, presets: [] as AimPreset[] };
function demoState(id: string): AimState {
  if (!demo.state.snapshot) {
    const p = importCrosshairCode('0;P;c;5;h;0;0l;4;0o;2;0a;1;0f;0;1b;0', 'Precision');
    demo.state = {
      snapshot: aimSnapshot(
        {
          data: {
            floatSettings: [
              { settingEnum: 'EAresFloatSettingName::MouseSensitivity', value: 0.25 },
              { settingEnum: 'EAresFloatSettingName::MouseSensitivityADS', value: 1 },
              { settingEnum: 'EAresFloatSettingName::MouseSensitivityZoomed', value: 1 },
            ],
            stringSettings: [
              {
                settingEnum: 'EAresStringSettingName::SavedCrosshairProfileData',
                value: JSON.stringify({ currentProfile: 0, profiles: [crosshairToRiot(p)] }),
              },
            ],
          },
        },
        id,
      ),
    };
  }
  return demo.state;
}
function persistDemo() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(DEMO_KEY, JSON.stringify(demo));
  } catch {}
}
export function useAim(
  account: Account | null,
  ready: boolean,
  revision: number,
  selection: () => { accountId?: string; revision: number },
) {
  const [value, setValue] = useState<{ id?: string; state: AimState; presets: AimPreset[] }>({
    state: {},
    presets: [],
  });
  const [loading, setLoading] = useState(false),
    [hydrated, setHydrated] = useState(false);
  const stateVersion = useRef(0),
    presetVersion = useRef(0);
  const current = useRef({ account, selection }),
    generation = useRef(0),
    tried = useRef('');
  current.current = { account, selection };
  const lease = () => {
    const { account: a, selection: s } = current.current;
    if (!a) throw new AppError('NO_ACCOUNT', 'Select an account.');
    const expected = s();
    if (expected.accountId !== a.puuid)
      throw new AppError('ACCOUNT_CHANGED', 'The selected account changed.');
    return {
      account: a,
      check: () => {
        const now = current.current.selection();
        if (now.accountId !== a.puuid || now.revision !== expected.revision)
          throw new AppError('ACCOUNT_CHANGED', 'The selected account changed.');
      },
    };
  };
  useEffect(() => {
    const g = ++generation.current,
      sv = stateVersion.current,
      pv = presetVersion.current;
    setHydrated(false);
    setValue({ id: account?.puuid, state: {}, presets: [] });
    setLoading(false);
    tried.current = '';
    if (!account) return;
    (async () => {
      try {
        if (account.demo) {
          try {
            if (typeof localStorage !== 'undefined') {
              const raw = JSON.parse(localStorage.getItem(DEMO_KEY) ?? 'null');
              if (raw?.state && Array.isArray(raw.presets)) demo = raw;
            }
          } catch {}
          if (g === generation.current)
            setValue({ id: account.puuid, state: demoState(account.puuid), presets: demo.presets });
        } else {
          const r = await getRuntime();
          const [state, presets] = await Promise.allSettled([
            r.repository.aimState(account.puuid),
            r.repository.aimPresets(account.puuid),
          ]);
          if (g === generation.current)
            setValue((previous) => ({
              id: account.puuid,
              state:
                stateVersion.current !== sv && previous.id === account.puuid
                  ? previous.state
                  : state.status === 'fulfilled'
                    ? (state.value ?? {})
                    : {
                        error: {
                          code: 'AIM_CACHE',
                          message: 'Saved aim settings could not be read. Pull down to refresh.',
                        },
                      },
              presets:
                presetVersion.current !== pv && previous.id === account.puuid
                  ? previous.presets
                  : presets.status === 'fulfilled'
                    ? presets.value
                    : [],
            }));
        }
      } catch (e) {
        if (g === generation.current)
          setValue({
            id: account.puuid,
            state: { error: { code: safeError(e).code, message: safeError(e).message } },
            presets: [],
          });
      } finally {
        if (g === generation.current) setHydrated(true);
      }
    })();
    return () => {
      generation.current++;
    };
  }, [account?.puuid, revision]);
  const syncAim = useCallback(async (reason: 'auto' | 'manual' = 'manual') => {
    const l = lease(),
      g = generation.current;
    setLoading(true);
    try {
      const state = l.account.demo
        ? {
            ...demoState(l.account.puuid),
            snapshot: { ...demoState(l.account.puuid).snapshot!, fetchedAt: Date.now() },
          }
        : await (await getRuntime()).syncAim(l.account.puuid, reason, l.check);
      l.check();
      if (g === generation.current) {
        stateVersion.current++;
        setValue((v) => ({ ...v, id: l.account.puuid, state }));
      }
      return state;
    } catch (reason) {
      l.check();
      if (g === generation.current) {
        const e = safeError(reason);
        setValue((v) => ({
          ...v,
          state: { ...v.state, error: { code: e.code, message: e.message, retryAt: e.retryAt } },
        }));
      }
      throw reason;
    } finally {
      if (g === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (
      !ready ||
      !hydrated ||
      !account ||
      account.demo ||
      tried.current === `${account.puuid}:${revision}`
    )
      return;
    if (
      value.id !== account.puuid ||
      (value.state.snapshot && !value.state.needsSync && !value.state.pending)
    )
      return;
    const key = `${account.puuid}:${revision}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      clearTimeout(timer);
      if (AppState.currentState !== 'active' || tried.current === key) return;
      const delay = Math.max(0, (value.state.nextReadAt ?? 0) - Date.now());
      if (delay > 0) {
        timer = setTimeout(start, Math.min(delay, 2147483647));
        return;
      }
      tried.current = key;
      void syncAim('auto').catch(() => {});
    };
    timer = setTimeout(start, 300);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') start();
      else clearTimeout(timer);
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [
    ready,
    hydrated,
    account?.puuid,
    revision,
    syncAim,
    value.id,
    value.state.nextReadAt,
    value.state.needsSync,
    value.state.snapshot,
    value.state.pending,
  ]);
  const saveAimPreset = useCallback(
    async (name: string, profile: Crosshair, sensitivity: Sensitivity, id?: string) => {
      const l = lease(),
        p = validateAimPreset(
          {
            id: id ?? randomId(),
            accountId: l.account.puuid,
            name,
            profile,
            sensitivity,
            updatedAt: Date.now(),
          },
          l.account.puuid,
        );
      if (l.account.demo) {
        if (demo.presets.length >= 30 && !demo.presets.some((x) => x.id === p.id))
          throw new AppError('AIM_PRESET_LIMIT', 'Keep up to 30 presets.');
        demo.presets = [p, ...demo.presets.filter((x) => x.id !== p.id)];
        persistDemo();
      } else await (await getRuntime()).repository.saveAimPreset(p);
      l.check();
      presetVersion.current++;
      setValue((v) => ({ ...v, presets: [p, ...v.presets.filter((x) => x.id !== p.id)] }));
      return p;
    },
    [],
  );
  const deleteAimPreset = useCallback(async (id: string) => {
    const l = lease();
    if (l.account.demo) {
      demo.presets = demo.presets.filter((p) => p.id !== id);
      persistDemo();
    } else await (await getRuntime()).repository.deleteAimPreset(l.account.puuid, id);
    l.check();
    presetVersion.current++;
    setValue((v) => ({ ...v, presets: v.presets.filter((p) => p.id !== id) }));
  }, []);
  const applyAim = useCallback(async (edit: AimEdit, gameClosed: boolean) => {
    const l = lease(),
      g = generation.current;
    setLoading(true);
    try {
      let state: AimState;
      if (l.account.demo) {
        const old = demoState(l.account.puuid).snapshot!;
        const data = {
          floatSettings: Object.entries(old.sensitivity)
            .filter(([, v]) => v !== null)
            .map(([k, value]) => ({
              settingEnum:
                'EAresFloatSettingName::' +
                {
                  hipfire: 'MouseSensitivity',
                  ads: 'MouseSensitivityADS',
                  scoped: 'MouseSensitivityZoomed',
                }[k],
              value,
            })),
          stringSettings: [
            {
              settingEnum: 'EAresStringSettingName::SavedCrosshairProfileData',
              value: JSON.stringify({
                currentProfile: old.current ?? 0,
                profiles: old.crosshairs.map((p) => crosshairToRiot(p.profile!)),
              }),
            },
          ],
        };
        state = {
          snapshot: aimSnapshot(
            prepareAimDocument({ data }, l.account.puuid, edit),
            l.account.puuid,
          ),
        };
        demo.state = state;
        persistDemo();
      } else
        state = await (
          await getRuntime()
        ).applyAim(l.account.puuid, edit, { gameClosed, confirmedAt: Date.now() }, l.check);
      l.check();
      if (g === generation.current) {
        stateVersion.current++;
        setValue((v) => ({ ...v, state }));
      }
      return state;
    } finally {
      if (g === generation.current) setLoading(false);
    }
  }, []);
  const acceptAimServerState = useCallback(async () => {
    const l = lease();
    if (l.account.demo) return;
    const state = await (await getRuntime()).acceptAimServerState(l.account.puuid, l.check);
    l.check();
    stateVersion.current++;
    setValue((v) => ({ ...v, state }));
  }, []);
  return {
    aimState: value.id === account?.puuid ? value.state : {},
    aimPresets: value.id === account?.puuid ? value.presets : [],
    aimLoading: loading || !hydrated,
    syncAim,
    saveAimPreset,
    deleteAimPreset,
    applyAim,
    acceptAimServerState,
  };
}
