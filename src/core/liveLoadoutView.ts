import type { Catalog } from './types';
import type { LiveWeapon } from './matchTypes';
import { hydrateItem } from './catalog';
const categories = ['Sidearms', 'SMGs', 'Shotguns', 'Rifles', 'Snipers', 'Heavy', 'Melee', 'Other'];
export function liveWeaponCategory(weapon: LiveWeapon, catalog: Catalog): string {
  const raw = (weapon.category ?? catalog.weapons?.[weapon.weaponId]?.category ?? '')
    .split('::')
    .pop()
    ?.toLowerCase();
  const map: Record<string, string> = {
    sidearm: 'Sidearms',
    sidearms: 'Sidearms',
    smg: 'SMGs',
    shotgun: 'Shotguns',
    rifle: 'Rifles',
    sniper: 'Snipers',
    heavy: 'Heavy',
    melee: 'Melee',
  };
  if (raw && map[raw]) return map[raw];
  if (/^(classic|shorty|frenzy|ghost|sheriff|bandit)$/i.test(weapon.weapon)) return 'Sidearms';
  if (/^(knife|melee|blade)$/i.test(weapon.weapon)) return 'Melee';
  return 'Other';
}
export function liveLoadoutRows(
  weapons: readonly LiveWeapon[],
  catalog: Catalog,
  category = 'All',
  query = '',
): LiveWeapon[] {
  const term = query.trim().toLocaleLowerCase();
  return weapons
    .filter(
      (w) =>
        (category === 'All' || liveWeaponCategory(w, catalog) === category) &&
        (!term ||
          `${w.weapon} ${w.skin?.name ?? ''} ${w.buddy?.name ?? ''}`
            .toLocaleLowerCase()
            .includes(term)),
    )
    .sort(
      (a, b) =>
        categories.indexOf(liveWeaponCategory(a, catalog)) -
          categories.indexOf(liveWeaponCategory(b, catalog)) || a.weapon.localeCompare(b.weapon),
    );
}
export function liveLoadoutCategories(weapons: readonly LiveWeapon[], catalog: Catalog): string[] {
  const values = new Set(weapons.map((w) => liveWeaponCategory(w, catalog)));
  return ['All', ...categories.filter((c) => values.has(c))];
}
export function liveWeaponLabels(weapon: LiveWeapon, catalog: Catalog) {
  const skin = weapon.skin ? hydrateItem(catalog, weapon.skin) : undefined;
  const candidate = skin ? catalog.items[skin.canonicalId] : undefined;
  const base =
    candidate?.kind === 'skin' && (!candidate.weaponId || candidate.weaponId === weapon.weaponId)
      ? candidate
      : undefined;
  const name = base?.name ?? skin?.name ?? 'Skin not reported';
  const level = weapon.levelId
    ? base?.levels?.findIndex((l) => l.id === weapon.levelId)
    : undefined;
  const levelLabel =
    level !== undefined && level >= 0 && (base?.levels?.length ?? 0) > 1
      ? `Level ${level + 1}`
      : undefined;
  const variant =
    skin?.kind === 'chroma' && skin.name !== name
      ? skin.name
          .replace(name, '')
          .replace(/^\s*[-(]|\)\s*$/g, '')
          .trim() || 'Selected variant'
      : undefined;
  return { skin, base, name, levelLabel, variant };
}
