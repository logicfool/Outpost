import { unlockedLevels, unlockedChromas } from './loadoutOptions';
import type { Catalog } from './types';
import { AppError, object, requiredArray, text, uuid } from './validation';
export interface WeaponChoice {
  weaponId: string;
  skinId: string;
  levelId: string;
  chromaId: string;
}
export interface LoadoutPreset {
  id: string;
  accountId: string;
  name: string;
  weapons: WeaponChoice[];
  updatedAt: number;
}
export interface LoadoutEditor {
  current: WeaponChoice[];
  ownedLevels: string[];
  ownedChromas: string[];
  version?: number;
}
export function weaponChoices(raw: unknown): WeaponChoice[] {
  return requiredArray(object(raw).Guns, 'weapon loadout').map((value) => {
    const g = object(value);
    return {
      weaponId: uuid(g.ID),
      skinId: uuid(g.SkinID),
      levelId: uuid(g.SkinLevelID),
      chromaId: uuid(g.ChromaID),
    };
  });
}
export function validatePreset(p: LoadoutPreset, accountId: string): LoadoutPreset {
  if (uuid(p.accountId) !== uuid(accountId))
    throw new AppError('ACCOUNT_MISMATCH', 'This preset belongs to another account.');
  uuid(p.id);
  const name = p.name?.trim();
  if (
    !name ||
    name.length > 48 ||
    /[\x00-\x1f]/.test(name) ||
    !Array.isArray(p.weapons) ||
    !p.weapons.length ||
    p.weapons.length > 40
  )
    throw new AppError('PRESET_INVALID', 'Give this preset a name and select at least one weapon.');
  const ids = new Set<string>();
  const weapons = p.weapons.map((g) => {
    const slot = {
      weaponId: uuid(g.weaponId),
      skinId: uuid(g.skinId),
      levelId: uuid(g.levelId),
      chromaId: uuid(g.chromaId),
    };
    if (ids.has(slot.weaponId))
      throw new AppError('PRESET_INVALID', 'A weapon appears twice in this preset.');
    ids.add(slot.weaponId);
    return slot;
  });
  return { ...p, id: uuid(p.id), accountId: uuid(p.accountId), name, weapons };
}
export function preparePreset(
  raw: unknown,
  preset: LoadoutPreset,
  accountId: string,
  levels: Set<string>,
  chromas: Set<string>,
  catalog: Catalog,
) {
  preset = validatePreset(preset, accountId);
  const r = object(raw),
    current = weaponChoices(raw);
  if (
    !r.Identity ||
    typeof r.Incognito !== 'boolean' ||
    (!Array.isArray(r.ActiveExpressions) && !Array.isArray(r.Sprays))
  )
    throw new AppError('SCHEMA', 'The current loadout is incomplete. No preset was applied.');
  const replacements = new Map(preset.weapons.map((w) => [w.weaponId, w]));
  for (const desired of preset.weapons) {
    const old = current.find((g) => g.weaponId === desired.weaponId),
      skin =
        catalog.items[desired.skinId] ??
        Object.values(catalog.items).find(
          (i) => i.kind === 'skin' && i.canonicalId.toLowerCase() === desired.skinId.toLowerCase(),
        );
    if (!old) throw new AppError('PRESET_WEAPON', 'A saved weapon is not in the current loadout.');
    if (JSON.stringify(old) === JSON.stringify(desired)) continue;
    if (
      !skin ||
      skin.kind !== 'skin' ||
      skin.weaponId !== desired.weaponId ||
      !skin.levels?.some((l) => l.id === desired.levelId) ||
      !skin.chromas?.some((c) => c.id === desired.chromaId)
    )
      throw new AppError(
        'PRESET_CATALOG',
        'A selected skin, level or colour does not belong to this weapon. Refresh the catalog.',
      );
    if (
      !unlockedLevels(skin, { current, ownedLevels: [...levels], ownedChromas: [...chromas] }).some(
        (l) => l.id.toLowerCase() === desired.levelId.toLowerCase(),
      )
    )
      throw new AppError('ITEM_NOT_OWNED', 'A saved skin level is not unlocked on this account.');

    if (
      !unlockedChromas(skin, {
        current,
        ownedLevels: [...levels],
        ownedChromas: [...chromas],
      }).some((c) => c.id.toLowerCase() === desired.chromaId.toLowerCase())
    )
      throw new AppError(
        'ITEM_NOT_OWNED',
        'A saved colour variant is not unlocked on this account.',
      );
  }
  const Guns = requiredArray(r.Guns, 'weapons').map((v) => {
    const g = object(v),
      next = replacements.get(text(g.ID).toLowerCase());
    return next
      ? { ...g, SkinID: next.skinId, SkinLevelID: next.levelId, ChromaID: next.chromaId }
      : g;
  });

  return {
    Guns,
    Identity: r.Identity,
    Incognito: r.Incognito,
    ...(r.ActiveExpressions !== undefined ? { ActiveExpressions: r.ActiveExpressions } : {}),
    ...(r.Sprays !== undefined ? { Sprays: r.Sprays } : {}),
  };
}
export function verifyPreset(raw: unknown, wanted: WeaponChoice[]) {
  const current = weaponChoices(raw);
  for (const g of wanted)
    if (
      !current.some(
        (c) =>
          c.weaponId === g.weaponId &&
          c.skinId === g.skinId &&
          c.levelId === g.levelId &&
          c.chromaId === g.chromaId,
      )
    )
      throw new AppError(
        'SAVE_UNCONFIRMED',
        'Riot has not confirmed every preset slot. Reload before applying again.',
      );
}
