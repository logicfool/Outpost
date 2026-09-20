import { DEMO_ART } from './demoAssets';
import { DEMO_MATCH_ASSETS } from './demoMatchAssets';
import { demoAnalysis, demoDuelStats } from './demoAnalysis';
import { DEMO_ACCESSORIES } from './demoAccessories';
import type {
  Account,
  Catalog,
  CatalogItem,
  MatchDetail,
  MatchPlayer,
  RoundOutcome,
  Section,
  Snapshot,
  StoreOffer,
} from './types';
import { CURRENCIES, ITEM_TYPES } from './normalize';
export const DEMO_BUNDLE_ID = '00000000-0000-4000-8006-000000000001';
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
  'Prime Vandal',
];
const RARITIES = [
  'Premium',
  'Deluxe',
  'Premium',
  'Select',
  'Exclusive',
  'Ultra',
  'Premium',
  'Exclusive',
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
      rarity: RARITIES[index],
      weapon: name.split(' ').at(-1),
      ...DEMO_ART.skins[name],
    };
  });
  AGENTS.forEach((name, index) => {
    const id = `00000000-0000-4000-8007-${String(index + 1).padStart(12, '0')}`;
    items[id] = { id, canonicalId: id, name, kind: 'agent', image: DEMO_ART.agents[name] };
  });
  for (const item of DEMO_ACCESSORIES) items[item.id] = item;
  for (const item of [...DEMO_ART.cards, ...DEMO_ART.titles]) items[item.id] = item;
  for (const skin of Object.values(items).filter((i) => i.kind === 'skin'))
    for (const chroma of skin.chromas ?? [])
      items[chroma.id] = { ...skin, ...chroma, canonicalId: skin.id, kind: 'chroma' };
  return {
    items,
    bundles: {
      ...DEMO_ART.bundles,
      'demo-featured': {
        name: 'After-hours collection',
        itemIds: Object.values(items)
          .filter((i) => i.kind === 'skin')
          .slice(0, 4)
          .map((i) => i.canonicalId),
        membershipSource: 'store',
      },
    },
    weapons: DEMO_MATCH_ASSETS.weapons,
    maps: { ...DEMO_ART.maps, ...DEMO_MATCH_ASSETS.maps },
    tiers: DEMO_ART.tiers,
    contracts: {
      'demo-pass': {
        id: 'demo-pass',
        name: 'After-hours battle pass',
        levels: Array.from({ length: 55 }, (_, i) => ({
          xp: i ? 28000 : 0,
          rewardId: i % 3 === 2 ? CURRENCIES.RP : DEMO_ACCESSORIES[i % DEMO_ACCESSORIES.length]!.id,
          rewardType: i % 3 === 2 ? 'Currency' : 'Item',
          rewardAmount: 1,
        })),
      },
    },
    seasons: {},
    fetchedAt: 0,
  };
}
const QUEUES = ['competitive', 'competitive', 'unrated', 'swiftplay', 'competitive'];
export function makeDemo(now = Date.now()): {
  account: Account;
  snapshot: Snapshot;
  catalog: Catalog;
} {
  const catalog = demoCatalog(),
    skins = Object.values(catalog.items).filter((i) => i.kind === 'skin');
  const ready = <T>(data: T): Section<T> => ({ status: 'ready', data, fetchedAt: now });
  const prices = [1775, 1275, 1775, 875, 4350, 2475, 1775, 2675];
  const offers: StoreOffer[] = skins.map((item, index) => ({
    id: item.id,
    item,
    prices: [{ currencyId: CURRENCIES.VP, symbol: 'VP', amount: prices[index] ?? 1775 }],
  }));
  const bundleOffers = offers.slice(0, 4).map((o, index) => ({
    ...o,
    prices: [{ currencyId: CURRENCIES.VP, symbol: 'VP', amount: [875, 700, 700, 525][index]! }],
  }));
  const bundleLines = bundleOffers.map((o) => ({
    offerId: o.id,
    itemId: o.item.id,
    canonicalItemId: o.item.canonicalId,
    name: o.item.name,
    itemTypeId: ITEM_TYPES.skin,
    quantity: 1,
    price: o.prices[0]!.amount,
  }));
  const matches = ['Ascent', 'Lotus', 'Haven', 'Bind', 'Split'].map((map, index) => ({
    id: `00000000-0000-4000-8003-${String(index + 1).padStart(12, '0')}`,
    startedAt: now - (index + 1) * 3600000,
    queue: QUEUES[index]!,
    map,
    mapImage: DEMO_ART.maps[map]?.image,
    rrChange: QUEUES[index] === 'competitive' ? [22, -16, 18, 25, -13][index] : undefined,
  }));
  const act = (
    seasonId: string,
    name: string,
    tier: number,
    tierName: string,
    rr: number,
    wins: number,
    games: number,
    current = false,
  ) => ({
    seasonId,
    name,
    tier,
    tierName,
    image: DEMO_ART.tiers[String(tier)]?.image,
    rr,
    wins,
    games,
    current,
  });
  const competitive = [
    act('demo-v26-a5', 'V26 // ACT V', 19, 'DIAMOND 2', 67, 28, 46, true),
    act('demo-v26-a4', 'V26 // ACT IV', 20, 'DIAMOND 3', 12, 31, 58),
    act('demo-v25-a3', 'V25 // ACT III', 16, 'PLATINUM 2', 40, 22, 40),
  ];
  const unrated = [
    act('demo-v26-a5', 'V26 // ACT V', 0, 'Unrated', 0, 14, 25, true),
    act('demo-v26-a4', 'V26 // ACT IV', 0, 'Unrated', 0, 9, 19),
  ];
  const sum = (acts: typeof competitive, key: 'wins' | 'games') =>
    acts.reduce((total, a) => total + a[key], 0);
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
          id: DEMO_BUNDLE_ID,
          catalogId: 'demo-featured',
          name: 'After-hours collection',
          prices: [{ currencyId: CURRENCIES.VP, symbol: 'VP', amount: 2800 }],
          expiresAt: now + 5 * 86400000,
          offers: bundleOffers,
          checkout: { lines: bundleLines, total: 2800, wholesaleOnly: true },
        },
      ],
      accessories: DEMO_ACCESSORIES.map((item) => ({
        id: item.id,
        item,
        prices: [
          { currencyId: CURRENCIES.KC, symbol: 'KC', amount: item.kind === 'buddy' ? 7500 : 4000 },
        ],
      })),
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
    rank: ready({
      name: 'DIAMOND 2',
      tier: 19,
      image: DEMO_ART.tiers['19']?.image,
      rr: 67,
      wins: 28,
      games: 46,
      currentSeason: true,
      seasonId: 'demo-v26-a5',
      seasonName: 'V26 // ACT V',
      peak: {
        tier: 20,
        image: DEMO_ART.tiers['20']?.image,
        name: 'DIAMOND 3',
        seasonName: 'V26 // ACT IV',
      },
      career: [
        {
          queue: 'competitive',
          acts: competitive,
          wins: sum(competitive, 'wins'),
          games: sum(competitive, 'games'),
        },
        {
          queue: 'unrated',
          acts: unrated,
          wins: sum(unrated, 'wins'),
          games: sum(unrated, 'games'),
        },
      ],
    }),
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
      ...Object.values(catalog.items).filter((i) => ['buddy', 'card', 'title'].includes(i.kind)),
    ]),
    loadout: ready({
      version: 1,
      card: DEMO_ART.cards[0],
      title: DEMO_ART.titles[0],
      guns: [
        { weapon: 'Phantom', skin: skins[7]! },
        { weapon: 'Ghost', skin: skins[5]! },
        { weapon: 'Melee', skin: skins[4]! },
      ],
    }),
    liveGame: ready({
      state: 'in_game',
      matchId: '00000000-0000-4000-8005-000000000001',
      map: 'Abyss',
      mapId: 'Abyss',
      progress: { source: 'match', observedAt: now, allyScore: 7, enemyScore: 5, roundNumber: 13 },
      mapImage: DEMO_ART.maps.Abyss?.image,
      observedAt: now,
      queue: 'competitive',
      players: AGENTS.map((agent, i) => ({
        subject: i === 0 ? DEMO_ID : `00000000-0000-4000-8004-${String(i).padStart(12, '0')}`,
        self: i === 0,
        name: PLAYERS[i]!,
        tag: 'DEMO',
        teamId: i % 2 ? 'Red' : 'Blue',
        agent,
        agentImage: DEMO_ART.agents[agent],
        level: 50 + i * 3,
        card: DEMO_ART.cards[0],
        title: DEMO_ART.titles[0],
      })),
    }),
    matches: ready(matches),
  };
  return { account: DEMO_ACCOUNT, snapshot, catalog };
}
const AGENTS = [
  'Jett',
  'Omen',
  'Sova',
  'Killjoy',
  'Breach',
  'Reyna',
  'Viper',
  'Cypher',
  'Skye',
  'Raze',
];
const PLAYERS = [
  'Nightshift',
  'Lumen',
  'Kestrel',
  'Brix',
  'Solace',
  'Vanta',
  'Orbit',
  'Mako',
  'Quill',
  'Ferro',
];
const OUTCOMES: RoundOutcome[] = ['elimination', 'detonate', 'elimination', 'defuse', 'time'];
export function demoMatch(id: string, subject = DEMO_ID): MatchDetail {
  const match = makeDemo().snapshot.matches;
  const entry = match.status === 'ready' ? match.data.find((m) => m.id === id) : undefined;
  const index =
      match.status === 'ready'
        ? Math.max(
            0,
            match.data.findIndex((m) => m.id === id),
          )
        : 0,
    win = entry?.rrChange !== undefined ? entry.rrChange >= 0 : index % 2 === 0;
  const players: MatchPlayer[] = AGENTS.map((agent, i) => {
    const kills = 26 - i * 2 + ((i + index) % 3),
      deaths = 11 + ((i + index) % 4) * 3,
      assists = 3 + ((i + index) % 5),
      acs = 300 - i * 16;
    return {
      subject: i === 0 ? DEMO_ID : `00000000-0000-4000-8004-${String(i).padStart(12, '0')}`,
      name: PLAYERS[i]!,
      tag: i === 0 ? 'DEMO' : String(1000 + i * 137),
      teamId: i % 2 === 0 ? 'Blue' : 'Red',
      self:
        subject === (i === 0 ? DEMO_ID : `00000000-0000-4000-8004-${String(i).padStart(12, '0')}`),
      agent,
      agentImage: DEMO_ART.agents[agent],
      card: DEMO_ART.cards[0],
      title: DEMO_ART.titles[0],
      tierName: DEMO_ART.tiers[String(18 + (i % 6))]?.name,
      tierImage: DEMO_ART.tiers[String(18 + (i % 6))]?.image,
      level: 40 + i * 23,
      tier: 18 + (i % 6),
      kills,
      deaths,
      assists,
      score: acs * 21,
      acs,
      headshotPct: 16 + ((i * 7) % 15),
    };
  });
  const [blue, red] = win ? [13, 8] : [9, 13];
  let blueLeft = blue,
    redLeft = red;
  const rounds = Array.from({ length: blue + red }, (_, i) => {
    const last = i === blue + red - 1,
      blueWins = last
        ? win
        : blueLeft > (win ? 1 : 0) && (redLeft === (win ? 0 : 1) || (i * 7 + index) % 3 !== 0);
    if (blueWins) blueLeft--;
    else redLeft--;
    return {
      number: i + 1,
      winningTeam: blueWins ? 'Blue' : 'Red',
      outcome: OUTCOMES[(i + index) % OUTCOMES.length]!,
    };
  });
  const analysis = demoAnalysis(rounds, players, demoCatalog(), entry?.map ?? 'Ascent');
  const duels = demoDuelStats(players, analysis, subject);
  const self = players.find((p) => p.self) ?? players[0]!;
  const ownBlue = self.teamId === 'Blue';
  return {
    id,
    map: entry?.map ?? 'Ascent',
    mapImage: DEMO_ART.maps[entry?.map ?? 'Ascent']?.image,
    queue: entry?.queue ?? 'competitive',
    startedAt: entry?.startedAt ?? Date.now() - 3600000,
    durationMs: (38 + index * 3) * 60000 + 42000,
    agent: self.agent,
    agentImage: self.agentImage,
    kills: self.kills,
    deaths: self.deaths,
    assists: self.assists,
    acs: self.acs,
    headshotPct: self.headshotPct,
    result: win === ownBlue ? 'WIN' : 'LOSS',
    score: ownBlue ? `${blue} - ${red}` : `${red} - ${blue}`,
    teamId: self.teamId,
    teams: [
      { id: 'Blue', roundsWon: blue, won: win },
      { id: 'Red', roundsWon: red, won: !win },
    ],
    analysis,
    players: players.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
    rounds,
    duels,
  };
}
