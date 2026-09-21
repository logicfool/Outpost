import type { Catalog, CatalogItem } from './types';
import { hydrateItem } from './catalog';
const indices = new WeakMap<Catalog['items'], { items: CatalogItem[]; weapons: string[] }>();
const ownedViews = new WeakMap<CatalogItem[], WeakMap<Catalog['items'], CatalogItem[]>>();
/** Build the public browsing projection once per immutable catalogue, not on every modal. */
export function catalogueBrowse(catalog: Catalog) {
  const old = indices.get(catalog.items);
  if (old) return old;
  const byId = new Map<string, CatalogItem>();
  for (const item of Object.values(catalog.items)) {
    byId.set(
      item.kind === 'chroma' ? item.id : `${item.kind}:${item.canonicalId}`,
      item.kind === 'chroma' ? item : { ...item, id: item.canonicalId },
    );
  }
  const items = [...byId.values()]
    .map((item) => hydrateItem(catalog, item))
    .sort((a, b) => a.name.localeCompare(b.name));
  const weapons = [
    ...new Set(
      items.filter((item) => item.kind === 'skin' && item.weapon).map((item) => item.weapon!),
    ),
  ].sort();
  const result = { items, weapons };
  indices.set(catalog.items, result);
  return result;
}
/** Owned browsing need not materialize the much larger public catalogue first. */
export function ownedBrowse(items: CatalogItem[], catalog: Catalog): CatalogItem[] {
  let variants = ownedViews.get(items);
  if (!variants) {
    variants = new WeakMap();
    ownedViews.set(items, variants);
  }
  let sorted = variants.get(catalog.items);
  if (!sorted) {
    sorted = items
      .map((item) => hydrateItem(catalog, item))
      .sort((a, b) => a.name.localeCompare(b.name));
    variants.set(catalog.items, sorted);
  }
  return sorted;
}
export const EMPTY_BROWSE: CatalogItem[] = [];
