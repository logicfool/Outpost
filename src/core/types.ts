export type Shard = 'ap' | 'eu' | 'na' | 'kr' | 'pbe';
export type Region = 'ap' | 'eu' | 'na' | 'br' | 'latam' | 'kr' | 'pbe';
export type JsonObject = Record<string, unknown>;
export type ItemKind =
  | 'skin'
  | 'chroma'
  | 'buddy'
  | 'spray'
  | 'card'
  | 'title'
  | 'agent'
  | 'currency'
  | 'unknown';
export interface Account {
  puuid: string;
  gameName: string;
  tagLine: string;
  region: Region;
  shard: Shard;
  addedAt: number;
  expiresAt: number;
  country?: string;
  createdAt?: number;
  canReauth?: boolean;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  demo?: boolean;
}
export interface Session {
  version: 1 | 2;
  account: Account;
  accessToken: string;
  entitlementsToken: string;
  reauth?: { cookies: Record<string, string>; capturedAt: number };
  renewalPending?: boolean;
  accessRejected?: boolean;
  renewalFailure?: { code: string; retryAt: number };
}
export interface LoginAttempt {
  state: string;
  nonce: string;
  createdAt: number;
}
export interface LoginTokens {
  accessToken: string;
  idToken?: string;
  expiresAt: number;
  reauthCookies?: Record<string, string>;
}
export interface Money {
  currencyId: string;
  symbol: string;
  amount: number;
}
export interface CatalogMedia {
  id: string;
  name: string;
  image?: string;
  smallArt?: string;
  video?: string;
}
export interface CatalogItem {
  id: string;
  canonicalId: string;
  name: string;
  kind: ItemKind;
  image?: string;
  smallArt?: string;
  imageFallbacks?: string[];
  wallpaper?: string;
  wideArt?: string;
  rarity?: string;
  weapon?: string;
  weaponId?: string;
  video?: string;
  levels?: CatalogMedia[];
  chromas?: CatalogMedia[];
  isDefault?: boolean;
  collectionKey?: string;
  collectionName?: string;
}
export interface ContractDefinition {
  id: string;
  name: string;
  relationId?: string;
  relationType?: string;
  levels: { xp: number; rewardId?: string; rewardAmount?: number; rewardType?: string }[];
}
export interface Catalog {
  repairAfter?: number;
  schemaVersion?: number;
  failedPaths?: string[];
  items: Record<string, CatalogItem>;
  bundles: Record<
    string,
    {
      name: string;
      imageFallbacks?: string[];
      image?: string;
      isDefault?: boolean;
      collectionKey?: string;
      collectionName?: string;
      itemIds?: string[];
      itemKinds?: Record<string, ItemKind>;
      membershipSource?: 'store' | 'catalog-theme';
    }
  >;
  maps: Record<string, import('./matchTypes').MapMetadata>;
  weapons?: Record<string, import('./matchTypes').WeaponMetadata>;
  tiers: Record<string, { name: string; image?: string; smallArt?: string; color?: string }>;
  contracts: Record<string, ContractDefinition>;
  missions?: Record<string, import('./missionTypes').MissionDefinition>;
  objectives?: Record<string, string>;
  seasons?: Record<string, { name: string; startsAt?: number; endsAt?: number }>;
  currentSeasonId?: string;
  fetchedAt: number;
}
export interface StoreOffer {
  id: string;
  item: CatalogItem;
  prices: Money[];
  originalPrices?: Money[];
  discountPercent?: number;
  seen?: boolean;
}
export interface BundleLine {
  offerId: string;
  itemId: string;
  canonicalItemId: string;
  name: string;
  itemTypeId: string;
  quantity: number;
  price: number;
}
export interface BundleCheckout {
  lines: BundleLine[];
  total: number;
  wholesaleOnly: boolean;
}
export interface Bundle {
  imageFallbacks?: string[];
  catalogId?: string;
  id: string;
  name: string;
  image?: string;
  smallArt?: string;
  prices: Money[];
  expiresAt: number;
  offers: StoreOffer[];
  checkout?: BundleCheckout;
}
export interface Store {
  daily: StoreOffer[];
  dailyExpiresAt: number;
  bundles: Bundle[];
  nightMarket: null | { offers: StoreOffer[]; expiresAt: number };
  accessories: StoreOffer[];
  accessoriesExpireAt?: number;
  fetchedAt: number;
  clockOffsetMs: number;
  endpoint: 'v2' | 'v3' | 'demo';
}
export interface ActStat {
  seasonId: string;
  name: string;
  startsAt?: number;
  current: boolean;
  tier: number | null;
  tierName: string;
  image?: string;
  smallArt?: string;
  peakTier?: number;
  peakName?: string;
  peakImage?: string;
  peakSmallArt?: string;
  rr: number | null;
  wins: number;
  games: number;
}
export interface QueueCareer {
  queue: string;
  acts: ActStat[];
  wins: number;
  games: number;
}
export interface Ranked {
  name: string;
  tier: number | null;
  rr: number | null;
  image?: string;
  smallArt?: string;
  wins: number | null;
  games: number | null;
  seasonId?: string;
  seasonName?: string;
  currentSeason: boolean;
  peak?: { tier: number; name: string; image?: string; smallArt?: string; seasonName?: string };
  career?: QueueCareer[];
}
export interface LiveGame {
  state: 'offline' | 'idle' | 'agent_select' | 'in_game';
  matchId?: string;
  map?: string;
  mapImage?: string;
}
export interface MatchSummary {
  preview?: import('./matchArchive').MatchPreview;
  previewComplete?: boolean;
  id: string;
  startedAt: number;
  queue: string;
  map: string;
  mapId?: string;
  mapImage?: string;
  rrChange?: number;
  tierAfter?: number;
  rrAfter?: number;
  tierImage?: string;
}
export type RoundOutcome = 'elimination' | 'detonate' | 'defuse' | 'time' | 'surrender' | 'other';
export interface MatchPlayer {
  subject: string;
  name: string;
  tag: string;
  teamId: string;
  self: boolean;
  agent: string;
  agentImage?: string;
  level: number | null;
  tier: number | null;
  tierName?: string;
  tierImage?: string;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  score: number | null;
  acs: number | null;
  headshotPct: number | null;
}
export interface MatchDetail {
  completed?: boolean;
  id: string;
  map: string;
  mapId?: string;
  mapImage?: string;
  queue: string;
  startedAt: number;
  durationMs?: number;
  agent: string;
  agentImage?: string;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  acs: number | null;
  headshotPct: number | null;
  result: 'WIN' | 'LOSS' | 'DRAW' | 'UNKNOWN';
  score: string;
  teamId?: string;
  teams: { id: string; roundsWon: number | null; won: boolean }[];
  analysis?: import('./matchTypes').MatchAnalysis;
  players: MatchPlayer[];
  rounds: { number: number; winningTeam: string; outcome: RoundOutcome }[];
  duels: { subject: string; name: string; agentImage?: string; kills: number; deaths: number }[];
}
export interface Progression {
  contracts: {
    id: string;
    name: string;
    level: number;
    xp: number;
    nextLevelXp?: number;
    nextReward?: CatalogItem;
    currentBattlepass: boolean;
  }[];
  missions: {
    id: string;
    complete: boolean;
    expiresAt?: number;
    objectives: Record<string, number>;
  }[];
  weeklyRefillAt?: number;
  weeklyCheckpointAt?: number;
  npeCompleted?: boolean;
}
export interface Loadout {
  endpoint?: 'v2' | 'v3';
  version?: number;
  guns: { weapon: string; skin: CatalogItem; buddy?: CatalogItem }[];
  card?: CatalogItem;
  title?: CatalogItem;
}
export type Section<T> =
  | {
      status: 'ready';
      data: T;
      fetchedAt: number;
      warning?: { code: string; message: string; retryAt?: number };
    }
  | { status: 'error'; message: string; code: string; retryAt?: number };
