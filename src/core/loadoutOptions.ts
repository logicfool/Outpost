import type { Catalog, CatalogItem, CatalogMedia } from './types';
import type { LoadoutEditor, WeaponChoice } from './presets';
const key = (id: string) => id.toLowerCase();
export function weaponSkins(
  catalog: Catalog,
  editor: LoadoutEditor,
  weaponId: string,
): CatalogItem[] {
  const owned = new Set(editor.ownedLevels.map(key)),
    current = editor.current.find((w) => key(w.weaponId) === key(weaponId));
  const unique = new Map<string, CatalogItem>();
  for (const value of Object.values(catalog.items)) {
    if (value.kind !== 'skin' || value.weaponId?.toLowerCase() !== key(weaponId)) continue;
    const item = catalog.items[key(value.canonicalId)] ?? { ...value, id: value.canonicalId };
    if (
      !item.isDefault &&
      current?.skinId.toLowerCase() !== key(item.canonicalId) &&
      !owned.has(key(item.canonicalId)) &&
      !item.levels?.some((l) => owned.has(key(l.id)))
    )
      continue;
    unique.set(key(item.canonicalId), { ...item, id: item.canonicalId });
  }
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export function unlockedLevels(skin: CatalogItem, editor: LoadoutEditor): CatalogMedia[] {
  const owned = new Set(editor.ownedLevels.map(key)),
    current = editor.current.find((w) => key(w.skinId) === key(skin.canonicalId));
  const hasSkin =
    skin.isDefault === true ||
    !!current ||
    owned.has(key(skin.canonicalId)) ||
    skin.levels?.some((l) => owned.has(key(l.id)));
  return (skin.levels ?? []).filter(
    (level, i) =>
      owned.has(key(level.id)) ||
      current?.levelId.toLowerCase() === key(level.id) ||
      (i === 0 && hasSkin),
  );
}
export function unlockedChromas(skin: CatalogItem, editor: LoadoutEditor): CatalogMedia[] {
  if (!unlockedLevels(skin, editor).length) return [];
  const owned = new Set(editor.ownedChromas.map(key)),
    current = editor.current.find((w) => key(w.skinId) === key(skin.canonicalId));
  return (skin.chromas ?? []).filter(
    (c, i) => i === 0 || owned.has(key(c.id)) || current?.chromaId.toLowerCase() === key(c.id),
  );
}
export function chooseSkin(skin: CatalogItem, editor: LoadoutEditor): WeaponChoice | undefined {
  const level = unlockedLevels(skin, editor)[0],
    chroma = unlockedChromas(skin, editor)[0];
  return level && chroma && skin.weaponId
    ? { weaponId: skin.weaponId, skinId: skin.canonicalId, levelId: level.id, chromaId: chroma.id }
    : undefined;
}
