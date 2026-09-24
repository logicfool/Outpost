import type { Catalog, MatchDetail, MatchSummary } from './types';
import type { MapMetadata } from './matchTypes';
// Riot's 13.06 patch notes show the four arenas together. This is overview art, not a minimap.
export const GAUNTLET_OVERVIEW =
  'https://cmsassets.rgpub.io/sanity/images/dsfx7636/news_live/bffcf59a84dcbcea5d881d2b71e09c4c4cc1cf38-1672x941.png';
const GAUNTLET: MapMetadata = {
  name: 'Gauntlet: Glitched',
  image: GAUNTLET_OVERVIEW,
  listImage: GAUNTLET_OVERVIEW,
};
// Verified in /v1/maps for release-13.06. Match/queue aliases differ from the public mapUrl.
export const GAUNTLET_MAP_ID = 'dd3a1cd9-41b1-50ea-3bd6-a7bb3c5978bd';
const GAUNTLET_MAP_PATH = '/game/maps/abilitydraft/abilitydraft';
const GAUNTLET_ALIASES = new Set([
  GAUNTLET_MAP_ID,
  GAUNTLET_MAP_PATH,
  '/game/maps/abilitydraft/abilitydraftarena',
  'abilitydraft',
  'abilitydraftarena',
  'gauntlet',
  'gauntlet: glitched',
]);
const EMPTY_MAPS: Catalog['maps'] = {};
const indices = new WeakMap<Catalog['maps'], Map<string, MapMetadata>>();
export function mapKey(raw: string): string {
  return raw.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
export function isGauntletMap(raw: string): boolean {
  const value = mapKey(raw),
    leaf = value.split('/').pop()?.split('.')[0];
  return (
    GAUNTLET_ALIASES.has(value) ||
    (leaf === 'abilitydraftarena' && value.startsWith('/game/maps/abilitydraft/'))
  );
}
export function mapMetadata(catalog: Catalog, raw: string): MapMetadata | undefined {
  const key = mapKey(raw);
  if (!key) return;
  const maps = catalog.maps ?? EMPTY_MAPS;
  let index = indices.get(maps);
  if (!index) {
    index = new Map();
    for (const [id, value] of Object.entries(maps)) {
      index.set(mapKey(id), value);
    }
    for (const value of Object.values(maps))
      if (!index.has(mapKey(value.name))) index.set(mapKey(value.name), value);
    indices.set(maps, index);
  }
  if (isGauntletMap(raw))
    return index.get(GAUNTLET_MAP_ID) ?? index.get(GAUNTLET_MAP_PATH) ?? index.get(key) ?? GAUNTLET;
  return index.get(key);
}
export function mapForSaved(
  catalog: Catalog,
  value: { map: string; mapId?: string; queue?: string },
): MapMetadata | undefined {
  if (value.mapId) return mapMetadata(catalog, value.mapId);
  const found = mapMetadata(catalog, value.map);
  if (found) return found;
  // Older saved reports discarded their raw map ID. Only an explicit new-mode queue can repair those.
  if (
    ['unknown map', 'open match details', ''].includes(value.map.toLowerCase()) &&
    ['abilitydraft', 'abilitydraftarena'].includes(value.queue?.toLowerCase() ?? '')
  )
    return mapMetadata(catalog, GAUNTLET_MAP_ID);
}
export function hydrateMatchSummary(catalog: Catalog, row: MatchSummary): MatchSummary {
  const map = mapForSaved(catalog, row);
  const previewMap = row.preview
    ? (mapForSaved(catalog, { ...row, ...row.preview }) ?? map)
    : undefined;
  if (!map && !previewMap) return row;
  return {
    ...row,
    ...(map ? { map: map.name, mapImage: map.image ?? row.mapImage } : {}),
    ...(row.preview && previewMap
      ? {
          preview: {
            ...row.preview,
            map: previewMap.name,
            mapImage: previewMap.image ?? row.preview.mapImage,
          },
        }
      : {}),
  };
}
export function hydrateMatchDetail(catalog: Catalog, detail: MatchDetail): MatchDetail {
  const map = mapForSaved(catalog, detail);
  if (!map) return detail;
  return {
    ...detail,
    map: map.name,
    mapImage: map.image ?? detail.mapImage,
    ...(detail.analysis
      ? {
          analysis: {
            ...detail.analysis,
            minimap: map.minimap
              ? map
              : isGauntletMap(detail.mapId ?? detail.map) ||
                  map === mapMetadata(catalog, GAUNTLET_MAP_ID)
                ? undefined
                : detail.analysis.minimap,
          },
        }
      : {}),
  };
}
