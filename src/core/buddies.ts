import type { Catalog, CatalogItem } from './types';
import { AppError, array, object, text, uuid } from './validation';
import { ownedItemIds } from './ownership';
export const BUDDY_TYPE = 'dd3bf334-87f3-40bd-b043-682a57a8dc3a';
export const MELEE_ID = '2f59173c-4bed-b6c3-2191-dea9b58be9c7';
const EMPTY_ID = '00000000-0000-0000-0000-000000000000';
export interface BuddyChoice {
  buddyId: string;
  levelId: string;
  instanceId: string;
}
export interface OwnedBuddy extends BuddyChoice {
  item: CatalogItem;
}
const hasId = (v: unknown) => !!text(v) && text(v) !== EMPTY_ID;
export function validateBuddy(value: BuddyChoice): BuddyChoice {
  const choice = {
    buddyId: uuid(value.buddyId),
    levelId: uuid(value.levelId),
    instanceId: uuid(value.instanceId),
  };
  if (Object.values(choice).some((id) => id === EMPTY_ID))
    throw new AppError('BUDDY_INVALID', 'Select an owned buddy copy.');
  return choice;
}
export function equippedBuddy(raw: unknown): BuddyChoice | null | undefined {
  const g = object(raw);
  if (![g.CharmID, g.CharmLevelID, g.CharmInstanceID].some(hasId)) return null;
  if (![g.CharmID, g.CharmLevelID, g.CharmInstanceID].every(hasId)) return undefined;
  try {
    return validateBuddy({
      buddyId: text(g.CharmID),
      levelId: text(g.CharmLevelID),
      instanceId: text(g.CharmInstanceID),
    });
  } catch {
    return undefined;
  }
}
export function sameBuddy(
  a: BuddyChoice | null | undefined,
  b: BuddyChoice | null | undefined,
): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.buddyId === b.buddyId &&
      a.levelId === b.levelId &&
      a.instanceId === b.instanceId)
  );
}
export function ownedBuddies(raw: unknown, catalog: Catalog): OwnedBuddy[] {
  ownedItemIds(raw, BUDDY_TYPE);
  const r = object(raw),
    entries = Array.isArray(r.EntitlementsByTypes)
      ? r.EntitlementsByTypes.map(object)
          .filter((g) => text(g.ItemTypeID).toLowerCase() === BUDDY_TYPE)
          .flatMap((g) => array(g.Entitlements))
      : array(r.Entitlements);
  const copies = new Map<string, OwnedBuddy>();
  for (const value of entries.slice(0, 10000)) {
    const e = object(value),
      id = text(e.ItemID).toLowerCase(),
      instanceId = text(e.InstanceID).toLowerCase();
    const item = catalog.items[id];
    if (!hasId(instanceId) || item?.kind !== 'buddy') continue;
    const levelId =
      item.levels?.find((l) => l.id === id)?.id ??
      (id === item.canonicalId ? item.levels?.[0]?.id : undefined);
    if (!levelId) continue;
    const copy = {
      ...validateBuddy({ buddyId: item.canonicalId, levelId, instanceId }),
      item: catalog.items[item.canonicalId] ?? item,
    };
    const old = copies.get(instanceId);
    if (old && !sameBuddy(old, copy))
      throw new AppError('BUDDY_INVALID', 'Riot returned conflicting buddy copies.');
    copies.set(instanceId, copy);
  }
  return [...copies.values()].sort(
    (a, b) => a.item.name.localeCompare(b.item.name) || a.instanceId.localeCompare(b.instanceId),
  );
}

export function applyBuddyChoices(
  guns: Record<string, unknown>[],
  desired: Map<string, { buddy?: BuddyChoice | null }>,
  owned: OwnedBuddy[],
) {
  const result = guns.map((old) => {
    const next = desired.get(text(old.ID).toLowerCase());
    if (!next || next.buddy === undefined) return { ...old };
    if (text(old.ID).toLowerCase() === MELEE_ID)
      throw new AppError('BUDDY_MELEE', 'Melee weapons do not support buddies.');
    if (next.buddy && !owned.some((copy) => sameBuddy(copy, next.buddy)))
      throw new AppError('BUDDY_NOT_OWNED', 'This buddy copy is not available on this account.');
    const { CharmID, CharmLevelID, CharmInstanceID, ...gun } = old;
    return next.buddy
      ? {
          ...gun,
          CharmID: next.buddy.buddyId,
          CharmLevelID: next.buddy.levelId,
          CharmInstanceID: next.buddy.instanceId,
        }
      : gun;
  });
  const used = new Set<string>();
  for (const gun of result) {
    const instance = text(object(gun).CharmInstanceID).toLowerCase();
    if (!hasId(instance)) continue;
    if (used.has(instance))
      throw new AppError(
        'BUDDY_IN_USE',
        'A buddy copy can be equipped on only one weapon. Remove it from the other slot first.',
      );
    used.add(instance);
  }
  return result;
}
