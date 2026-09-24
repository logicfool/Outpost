import type { Catalog, CatalogItem, Snapshot, Store } from './types';
import type { CatalogPath } from './catalog';
import { hydrateItem } from './catalog';
import { bundleContents, bundleMeta } from './bundles';
import { hydrateMatchSummary } from './maps';
const paths: Partial<Record<CatalogItem['kind'], CatalogPath>> = {
  skin: 'weapons',
  chroma: 'weapons',
  card: 'playercards',
  buddy: 'buddies',
  spray: 'sprays',
  title: 'playertitles',
  agent: 'agents',
};
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function missingCatalogPaths(
  snapshot: Snapshot | null | undefined,
  catalog: Catalog,
): CatalogPath[] {
  if (!snapshot) return [];
  const needed = new Set<CatalogPath>();
  const inspect = (item: CatalogItem) => {
    if (!UUID.test(item.id)) return;
    const meta =
      catalog.items[item.id.toLowerCase()] ?? catalog.items[item.canonicalId.toLowerCase()];
    if (
      (!meta || meta.name.startsWith('Unresolved') || (item.kind === 'card' && !meta.wideArt)) &&
      paths[item.kind]
    )
      needed.add(paths[item.kind]!);
  };
  if (snapshot.loadout.status === 'ready' && snapshot.loadout.data.card)
    inspect(snapshot.loadout.data.card);
  if (snapshot.collection.status === 'ready')
    for (const item of snapshot.collection.data) inspect(item);
  if (snapshot.store.status === 'ready') {
    const store = snapshot.store.data;
    for (const offer of [
      ...store.daily,
      ...store.accessories,
      ...(store.nightMarket?.offers ?? []),
      ...store.bundles.flatMap((b) => b.offers),
    ])
      inspect(offer.item);
    for (const b of store.bundles) {
      const meta = bundleMeta(catalog, b.catalogId ?? b.id);
      if (!meta?.image || !meta?.name || meta.name === 'Featured collection') needed.add('bundles');
    }
  }
  return [...needed].slice(0, 7);
}
export function hydrateStore(catalog: Catalog, store: Store): Store {
  const offers = (list: Store['daily']) =>
    list.map((o) => ({ ...o, item: hydrateItem(catalog, o.item) }));
  return {
    ...store,
    daily: offers(store.daily),
    accessories: offers(store.accessories),
    nightMarket: store.nightMarket
      ? { ...store.nightMarket, offers: offers(store.nightMarket.offers) }
      : null,
    bundles: store.bundles.map((b) => {
      const fresh = bundleContents(catalog, b.id, store);
      return {
        ...b,
        name: fresh.name,
        image: fresh.image,
        imageFallbacks: fresh.imageFallbacks,
        offers: offers(b.offers),
      };
    }),
  };
}
export function hydrateSnapshotMetadata(catalog: Catalog, snapshot: Snapshot): Snapshot {
  const next = { ...snapshot };
  if (snapshot.store.status === 'ready')
    next.store = { ...snapshot.store, data: hydrateStore(catalog, snapshot.store.data) };
  if (snapshot.loadout.status === 'ready') {
    const d = snapshot.loadout.data;
    next.loadout = {
      ...snapshot.loadout,
      data: {
        ...d,
        card: d.card ? hydrateItem(catalog, d.card) : undefined,
        title: d.title ? hydrateItem(catalog, d.title) : undefined,
        guns: d.guns.map((g) => ({
          ...g,
          skin: hydrateItem(catalog, g.skin),
          buddy: g.buddy ? hydrateItem(catalog, g.buddy) : undefined,
        })),
      },
    };
  }
  if (snapshot.collection.status === 'ready')
    next.collection = {
      ...snapshot.collection,
      data: snapshot.collection.data.map((i) => hydrateItem(catalog, i)),
    };
  if (snapshot.matches.status === 'ready')
    next.matches = {
      ...snapshot.matches,
      data: snapshot.matches.data.map((m) => hydrateMatchSummary(catalog, m)),
    };
  return next;
}