export interface Snapshot {
  accountId: string;
  fetchedAt: number;
  demo: boolean;
  profileNextCheckAt?: number;
  profileIssue?: { code: string; message: string; retryAt?: number };
  nextAutoRefreshAt?: number;
  refreshIssue?: { code: string; message: string; retryAt?: number };
  store: Section<Store>;
  wallet: Section<Money[]>;
  rank: Section<Ranked>;
  xp: Section<{ level: number; xp: number }>;
  progression: Section<Progression>;
  collection: Section<CatalogItem[]>;
  loadout: Section<Loadout>;
  liveGame: Section<LiveGame>;
  matches: Section<MatchSummary[]>;
}
export interface HistoryEntry {
  id: string;
  accountId: string;
  observedAt: number;
  expiresAt: number;
  offers: StoreOffer[];
}
export interface Settings {
  reminders: boolean;
  backgroundSync: boolean;
  wishlistAlerts?: boolean;
  chatAlerts?: boolean;
  notificationPreviews?: boolean;
  allowPurchases?: boolean;
  theme?: import('./theme').ThemePreference;
  autoChatHistory?: boolean;
  backgroundChatHistory?: boolean;
  autoplayVideos?: boolean;
  videoSound?: boolean;
  defaultsVersion?: number;
}
export const MAX_ACCOUNTS = 10;
export const XP_PER_LEVEL = 5000;
export const DEFAULT_SETTINGS: Settings = {
  reminders: true,
  backgroundSync: true,
  wishlistAlerts: true,
  chatAlerts: true,
  notificationPreviews: true,
  allowPurchases: false,
  theme: 'navy',
  autoChatHistory: true,
  backgroundChatHistory: true,
  autoplayVideos: true,
  videoSound: true,
  defaultsVersion: 2,
};
export const EMPTY_CATALOG: Catalog = {
  items: {},
  bundles: {},
  maps: {},
  tiers: {},
  contracts: {},
  seasons: {},
  fetchedAt: 0,
};

export interface Ranked {
  source?: 'active-season' | 'latest-update' | 'latest-played' | 'unrated';
  note?: string;
  placementsRemaining?: number;
}
export interface LiveGame {
  players?: import('./playerTypes').LivePlayer[];
  queue?: string;
  gamePod?: string;
  observedAt?: number;
  nextCheckAt?: number;
  mapId?: string;
  progress?: import('./matchTypes').MatchProgress;
  presenceNotBefore?: number;
  detailError?: { code: string; message: string; retryAt?: number };
}
export interface MatchPlayer {
  hidden?: boolean;
  hideLevel?: boolean;
  card?: CatalogItem;
  title?: CatalogItem;
}
