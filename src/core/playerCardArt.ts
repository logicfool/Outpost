import type { Catalog, CatalogItem } from './types';
import { safeImage } from './validation';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function cardFallbackArt(
  raw: string,
): Pick<CatalogItem, 'image' | 'smallArt' | 'wideArt' | 'wallpaper'> {
  const id = raw.toLowerCase();
  if (!UUID.test(id) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(id)) return {};
  const base = `https://media.valorant-api.com/playercards/${id}`;
  return {
    image: `${base}/displayicon.png`,
    smallArt: `${base}/smallart.png`,
    wideArt: `${base}/wideart.png`,
    wallpaper: `${base}/largeart.png`,
  };
}
export function cardArtworkCandidates(
  card: CatalogItem | undefined,
  format: 'square' | 'wide' | 'large',
  catalog?: Catalog,
): string[] {
  if (!card) return [];
  const fresh =
    catalog?.items[card.id.toLowerCase()] ?? catalog?.items[card.canonicalId.toLowerCase()];
  const generated = card.kind === 'card' ? cardFallbackArt(card.canonicalId || card.id) : {};
  const items = [fresh, card, generated].filter(Boolean) as Partial<CatalogItem>[];
  const fields: ('image' | 'smallArt' | 'wideArt' | 'wallpaper')[] =
    format === 'square'
      ? ['image', 'smallArt']
      : format === 'wide'
        ? ['wideArt', 'wallpaper', 'image']
        : ['wallpaper', 'wideArt', 'image'];
  const urls = fields.flatMap((field) => items.map((item) => item[field]));
  return [
    ...new Set(
      urls
        .map(safeImage)
        .filter(
          (url): url is string =>
            !!url && (format !== 'square' || /\/(?:smallart|displayicon)\./i.test(url)),
        ),
    ),
  ];
}
