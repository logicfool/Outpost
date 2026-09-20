import { catalogItem } from './catalog';
import { ownedItemIds } from './ownership';
import type { Catalog, CatalogItem } from './types';
import { AppError, array, object, requiredArray, text, uuid } from './validation';

export const SPRAY_TYPE = 'd5f120f8-ff8c-4aac-92ea-f2b5acbe9475';
const EMPTY_ID = '00000000-0000-0000-0000-000000000000';

const SLOT_LABELS = ['Pre-round', 'Mid-round', 'Post-round', 'Flex'];

export interface SpraySlot {
  index: number;
  slotId: string;
  label: string;
  sprayId: string | null;
  item?: CatalogItem;
}
export interface SprayEdit {
  slotIndex: number;
  sprayId: string | null;
}

export function sprayArrayKey(raw: unknown): 'Sprays' | 'ActiveExpressions' {
  const r = object(raw);
  if (Array.isArray(r.Sprays)) return 'Sprays';
  if (Array.isArray(r.ActiveExpressions)) return 'ActiveExpressions';
  throw new AppError('SCHEMA', 'The current spray loadout is incomplete. No changes were sent.');
}

function slotSprayField(slot: Record<string, unknown>): string {
  for (const field of ['SprayID', 'AssetID', 'ID'] as const)
    if (typeof slot[field] === 'string') return field;
  throw new AppError(
    'SCHEMA',
    'Riot returned a spray slot without an identifier. No changes were sent.',
  );
}
function slotIdField(slot: Record<string, unknown>): string | undefined {
  for (const field of ['EquipSlotID', 'TypeID', 'SlotID'] as const)
    if (typeof slot[field] === 'string') return field;
  return undefined;
}

export function spraySlots(raw: unknown, catalog: Catalog): SpraySlot[] {
  const key = sprayArrayKey(raw);
  return requiredArray(object(raw)[key], 'spray loadout')
    .map(object)
    .map((slot, index) => {
      const idField = slotIdField(slot),
        sprayId = text(slot[slotSprayField(slot)]).toLowerCase();
      const equipped = sprayId && sprayId !== EMPTY_ID ? sprayId : null;
      return {
        index,
        slotId: idField ? text(slot[idField]).toLowerCase() : `slot-${index}`,
        label: SLOT_LABELS[index] ?? `Slot ${index + 1}`,
        sprayId: equipped,
        item: equipped ? catalogItem(catalog, equipped, 'spray') : undefined,
      };
    });
}

export function ownedSprays(raw: unknown, catalog: Catalog): CatalogItem[] {
  const owned = ownedItemIds(raw, SPRAY_TYPE);
  const unique = new Map<string, CatalogItem>();
  for (const id of owned) {
    const item = catalog.items[id.toLowerCase()];
    if (item?.kind !== 'spray') continue;
    unique.set(
      item.canonicalId.toLowerCase(),
      catalog.items[item.canonicalId.toLowerCase()] ?? item,
    );
  }
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function prepareSprayEdit(
  raw: unknown,
  edits: SprayEdit[],
  owned: Set<string>,
  expectedVersion?: number,
) {
  const current = object(raw),
    key = sprayArrayKey(raw);
  const slots = requiredArray(current[key], 'spray loadout').map(object);
  requiredArray(current.Guns, 'weapon loadout');
  if (!object(current.Identity).PlayerCardID || typeof current.Incognito !== 'boolean')
    throw new AppError('SCHEMA', 'The current loadout is incomplete. No changes were sent.');
  if (expectedVersion !== undefined && current.Version !== expectedVersion)
    throw new AppError(
      'LOADOUT_CONFLICT',
      'Your loadout changed in another client. Refresh before saving.',
    );
  if (!edits.length) throw new AppError('NO_CHANGE', 'Select a spray first.');

  const wanted = new Map<number, string | null>();
  for (const edit of edits) {
    if (!Number.isInteger(edit.slotIndex) || edit.slotIndex < 0 || edit.slotIndex >= slots.length)
      throw new AppError('SPRAY_SLOT', 'That spray slot is not in your loadout.');
    if (wanted.has(edit.slotIndex))
      throw new AppError('SPRAY_SLOT', 'A spray slot was selected twice.');
    const id = edit.sprayId === null ? null : uuid(edit.sprayId);
    if (id && !owned.has(id))
      throw new AppError('ITEM_NOT_OWNED', 'This spray is not in your collection.');
    wanted.set(edit.slotIndex, id);
  }

  const updated = slots.map((slot, index) => {
    if (!wanted.has(index)) return { ...slot };
    const field = slotSprayField(slot),
      next = wanted.get(index)!;
    return { ...slot, [field]: next ?? EMPTY_ID };
  });
  const used = new Set<string>();
  for (const slot of updated) {
    const id = text(slot[slotSprayField(slot)]).toLowerCase();
    if (!id || id === EMPTY_ID) continue;
    if (used.has(id))
      throw new AppError(
        'SPRAY_IN_USE',
        'A spray can fill only one wheel slot. Clear the other slot first.',
      );
    used.add(id);
  }
  return {
    Guns: current.Guns,
    [key]: updated,
    Identity: current.Identity,
    Incognito: current.Incognito,
    ...(key === 'Sprays' && current.ActiveExpressions !== undefined
      ? { ActiveExpressions: current.ActiveExpressions }
      : {}),
    ...(key === 'ActiveExpressions' && current.Sprays !== undefined
      ? { Sprays: current.Sprays }
      : {}),
  } as Record<string, unknown>;
}

export function verifySprayEdit(raw: unknown, body: Record<string, unknown>): void {
  const key = sprayArrayKey(raw);
  const actual = array(object(raw)[key]).map(object),
    wanted = array(body[key]).map(object);
  if (actual.length !== wanted.length)
    throw new AppError(
      'SAVE_UNCONFIRMED',
      'Riot has not confirmed this change. Refresh before trying again.',
    );
  for (const [index, slot] of wanted.entries()) {
    const confirmed = actual[index]!;
    if (
      text(confirmed[slotSprayField(confirmed)]).toLowerCase() !==
      text(slot[slotSprayField(slot)]).toLowerCase()
    ) {
      throw new AppError(
        'SAVE_UNCONFIRMED',
        'Riot has not confirmed every spray slot. Refresh before trying again.',
      );
    }
  }
}
