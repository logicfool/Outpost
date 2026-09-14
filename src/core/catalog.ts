import type { Catalog, CatalogItem, ItemKind, JsonObject } from './types';
import { EMPTY_CATALOG } from './types';
import { array, number, object, safeImage, safeMedia, text, timestamp } from './validation';
import { HttpClient, SingleFlightCache } from './http';
export const PUBLIC_ORIGIN = 'https://valorant-api.com';
export const CATALOG_PATHS = [
  'weapons',
  'buddies',
  'sprays',
  'playercards',
  'playertitles',
  'agents',
  'bundles',
  'maps',
  'competitivetiers',
  'contracts',
  'seasons',
] as const;
export type CatalogPath = (typeof CATALOG_PATHS)[number];
function dataList(value: unknown) {
  return array(object(value).data);
}
function rarity(id: string) {
  return (
    {
      '0cebb8be-46d7-c12a-d306-e9907bfc5a25': 'Deluxe',
      'e046854e-406c-37f4-6607-19a9ba8426fc': 'Exclusive',
      '60bca009-4182-7998-dee7-b8a2558dc369': 'Premium',
      '12683d76-48d7-84a3-4e09-6985794f0445': 'Select',
      '411e4a55-4e59-7757-41f0-86a53f101bb5': 'Ultra',
    } as Record<string, string>
  )[id];
}
export function buildCatalog(
  responses: Partial<Record<CatalogPath, unknown>>,
  now = Date.now(),
): Catalog {
  const catalog: Catalog = {
    ...EMPTY_CATALOG,
    items: Object.create(null),
    bundles: Object.create(null),
    maps: Object.create(null),
    tiers: Object.create(null),
    contracts: Object.create(null),
    seasons: Object.create(null),
    fetchedAt: now,
  };
  const add = (id: string, item: CatalogItem) => {
    if (id && id !== '__proto__')
      catalog.items[id.toLowerCase()] = { ...item, id: id.toLowerCase() };
  };
  for (const rawWeapon of dataList(responses.weapons)) {
    const weapon = object(rawWeapon);
    for (const rawSkin of array(weapon.skins)) {
      const skin = object(rawSkin),
        levels = array(skin.levels).map(object),
        chromas = array(skin.chromas).map(object);
      const levelMedia = levels.map((level, index) => ({
        id: text(level.uuid),
        name: text(level.displayName, `Level ${index + 1}`),
        image: safeImage(level.displayIcon),
        video: safeMedia(level.streamedVideo),
      }));
      const chromaMedia = chromas.map((chroma, index) => ({
        id: text(chroma.uuid),
        name: text(chroma.displayName, `Variant ${index + 1}`),
        image: safeImage(chroma.fullRender) ?? safeImage(chroma.displayIcon),
        video: safeMedia(chroma.streamedVideo),
      }));
      const video =
        levelMedia.find((v) => v.video)?.video ?? chromaMedia.find((v) => v.video)?.video;
      const item: CatalogItem = {
        id: text(skin.uuid),
        canonicalId: text(skin.uuid),
        name: text(skin.displayName),
        kind: 'skin',
        weapon: text(weapon.displayName),
        image:
          safeImage(skin.displayIcon) ??
          safeImage(levels[0]?.displayIcon) ??
          safeImage(chromas[0]?.fullRender),
        wallpaper: safeImage(skin.wallpaper),
        rarity: rarity(text(skin.contentTierUuid)),
        video,
        levels: levelMedia,
        chromas: chromaMedia,
      };
      add(item.id, item);
      for (const level of levels)
        add(text(level.uuid), {
          ...item,
          image: safeImage(level.displayIcon) ?? item.image,
          video: safeMedia(level.streamedVideo) ?? item.video,
        });
      for (const chroma of chromas)
        add(text(chroma.uuid), {
          ...item,
          kind: 'chroma',
          name: text(chroma.displayName, item.name),
          image: safeImage(chroma.fullRender) ?? safeImage(chroma.displayIcon) ?? item.image,
          video: safeMedia(chroma.streamedVideo) ?? item.video,
        });
    }
  }
  const categories: [CatalogPath, ItemKind][] = [
    ['buddies', 'buddy'],
    ['sprays', 'spray'],
    ['playercards', 'card'],
    ['playertitles', 'title'],
    ['agents', 'agent'],
  ];
  for (const [path, kind] of categories)
    for (const raw of dataList(responses[path])) {
      const entry = object(raw);
      if (path === 'agents' && entry.isPlayableCharacter === false) continue;
      const item: CatalogItem = {
        id: text(entry.uuid),
        canonicalId: text(entry.uuid),
        name: text(entry.displayName),
        kind,
        image: safeImage(entry.displayIcon) ?? safeImage(entry.smallArt),
        wallpaper: safeImage(entry.largeArt) ?? safeImage(entry.fullPortrait),
        wideArt: safeImage(entry.wideArt),
      };
      add(item.id, item);
      for (const level of array(entry.levels).map(object))
        add(text(level.uuid), { ...item, image: safeImage(level.displayIcon) ?? item.image });
    }
  for (const raw of dataList(responses.bundles)) {
    const e = object(raw);
    catalog.bundles[text(e.uuid)] = { name: text(e.displayName), image: safeImage(e.displayIcon) };
  }
  for (const raw of dataList(responses.maps)) {
    const e = object(raw),
      item = {
        name: text(e.displayName),
        image: safeImage(e.splash),
        listImage: safeImage(e.listViewIcon),
      };
    catalog.maps[text(e.mapUrl)] = item;
    catalog.maps[text(e.uuid)] = item;
  }
  const tierSets = dataList(responses.competitivetiers);
  for (const raw of array(object(tierSets[tierSets.length - 1]).tiers)) {
    const e = object(raw),
      color = text(e.color);
    catalog.tiers[String(number(e.tier))] = {
      name: text(e.tierName),
      image: safeImage(e.largeIcon) ?? safeImage(e.smallIcon),
      color: /^[0-9a-f]{6}/i.test(color) ? `#${color.slice(0, 6)}` : undefined,
    };
  }
  const seasonList = dataList(responses.seasons).map(object);
  for (const season of seasonList) {
    if (!season.parentUuid) continue;
    const parent = seasonList.find((s) => s.uuid === season.parentUuid);
    catalog.seasons![text(season.uuid)] = {
      name:
        text(season.title) ||
        [text(parent?.displayName), text(season.displayName)].filter(Boolean).join(' // ') ||
        'Act',
      startsAt: timestamp(season.startTime),
    };
  }
  for (const raw of dataList(responses.contracts)) {
    const e = object(raw),
      content = object(e.content);
    const levels: { xp: number; rewardId?: string }[] = [];
    for (const chapter of array(content.chapters).map(object))
      for (const level of array(chapter.levels).map(object))
        levels.push({
          xp: number(level.xp),
          rewardId: text(object(level.reward).uuid) || undefined,
        });
    catalog.contracts[text(e.uuid)] = {
      id: text(e.uuid),
      name: text(e.displayName),
      relationId: text(content.relationUuid) || undefined,
      relationType: text(content.relationType) || undefined,
      levels,
    };
  }
  const seasons = dataList(responses.seasons)
    .map(object)
    .filter(
      (s) =>
        s.parentUuid &&
        (timestamp(s.startTime) ?? Infinity) <= now &&
        (timestamp(s.endTime) ?? 0) > now,
    )
    .sort((a, b) => (timestamp(b.startTime) ?? 0) - (timestamp(a.startTime) ?? 0));
  catalog.currentSeasonId = text(seasons[0]?.uuid) || undefined;
  return catalog;
}
export function catalogItem(
  catalog: Catalog,
  id: string,
  fallbackKind: ItemKind = 'unknown',
): CatalogItem {
  return (
    (Object.hasOwn(catalog.items, id.toLowerCase())
      ? catalog.items[id.toLowerCase()]
      : undefined) ?? {
      id,
      canonicalId: id,
      kind: fallbackKind,
      name: `Unresolved item · ${id.slice(0, 8) || 'unknown'}`,
    }
  );
}
export class CatalogClient {
  private cache = new SingleFlightCache();
  constructor(private http: HttpClient) {}
  clear(): void {
    this.cache.clear();
  }
  async version(): Promise<string> {
    return this.cache.get('version', 5 * 60 * 1000, async () => {
      const response = await this.http.json(`${PUBLIC_ORIGIN}/v1/version`);
      const version = text(object(object(response.data).data).riotClientVersion);
      if (!version || !/^[a-zA-Z0-9.+_-]{4,160}$/.test(version))
        throw new Error('Version unavailable');
      return version;
    });
  }
  async load(): Promise<Catalog> {
    return this.cache.get('catalog', 24 * 60 * 60 * 1000, async () => {
      const entries = await Promise.all(
        CATALOG_PATHS.map(async (path) => {
          try {
            return [
              path,
              (await this.http.json(`${PUBLIC_ORIGIN}/v1/${path}?language=en-US`)).data,
            ] as const;
          } catch {
            return [path, undefined] as const;
          }
        }),
      );
      return buildCatalog(Object.fromEntries(entries));
    });
  }
}
