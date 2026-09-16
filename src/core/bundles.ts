import type { Bundle, Catalog, CatalogItem, Store } from './types';
import { hydrateItem } from './catalog';
export function bundleContents(catalog: Catalog, id: string, store?: Store) {
  const active = store?.bundles.find((b) => b.id === id || b.catalogId === id);
  const meta = catalog.bundles[active?.catalogId ?? id];
  const items: CatalogItem[] = active
    ? active.offers.map((o) => hydrateItem(catalog, o.item))
    : (meta?.itemIds ?? []).flatMap((id) => (catalog.items[id] ? [catalog.items[id]!] : []));
  return {
    name: active?.name ?? meta?.name ?? 'Bundle',
    image: active?.image ?? meta?.image,
    items: [...new Map(items.map((i) => [i.canonicalId, i])).values()],
    source: active ? 'store' : meta?.membershipSource,
    active,
  };
}
export function rememberBundles(catalog: Catalog, bundles: Bundle[]): Catalog {
  const updated = { ...catalog.bundles };
  let changed = false;
  for (const bundle of bundles) {
    const id = bundle.catalogId ?? bundle.id;
    if (!updated[id] || !bundle.offers.length) continue;
    const ids = [...new Set(bundle.offers.map((o) => o.item.canonicalId))];
    if (
      updated[id]!.membershipSource === 'store' &&
      JSON.stringify(updated[id]!.itemIds) === JSON.stringify(ids)
    )
      continue;
    updated[id] = { ...updated[id]!, itemIds: ids, membershipSource: 'store' };
    changed = true;
  }
  return changed ? { ...catalog, bundles: updated } : catalog;
}
