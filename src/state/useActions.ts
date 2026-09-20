import { MELEE_ID, type BuddyChoice, type OwnedBuddy } from '../core/buddies';
import { useCallback, useRef } from 'react';
import type { Account, Catalog, Snapshot, Loadout } from '../core/types';
import type { LoadoutPreset, LoadoutEditor } from '../core/presets';
import type { PurchaseQuote, PurchaseRecord } from '../core/purchases';
import { validatePreset } from '../core/presets';
import { quoteBundlePurchase } from '../core/bundlePurchase';
import { quotePurchase } from '../core/purchases';
import { AppError } from '../core/validation';
import { randomId } from '../platform/secure';
import { getRuntime } from '../platform/runtime';
const demoBuddyChoices = new Map<string, BuddyChoice | null>();
const demoPresets = new Map<string, LoadoutPreset>();
export function useActions(
  account: Account | null,
  catalog: Catalog,
  snapshot: Snapshot | null,
  updated: (loadout: Loadout) => void,
  catalogLoaded: (catalog: Catalog) => void,
  snapshotLoaded: (snapshot: Snapshot) => void,
  selection?: () => { accountId?: string; revision: number },
) {
  const current = useRef({
    account,
    catalog,
    snapshot,
    updated,
    catalogLoaded,
    snapshotLoaded,
    selection,
  });
  current.current = {
    account,
    catalog,
    snapshot,
    updated,
    catalogLoaded,
    snapshotLoaded,
    selection,
  };
  const selected = () => {
    const a = current.current.account;
    if (!a) throw new AppError('NO_ACCOUNT', 'Select an account.');
    if (current.current.selection && current.current.selection().accountId !== a.puuid)
      throw new AppError('ACCOUNT_CHANGED', 'The selected account changed.');
    return a;
  };
  const assertCurrent = (id: string) => {
    if (current.current.account?.puuid !== id)
      throw new AppError('ACCOUNT_CHANGED', 'The selected account changed.');
  };
  const listPresets = useCallback(async () => {
    const a = selected();
    const result = a.demo
      ? [...demoPresets.values()]
      : (await getRuntime()).repository.presets(a.puuid);
    return await result;
  }, []);
  const editLoadout = useCallback(async (): Promise<LoadoutEditor> => {
    const a = selected();
    if (a.demo) {
      const items = Object.values(current.current.catalog.items).filter((i) => i.kind === 'skin');
      const seen = new Set<string>();
      return {
        current: items
          .filter((i) => !seen.has(i.weapon ?? '') && !!seen.add(i.weapon ?? ''))
          .map((i, n) => ({
            weaponId: i.weaponId ?? `00000000-0000-4000-8070-${String(n + 1).padStart(12, '0')}`,
            skinId: i.canonicalId,
            levelId: i.levels?.[0]?.id ?? i.id,
            chromaId: i.chromas?.[0]?.id ?? i.id,
            ...(demoBuddyChoices.has(
              i.weaponId ?? `00000000-0000-4000-8070-${String(n + 1).padStart(12, '0')}`,
            )
              ? {
                  buddy: demoBuddyChoices.get(
                    i.weaponId ?? `00000000-0000-4000-8070-${String(n + 1).padStart(12, '0')}`,
                  ),
                }
              : {}),
          })),
        ownedBuddies: Object.values(current.current.catalog.items)
          .filter((i) => i.kind === 'buddy' && i.id === i.canonicalId)
          .map((item, n) => ({
            buddyId: item.canonicalId,
            levelId: item.levels?.[0]?.id ?? item.id,
            instanceId: `00000000-0000-4000-8080-${String(n + 1).padStart(12, '0')}`,
            item,
          })),
        ownedLevels: items.flatMap((i) => (i.levels ?? []).map((l) => l.id)),
        ownedChromas: items.flatMap((i) => (i.chromas ?? []).map((c) => c.id)),
      };
    }
    const runtime = await getRuntime(),
      data = await runtime.loadoutEditor(a.puuid);
    assertCurrent(a.puuid);
    current.current.catalogLoaded(runtime.catalog);
    return data;
  }, []);
  const savePreset = useCallback(
    async (name: string, weapons: LoadoutPreset['weapons'], id?: string) => {
      const a = selected(),
        p = validatePreset(
          { id: id ?? randomId(), accountId: a.puuid, name, weapons, updatedAt: Date.now() },
          a.puuid,
        );
      if (a.demo) demoPresets.set(p.id, p);
      else await (await getRuntime()).repository.savePreset(p);
      assertCurrent(a.puuid);
      return p;
    },
    [],
  );
  const deletePreset = useCallback(async (id: string) => {
    const a = selected();
    if (a.demo) demoPresets.delete(id);
    else await (await getRuntime()).repository.deletePreset(a.puuid, id);
  }, []);
  const applyPreset = useCallback(async (preset: LoadoutPreset) => {
    const a = selected();
    validatePreset(preset, a.puuid);
    if (a.demo) return;
    const data = await (await getRuntime()).applyPreset(a.puuid, preset);
    assertCurrent(a.puuid);
    current.current.updated(data);
  }, []);
  const applyBuddy = useCallback(
    async (weaponId: string, buddy: BuddyChoice | null, version?: number) => {
      const a = selected();
      if (a.demo) {
        demoBuddyChoices.set(weaponId, buddy);
        return;
      }
      const lease = current.current.selection?.();
      const guard = () => {
        assertCurrent(a.puuid);
        const latest = current.current.selection?.();
        if (lease && (latest?.accountId !== lease.accountId || latest?.revision !== lease.revision))
          throw new AppError('ACCOUNT_CHANGED', 'The selected account changed before applying.');
      };
      const data = await (await getRuntime()).saveBuddy(a.puuid, weaponId, buddy, version, guard);
      assertCurrent(a.puuid);
      current.current.updated(data);
    },
    [],
  );
  const purchaseQuote = useCallback(
    async (itemId: string, kind: 'skin' | 'bundle' = 'skin'): Promise<PurchaseQuote> => {
      const a = selected();
      if (a.demo) {
        const s = current.current.snapshot;
        if (s?.store.status !== 'ready' || s.wallet.status !== 'ready')
          throw new AppError('DEMO', 'No demo store.');
        return kind === 'bundle'
          ? quoteBundlePurchase(
              s.store.data,
              s.wallet.data,
              itemId,
              a.puuid,
              randomId(),
              new Map(
                (
                  s.store.data.bundles.find((b) => b.id === itemId || b.catalogId === itemId)
                    ?.checkout?.lines ?? []
                ).map((l) => [l.itemTypeId, new Map()]),
              ),
              current.current.catalog,
            )
          : quotePurchase(s.store.data, s.wallet.data, itemId, a.puuid, randomId());
      }
      const prefs = await (await getRuntime()).repository.settings();
      if (!prefs.allowPurchases)
        throw new AppError('PURCHASE_DISABLED', 'Enable phone purchases in Settings first.');
      const q = await (await getRuntime()).purchaseQuote(a.puuid, itemId, kind);
      assertCurrent(a.puuid);
      return q;
    },
    [],
  );
  const confirmPurchase = useCallback(async (id: string): Promise<PurchaseRecord> => {
    const a = selected();
    if (a.demo) throw new AppError('DEMO_ONLY', 'Demo purchases never contact Riot or spend VP.');
    const lease = current.current.selection?.();
    const guard = () => {
      assertCurrent(a.puuid);
      const actual = current.current.selection?.();
      if (lease && (actual?.accountId !== lease.accountId || actual?.revision !== lease.revision))
        throw new AppError(
          'ACCOUNT_CHANGED',
          'The account selection changed after confirmation. Review a fresh quote.',
        );
    };
    const runtime = await getRuntime();
    guard();
    const record = await runtime.confirmPurchase(a.puuid, id, guard);
    assertCurrent(a.puuid);
    const saved = await runtime.repository.snapshot(a.puuid);
    assertCurrent(a.puuid);
    if (saved) current.current.snapshotLoaded(saved);
    return record;
  }, []);
  const purchaseRecords = useCallback(async () => {
    const a = selected();
    return a.demo ? [] : (await getRuntime()).repository.purchaseRecords(a.puuid);
  }, []);
  const checkPurchase = useCallback(async (id: string) => {
    const a = selected();
    const runtime = await getRuntime(),
      record = await runtime.checkPurchase(a.puuid, id);
    assertCurrent(a.puuid);
    const cached = await runtime.repository.snapshot(a.puuid);
    assertCurrent(a.puuid);
    if (cached) current.current.snapshotLoaded(cached);
    return record;
  }, []);
  return {
    applyBuddy,
    listPresets,
    editLoadout,
    savePreset,
    deletePreset,
    applyPreset,
    purchaseQuote,
    confirmPurchase,
    purchaseRecords,
    checkPurchase,
  };
}
