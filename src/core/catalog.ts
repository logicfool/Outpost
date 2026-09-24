import { cardFallbackArt } from './playerCardArt';
import { drainCooperatively } from './cooperative';
import { missionDefinitions, objectiveDirectives } from './missions';
import type { Catalog, CatalogItem, ItemKind, JsonObject } from './types';
import { EMPTY_CATALOG } from './types';
import {
  array,
  number,
  nullableNumber,
  object,
  safeImage,
  safeMedia,
  text,
  timestamp,
} from './validation';
import { HttpClient, SingleFlightCache } from './http';
export const PUBLIC_ORIGIN = 'https://valorant-api.com';

export const CATALOG_SCHEMA_VERSION = 12;
export const CATALOG_VERSION_CHECK_MS = 15 * 60000;
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
  'currencies',
  'themes',
  'missions',
  'objectives',
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
  const steps = catalogSteps(responses, now);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}
export function buildCatalogAsync(
  responses: Partial<Record<CatalogPath, unknown>>,
  now = Date.now(),
): Promise<Catalog> {
  return drainCooperatively(catalogSteps(responses, now));
}
function* catalogSteps(
  responses: Partial<Record<CatalogPath, unknown>>,
  now: number,
): Generator<void, Catalog> {
  const catalog: Catalog = {
    ...EMPTY_CATALOG,
    items: Object.create(null),
    bundles: Object.create(null),
    maps: Object.create(null),
    tiers: Object.create(null),
    contracts: Object.create(null),
    seasons: Object.create(null),
    weapons: Object.create(null),
    missions: Object.create(null),
    objectives: Object.create(null),
    schemaVersion: CATALOG_SCHEMA_VERSION,
    fetchedAt: now,
  };
  const themeNames = new Map(
    dataList(responses.themes).map((v) => {
      const t = object(v);
      return [text(t.uuid), text(t.displayName)] as const;
    }),
  );
  const add = (id: string, item: CatalogItem) => {
    if (id && id !== '__proto__')
      catalog.items[id.toLowerCase()] = {
        ...item,
        id: id.toLowerCase(),
        canonicalId: item.canonicalId.toLowerCase(),
      };
  };
  for (const rawWeapon of dataList(responses.weapons)) {
    const weapon = object(rawWeapon),
      weaponId = text(weapon.uuid).toLowerCase();
    if (/^[a-f0-9-]{36}$/.test(weaponId))
      catalog.weapons![weaponId] = {
        id: weaponId,
        name: text(weapon.displayName),
        image: safeImage(weapon.displayIcon),
        killIcon: safeImage(weapon.killStreamIcon),
        category: text(weapon.category).split('::').pop(),
        defaultSkinId: text(weapon.defaultSkinUuid) || undefined,
      };
    for (const rawSkin of array(weapon.skins)) {
      yield;
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
        isDefault:
          !!text(weapon.defaultSkinUuid) &&
          text(weapon.defaultSkinUuid).toLowerCase() === text(skin.uuid).toLowerCase(),
        weapon: text(weapon.displayName),
        weaponId: text(weapon.uuid),
        collectionKey: text(skin.assetPath).split('/').at(-2)?.toLowerCase(),
        collectionName: themeNames.get(text(skin.themeUuid)),
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
    ['currencies', 'currency'],
  ];
  for (const [path, kind] of categories)
    for (const raw of dataList(responses[path])) {
      yield;
      const entry = object(raw);
      if (path === 'agents' && entry.isPlayableCharacter === false) continue;
      const item: CatalogItem = {
        id: text(entry.uuid),
        canonicalId: text(entry.uuid),
        name:
          kind === 'title'
            ? text(entry.titleText, text(entry.displayName))
            : text(entry.displayName),
        kind,
        smallArt: kind === 'card' ? safeImage(entry.smallArt) : undefined,
        image:
          safeImage(entry.displayIcon) ??
          safeImage(entry.smallArt) ??
          safeImage(entry.fullTransparentIcon) ??
          safeImage(entry.fullIcon),
        imageFallbacks: [
          safeImage(entry.fullTransparentIcon),
          safeImage(entry.fullIcon),
          safeImage(entry.smallArt),
          safeImage(entry.largeIcon),
        ].filter((u): u is string => !!u),
        wallpaper: safeImage(entry.largeArt) ?? safeImage(entry.fullPortrait),
        wideArt: safeImage(entry.wideArt),
      };
      if (kind === 'buddy')
        item.levels = array(entry.levels)
          .map(object)
          .map((level, index) => ({
            id: text(level.uuid).toLowerCase(),
            name: text(level.displayName, `Level ${index + 1}`),
            image: safeImage(level.displayIcon) ?? item.image,
          }));
      add(item.id, item);
      for (const level of array(entry.levels).map(object))
        add(text(level.uuid), {
          ...item,
          image: item.image ?? safeImage(level.displayIcon),
          imageFallbacks: [safeImage(level.displayIcon), ...(item.imageFallbacks ?? [])].filter(
            (u): u is string => !!u,
          ),
        });
    }

  const keys = new Map<string, Set<string>>(),
    names = new Map<string, Set<string>>();
  for (const item of Object.values(catalog.items)) {
    if (item.kind !== 'skin') continue;
    for (const [map, key] of [
      [keys, item.collectionKey],
      [names, item.collectionName?.trim()],
    ] as const) {
      if (key) {
        const set = map.get(key) ?? new Set<string>();
        set.add(item.canonicalId);
        map.set(key, set);
      }
    }
  }
  const bundleRows = dataList(responses.bundles),
    counts = new Map<string, number>();
  for (const raw of bundleRows) {
    const name = text(object(raw).displayName).trim();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  for (const raw of bundleRows) {
    yield;
    const e = object(raw),
      asset = text(e.assetPath).split('/').at(-1) ?? '';
    const collectionKey = /^StorefrontItem_(.+?)(?:_?ThemeBundle|_?Bundle)_DataAsset$/i
      .exec(asset)?.[1]
      ?.replace(/_$/, '')
      .toLowerCase();
    let itemIds = collectionKey ? [...(keys.get(collectionKey) ?? [])] : [];
    const display = text(e.displayName).trim();
    if (!itemIds.length && counts.get(display) === 1) itemIds = [...(names.get(display) ?? [])];
    catalog.bundles[text(e.uuid).toLowerCase()] = {
      name: text(e.displayName),
      image: safeImage(e.displayIcon) ?? safeImage(e.displayIcon2) ?? safeImage(e.displayIcon3),
      imageFallbacks: [safeImage(e.displayIcon2), safeImage(e.displayIcon3)].filter(
        (v): v is string => !!v,
      ),
      collectionKey,
      itemIds,
      ...(itemIds.length ? { membershipSource: 'catalog-theme' } : {}),
    };
  }
  for (const raw of dataList(responses.maps)) {
    const e = object(raw),
      item = {
        name: text(e.displayName),
        image: safeImage(e.splash),
        listImage: safeImage(e.listViewIcon),
        minimap: safeImage(e.displayIcon),
        xMultiplier: nullableNumber(e.xMultiplier) ?? undefined,
        yMultiplier: nullableNumber(e.yMultiplier) ?? undefined,
        xScalarToAdd: nullableNumber(e.xScalarToAdd) ?? undefined,
        yScalarToAdd: nullableNumber(e.yScalarToAdd) ?? undefined,
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
      endsAt: timestamp(season.endTime),
    };
  }
  for (const raw of dataList(responses.contracts)) {
    yield;
    const e = object(raw),
      content = object(e.content);
    const levels: { xp: number; rewardId?: string; rewardAmount?: number; rewardType?: string }[] =
      [];
    for (const chapter of array(content.chapters).map(object))
      for (const level of array(chapter.levels).map(object))
        levels.push({
          xp: number(level.xp),
          rewardId: text(object(level.reward).uuid) || undefined,
          rewardAmount:
            typeof object(level.reward).amount === 'number'
              ? number(object(level.reward).amount)
              : undefined,
          rewardType: text(object(level.reward).type) || undefined,
        });
    catalog.contracts[text(e.uuid)] = {
      id: text(e.uuid),
      name: text(e.displayName),
      relationId: text(content.relationUuid) || undefined,
      relationType: text(content.relationType) || undefined,
      levels,
    };
  }
  yield;
  catalog.missions = missionDefinitions(responses.missions);
  catalog.objectives = objectiveDirectives(responses.objectives);
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
  const key = id.toLowerCase(),
    currency = (
      {
        'e59aa87c-4cbf-517a-5983-6e81511be9b7': 'Radianite Points',
        '85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741': 'VALORANT Points',
        '85ca954a-41f2-ce94-9b45-8ca3dd39a00d': 'Kingdom Credits',
      } as Record<string, string>
    )[key];
  if (currency && !catalog.items[key])
    return {
      id: key,
      canonicalId: key,
      name: currency,
      kind: 'currency',
      image: `https://media.valorant-api.com/currencies/${key}/displayicon.png`,
    };
  return (
    (Object.hasOwn(catalog.items, id.toLowerCase())
      ? catalog.items[id.toLowerCase()]
      : undefined) ?? {
      id,
      canonicalId: id,
      kind: fallbackKind,
      ...(fallbackKind === 'card' ? cardFallbackArt(key) : {}),
      name: `Unresolved item · ${id.slice(0, 8) || 'unknown'}`,
    }
  );
}
export function hydrateItem(catalog: Catalog, item: CatalogItem): CatalogItem {
  const fresh = catalogItem(catalog, item.id, item.kind);
  if (fresh.name.startsWith('Unresolved') && item.kind === 'card') {
    const art = cardFallbackArt(item.canonicalId || item.id);
    return {
      ...item,
      image: item.image ?? art.image,
      smallArt: item.smallArt ?? art.smallArt,
      wideArt: item.wideArt ?? art.wideArt,
      wallpaper: item.wallpaper ?? art.wallpaper,
    };
  }
  if (fresh.name.startsWith('Unresolved')) return item;
  return {
    ...item,
    ...fresh,
    image: fresh.image ?? item.image,
    smallArt: fresh.smallArt ?? item.smallArt,
    imageFallbacks: [...new Set([...(fresh.imageFallbacks ?? []), ...(item.imageFallbacks ?? [])])],
    wideArt: fresh.wideArt ?? item.wideArt,
    wallpaper: fresh.wallpaper ?? item.wallpaper,
  };
}
export function mergeCatalog(previous: Catalog | undefined, fresh: Catalog): Catalog {
  if (!previous) return fresh;
  return {
    ...fresh,
    sourceVersion: fresh.sourceVersion ?? previous.sourceVersion,
    metadataUpdatedAt: fresh.metadataUpdatedAt ?? previous.metadataUpdatedAt,
    availableVersion: fresh.availableVersion ?? previous.availableVersion,
    versionCheckedAt: fresh.versionCheckedAt ?? previous.versionCheckedAt,
    refreshAfter: fresh.refreshAfter ?? previous.refreshAfter,
    repairAfter: Math.max(previous.repairAfter ?? 0, fresh.repairAfter ?? 0) || undefined,
    weapons: { ...previous.weapons, ...fresh.weapons },
    items: Object.fromEntries(
      Object.entries({ ...previous.items, ...fresh.items }).map(([id, item]) => [
        id,
        previous.items[id]
          ? {
              ...item,
              collectionName:
                item.collectionName ??
                (item.collectionKey === previous.items[id]!.collectionKey
                  ? previous.items[id]!.collectionName
                  : undefined),
              image: item.image ?? previous.items[id]!.image,
              smallArt: item.smallArt ?? previous.items[id]!.smallArt,
              wideArt: item.wideArt ?? previous.items[id]!.wideArt,
              wallpaper: item.wallpaper ?? previous.items[id]!.wallpaper,
            }
          : item,
      ]),
    ),
    maps: { ...previous.maps, ...fresh.maps },
    bundles: Object.fromEntries(
      Object.entries({ ...previous.bundles, ...fresh.bundles }).map(([id, bundle]) => {
        const old = previous.bundles[id];
        // An empty inferred list means unavailable context, not a published empty bundle.
        const retainMembership =
          old?.membershipSource === 'store' ||
          (old?.membershipSource === 'catalog-theme' &&
            !bundle.itemIds?.length &&
            bundle.collectionKey === old.collectionKey);
        return [
          id,
          {
            ...bundle,
            image: bundle.image ?? old?.image,
            imageFallbacks: bundle.imageFallbacks?.length
              ? bundle.imageFallbacks
              : old?.imageFallbacks,
            ...(old && retainMembership
              ? {
                  itemIds: old.itemIds,
                  itemKinds: old.itemKinds,
                  membershipSource: old.membershipSource,
                }
              : {}),
          },
        ];
      }),
    ),
    tiers: { ...previous.tiers, ...fresh.tiers },
    contracts: { ...previous.contracts, ...fresh.contracts },
    missions: { ...previous.missions, ...fresh.missions },
    objectives: { ...previous.objectives, ...fresh.objectives },
    seasons: { ...previous.seasons, ...fresh.seasons },
    currentSeasonId: fresh.currentSeasonId ?? previous.currentSeasonId,
  };
}
export class CatalogClient {
  private cache = new SingleFlightCache();
  private generation = 0;
  constructor(private http: HttpClient) {}
  clear(): void {
    this.generation++;
    this.cache.clear();
  }
  async version(fresh = false): Promise<string> {
    if (fresh) this.cache.invalidate('version');
    return this.cache.get('version', CATALOG_VERSION_CHECK_MS, async () => {
      const response = await this.http.json(`${PUBLIC_ORIGIN}/v1/version`);
      const version = text(object(object(response.data).data).riotClientVersion);
      if (!version || !/^[a-zA-Z0-9.+_-]{4,160}$/.test(version))
        throw new Error('Version unavailable');
      return version;
    });
  }
  async repair(previous: Catalog, paths: CatalogPath[]): Promise<Catalog> {
    const generation = this.generation;
    const requested = [...new Set(paths)]
      .filter((path) => CATALOG_PATHS.includes(path))
      .slice(0, 7);
    const failed: string[] = [];
    const entries = await Promise.all(
      requested.map(async (path) => {
        try {
          const result = await this.cache.get(`repair:${path}`, 10 * 60000, async () => {
            const data = (
              await this.http.json(`${PUBLIC_ORIGIN}/v1/${path}?language=en-US`, {
                cache: 'no-store',
              })
            ).data;
            if (!Array.isArray(object(data).data)) throw new Error('Invalid catalogue category');
            if (generation === this.generation)
              this.cache.prime(`category:${path}`, 24 * 60 * 60 * 1000, data);
            return data;
          });
          return [path, result] as const;
        } catch {
          failed.push(path);
          return [path, undefined] as const;
        }
      }),
    );
    // Rebuild normal loads from repaired categories, not an older aggregate.
    if (generation === this.generation && entries.some(([, data]) => data !== undefined))
      this.cache.invalidate('catalog');
    const fresh = await buildCatalogAsync(Object.fromEntries(entries));
    fresh.failedPaths = [
      ...new Set([
        ...(previous.failedPaths ?? []).filter((p) => !requested.includes(p as CatalogPath)),
        ...failed,
      ]),
    ];
    return {
      ...mergeCatalog(previous, fresh),
      schemaVersion: previous.schemaVersion,
      metadataUpdatedAt: entries.some(([, data]) => data !== undefined)
        ? Date.now()
        : previous.metadataUpdatedAt,
      fetchedAt: previous.fetchedAt,
    };
  }
  async weaponSkins(): Promise<unknown> {
    return this.cache.get(
      'video-refresh-weapons',
      60000,
      async () => (await this.http.json(`${PUBLIC_ORIGIN}/v1/weapons?language=en-US`)).data,
    );
  }
  async load(previous?: Catalog, sourceVersion?: string, revalidate = false): Promise<Catalog> {
    if (revalidate) {
      this.cache.invalidate('catalog');
      for (const path of CATALOG_PATHS) {
        this.cache.invalidate(`category:${path}`);
        this.cache.invalidate(`repair:${path}`);
      }
    }
    return this.cache.get('catalog', 30000, async () => {
      const failed: string[] = [];
      const entries = await Promise.all(
        CATALOG_PATHS.map(async (path) => {
          try {
            const data = await this.cache.get(`category:${path}`, 24 * 60 * 60 * 1000, async () => {
              const result = (await this.http.json(`${PUBLIC_ORIGIN}/v1/${path}?language=en-US`))
                .data;
              if (!Array.isArray(object(result).data)) throw new Error('Invalid catalog category');
              return result;
            });
            return [path, data] as const;
          } catch {
            failed.push(path);
            return [path, undefined] as const;
          }
        }),
      );
      const fresh = await buildCatalogAsync(Object.fromEntries(entries));
      fresh.failedPaths = failed;
      fresh.metadataUpdatedAt =
        failed.length < CATALOG_PATHS.length ? Date.now() : previous?.metadataUpdatedAt;
      fresh.sourceVersion = failed.length ? previous?.sourceVersion : sourceVersion;
      fresh.availableVersion = sourceVersion ?? previous?.availableVersion;
      if (failed.length === CATALOG_PATHS.length && previous) fresh.fetchedAt = previous.fetchedAt;
      return mergeCatalog(previous, fresh);
    });
  }
}
