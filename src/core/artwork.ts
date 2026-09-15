import type { Catalog, CatalogItem, Snapshot } from './types';
import { hydrateItem } from './catalog';
import { safeImage } from './validation';

export function artworkCandidates(item: CatalogItem): string[] {
  return [
    ...new Set(
      [
        item.image,
        ...(item.imageFallbacks ?? []),
        ...(item.kind === 'card' ? [item.wideArt, item.wallpaper] : []),
      ]
        .map(safeImage)
        .filter((u): u is string => !!u),
    ),
  ];
}

export function priorityArtwork(snapshot: Snapshot | null, catalog: Catalog): string[] {
  if (!snapshot) return [];
  const items: CatalogItem[] = [];
  if (snapshot.loadout.status === 'ready' && snapshot.loadout.data.card)
    items.push(snapshot.loadout.data.card);
  if (snapshot.store.status === 'ready')
    items.push(
      ...snapshot.store.data.accessories.map((o) => o.item),
      ...snapshot.store.data.daily.map((o) => o.item),
    );
  return [
    ...new Set(
      items.flatMap((old) => {
        const item = hydrateItem(catalog, old);
        return [item.kind === 'card' ? item.wideArt : undefined, artworkCandidates(item)[0]].filter(
          (u): u is string => !!u,
        );
      }),
    ),
  ].slice(0, 16);
}
