import type { Bundle, Catalog, CatalogItem, Store } from './types';
import { catalogItem, hydrateItem } from './catalog';
import { safeImage } from './validation';
export function bundleMeta(catalog: Catalog, id: string) {
  return (
    catalog.bundles[id.toLowerCase()] ??
    catalog.bundles[id] ??
    Object.entries(catalog.bundles).find(([key]) => key.toLowerCase() === id.toLowerCase())?.[1]
  );
}
export function bundleArtwork(
  id: string,
  ...sources: ({ image?: string; imageFallbacks?: string[] } | undefined)[]
): string[] {
  const key = id.toLowerCase(),
    valid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(key);
  return [
    ...new Set(
      [
        ...sources.flatMap((s) => [s?.image, ...(s?.imageFallbacks ?? [])]),
        ...(valid
          ? [
              `https://media.valorant-api.com/bundles/${key}/displayicon.png`,
              `https://media.valorant-api.com/bundles/${key}/displayicon2.png`,
            ]
          : []),
      ]
        .map(safeImage)
        .filter((u): u is string => !!u),
    ),
  ];
}
export function bundleContents(catalog: Catalog, id: string, store?: Store) {
  const active = store?.bundles.find(
    (b) =>
      b.id.toLowerCase() === id.toLowerCase() || b.catalogId?.toLowerCase() === id.toLowerCase(),
  );
  const catalogId = active?.catalogId ?? id,
    meta = bundleMeta(catalog, catalogId);
  const items: CatalogItem[] = active
    ? active.offers.map((o) => hydrateItem(catalog, o.item))
    : (meta?.itemIds ?? []).map((id) =>
        catalogItem(catalog, id, meta?.itemKinds?.[id] ?? 'unknown'),
      );
  const candidates = bundleArtwork(catalogId, meta, active);
  return {
    name:
      meta?.name && meta.name !== 'Featured collection'
        ? meta.name
        : (active?.name ?? meta?.name ?? 'Bundle'),
    image: candidates[0],
    imageFallbacks: candidates.slice(1),
    items: [...new Map(items.map((i) => [`${i.kind}:${i.canonicalId.toLowerCase()}`, i])).values()],
    source: active ? 'store' : meta?.membershipSource,
    active,
  };
}
export function rememberBundles(catalog: Catalog, bundles: Bundle[]): Catalog {
  const updated = { ...catalog.bundles };
  let changed = false;
  for (const bundle of bundles) {
    const id = (bundle.catalogId ?? bundle.id).toLowerCase();
    if (!id || !bundle.offers.length) continue;
    const previous = bundleMeta(catalog, id);
    const ids = [
      ...new Set(bundle.offers.map((o) => o.item.canonicalId.toLowerCase()).filter(Boolean)),
    ];
    const kinds = Object.fromEntries(
      bundle.offers.map((o) => [o.item.canonicalId.toLowerCase(), o.item.kind]),
    );
    if (
      previous?.membershipSource === 'store' &&
      JSON.stringify(previous.itemIds) === JSON.stringify(ids) &&
      JSON.stringify(previous.itemKinds) === JSON.stringify(kinds)
    )
      continue;
    updated[id] = {
      ...previous,
      name: previous?.name ?? bundle.name,
      image: previous?.image ?? bundle.image,
      imageFallbacks: previous?.imageFallbacks ?? bundle.imageFallbacks,
      itemIds: ids,
      itemKinds: kinds,
      membershipSource: 'store',
    };
    changed = true;
  }
  return changed ? { ...catalog, bundles: updated } : catalog;
}
