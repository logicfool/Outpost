import type {
  Account,
  Catalog,
  CatalogItem,
  MatchDetail,
  Section,
  Snapshot,
  StoreOffer,
} from './types';
import { CURRENCIES } from './normalize';
export const DEMO_ID = '00000000-0000-4000-8000-000000000001';
export const DEMO_ACCOUNT: Account = {
  puuid: DEMO_ID,
  gameName: 'Nightshift',
  tagLine: 'DEMO',
  region: 'ap',
  shard: 'ap',
  addedAt: 0,
  expiresAt: 0,
  demo: true,
};

const NAMES = [
  'Reaver Vandal',
  'Oni Phantom',
  'Ion Sheriff',
  'Prime Classic',
  'RGX 11z Pro Blade',
  'Sovereign Ghost',
  'Reaver Operator',
  'Spectrum Phantom',
];
export function demoCatalog(): Catalog {
  const items: Record<string, CatalogItem> = {};
  NAMES.forEach((name, index) => {
    const id = `00000000-0000-4000-8001-${String(index + 1).padStart(12, '0')}`;
    items[id] = {
      id,
      canonicalId: id,
      name,
      kind: 'skin',
      rarity: index === 4 ? 'Exclusive' : 'Premium',
      weapon: name.split(' ').at(-1),
    };
  });
  for (const [index, name] of ['Pocket Sage', 'Good Luck'].entries()) {
    const id = `00000000-0000-4000-8002-${String(index + 1).padStart(12, '0')}`;
    items[id] = { id, canonicalId: id, name, kind: 'buddy' };
  }
  return { items, bundles: {}, maps: {}, tiers: {}, contracts: {}, fetchedAt: 0 };
}
export function makeDemo(now = Date.now()): {
  account: Account;
  snapshot: Snapshot;
  catalog: Catalog;
} {
  const catalog = demoCatalog(),
    skins = Object.values(catalog.items).filter((i) => i.kind === 'skin');
  const ready = <T>(data: T): Section<T> => ({ status: 'ready', data, fetchedAt: now });
  const prices = [1775, 1775, 1775, 1775, 4350, 1775, 1775, 2675];
  const offers: StoreOffer[] = skins.map((item, index) => ({
    id: item.id,
    item,
    prices: [{ currencyId: CURRENCIES.VP, symbol: 'VP', amount: prices[index] ?? 1775 }],
  }));
  const matches = ['Ascent', 'Lotus', 'Haven', 'Bind', 'Split'].map((map, index) => ({
    id: `00000000-0000-4000-8003-${String(index + 1).padStart(12, '0')}`,
    startedAt: now - (index + 1) * 3600000,
    queue: 'competitive',
    map,
    rrChange: [22, -16, 18, 25, -13][index],
  }));
  const snapshot: Snapshot = {
    accountId: DEMO_ID,
    demo: true,
    fetchedAt: now,
    store: ready({
      daily: offers.slice(0, 4),
      dailyExpiresAt: now + 7 * 3600000 + 42 * 60000,
      clockOffsetMs: 0,
      fetchedAt: now,
      endpoint: 'demo',
      bundles: [
        {
          id: 'demo-bundle',
          name: 'After-hours collection',
          prices: [{ currencyId: CURRENCIES.VP, symbol: 'VP', amount: 7100 }],
          expiresAt: now + 5 * 86400000,
          offers: offers.slice(4),
        },
      ],
      accessories: [
        {
          id: 'demo-accessory',
          item: Object.values(catalog.items)[8]!,
          prices: [{ currencyId: CURRENCIES.KC, symbol: 'KC', amount: 4500 }],
        },
      ],
      accessoriesExpireAt: now + 2 * 86400000,
      nightMarket: {
        expiresAt: now + 8 * 86400000,
        offers: offers.slice(2, 8).map((o, index) => ({
          ...o,
          originalPrices: o.prices,
          prices: o.prices.map((p) => ({
            ...p,
            amount: Math.floor(p.amount * (1 - (25 + index * 3) / 100)),
          })),
          discountPercent: 25 + index * 3,
          seen: true,
        })),
      },
    }),
    wallet: ready([
      { currencyId: CURRENCIES.VP, symbol: 'VP', amount: 3420 },
      { currencyId: CURRENCIES.RP, symbol: 'RP', amount: 85 },
      { currencyId: CURRENCIES.KC, symbol: 'KC', amount: 6800 },
    ]),
    rank: ready({ name: 'DIAMOND 2', tier: 22, rr: 67, wins: 28, games: 46, currentSeason: true }),
    xp: ready({ level: 143, xp: 3250 }),
    progression: ready({
      contracts: [
        {
          id: 'demo-pass',
          name: 'After-hours battle pass',
          level: 32,
          xp: 18600,
          nextLevelXp: 28000,
          nextReward: skins[5],
          currentBattlepass: true,
        },
      ],
      missions: [
        { id: 'demo-mission-1', complete: false, expiresAt: now + 3 * 86400000, objectives: [12] },
        { id: 'demo-mission-2', complete: true, expiresAt: now + 3 * 86400000, objectives: [10] },
      ],
      weeklyRefillAt: now + 3 * 86400000,
    }),
    collection: ready([
      ...skins.slice(4),
      ...Object.values(catalog.items).filter((i) => i.kind === 'buddy'),
    ]),
    loadout: ready({
      guns: [
        { weapon: 'Phantom', skin: skins[7]! },
        { weapon: 'Ghost', skin: skins[5]! },
        { weapon: 'Melee', skin: skins[4]! },
      ],
    }),
    liveGame: ready({ state: 'in_game', matchId: 'demo-live', map: 'Abyss' }),
    matches: ready(matches),
  };
  return { account: DEMO_ACCOUNT, snapshot, catalog };
}
export function demoMatch(id: string): MatchDetail {
  const match = makeDemo().snapshot.matches;
  const entry = match.status === 'ready' ? match.data.find((m) => m.id === id) : undefined;
  return {
    id,
    map: entry?.map ?? 'Ascent',
    queue: 'competitive',
    startedAt: entry?.startedAt ?? Date.now() - 3600000,
    agent: 'Jett',
    kills: 24,
    deaths: 15,
    assists: 6,
    acs: 278,
    headshotPct: 29.4,
    result: (entry?.rrChange ?? 1) >= 0 ? 'WIN' : 'LOSS',
    score: (entry?.rrChange ?? 1) >= 0 ? '13 - 8' : '9 - 13',
  };
}
