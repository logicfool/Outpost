import type { MatchDetail, MatchSummary } from './types';
import { AppError, object, safeMedia, uuid } from './validation';
const invalid = (): never => {
  throw new AppError('BACKUP_INVALID', 'The backup contains an invalid match or profile record.');
};
const text = (v: unknown, max = 200) => {
  if (typeof v !== 'string' || v.length > max) invalid();
};
const num = (v: unknown, min = 0, max = 1e15) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) invalid();
};
const optional = (v: unknown, check: (v: unknown) => void) => {
  if (v !== undefined && v !== null) check(v);
};
const media = (v: unknown) => {
  if (typeof v !== 'string' || !safeMedia(v)) invalid();
};
const images = (r: Record<string, unknown>) => {
  for (const key of [
    'image',
    'smallArt',
    'mapImage',
    'agentImage',
    'tierImage',
    'wallpaper',
    'wideArt',
    'video',
    'weaponImage',
    'minimap',
    'listImage',
  ])
    optional(r[key], media);
};
const list = (v: unknown, max: number): unknown[] => {
  if (!Array.isArray(v) || v.length > max) invalid();
  return v as unknown[];
};
const bool = (v: unknown) => {
  if (typeof v !== 'boolean') invalid();
};
const point = (v: unknown) => {
  const p = object(v);
  num(p.x, -1e7, 1e7);
  num(p.y, -1e7, 1e7);
};
export function validatePreviewShape(value: unknown): void {
  const p = object(value);
  text(p.map);
  optional(p.mapId, (v) => text(v, 512));
  text(p.agent);
  text(p.score, 60);
  optional(p.placement, (v) => {
    num(v, 1, 8);
    if (!Number.isInteger(v)) invalid();
  });
  images(p);
  if (!['WIN', 'LOSS', 'DRAW', 'UNKNOWN'].includes(String(p.result))) invalid();
  for (const key of ['kills', 'deaths', 'assists']) if (p[key] !== null) num(p[key], 0, 10000);
}
export function validateSummaryShape(value: MatchSummary): void {
  uuid(value.id);
  num(value.startedAt);
  text(value.queue, 80);
  text(value.map);
  optional(value.mapId, (v) => text(v, 512));
  images(value as unknown as Record<string, unknown>);
  optional(value.preview, validatePreviewShape);
  optional(value.rrChange, (v) => num(v, -10000, 10000));
  optional(value.tierAfter, (v) => num(v, 0, 100));
}
export function validateCatalogShape(value: unknown): void {
  const c = object(value);
  uuid(c.id);
  uuid(c.canonicalId);
  text(c.name);
  text(c.kind, 40);
  images(c);
  for (const key of ['weapon', 'rarity', 'collectionKey', 'collectionName']) optional(c[key], text);
  optional(c.weaponId, uuid);
  optional(c.isDefault, bool);
  if (c.imageFallbacks !== undefined) list(c.imageFallbacks, 20).forEach(media);
  for (const key of ['levels', 'chromas'])
    if (c[key] !== undefined)
      for (const item of list(c[key], 100)) {
        const r = object(item);
        uuid(r.id);
        text(r.name);
        images(r);
      }
}
export function validateEventShape(value: unknown): void {
  const e = object(value);
  text(e.id, 300);
  num(e.round, 0, 300);
  images(e);
  for (const key of ['weaponName', 'damageType', 'site']) optional(e[key], text);
  if (!['kill', 'plant', 'defuse'].includes(String(e.kind))) invalid();
  optional(e.actor, uuid);
  optional(e.victim, uuid);
  optional(e.atMs, (v) => num(v, 0, 86400000));
  optional(e.gameMs, (v) => num(v, 0, 86400000));
  for (const id of list(e.assistants, 100)) uuid(id);
  for (const row of list(e.positions, 100)) {
    const p = object(row);
    uuid(p.subject);
    point(p.location);
    optional(p.viewRadians, (v) => num(v, -100, 100));
  }
  optional(e.location, point);
}
export function validateReportShape(d: MatchDetail): void {
  validatePreviewShape(d);
  uuid(d.id);
  num(d.startedAt);
  text(d.queue, 80);
  optional(d.durationMs, (v) => num(v, 0, 86400000));
  const players = list(d.players, 100);
  if (!players.length) invalid();
  for (const value of players) {
    const p = object(value);
    uuid(p.subject);
    text(p.name);
    text(p.tag);
    text(p.agent);
    text(p.teamId, 60);
    bool(p.self);
    images(p);
    for (const k of ['kills', 'deaths', 'assists', 'score', 'acs', 'headshotPct', 'level', 'tier'])
      if (p[k] !== null) num(p[k], 0, 1e8);
    optional(p.card, validateCatalogShape);
    optional(p.title, validateCatalogShape);
    for (const k of ['hidden', 'hideLevel']) optional(p[k], bool);
  }
  for (const value of list(d.rounds, 300)) {
    const r = object(value);
    num(r.number, 0, 300);
    text(r.winningTeam);
    if (
      !['elimination', 'detonate', 'defuse', 'time', 'surrender', 'other'].includes(
        String(r.outcome),
      )
    )
      invalid();
  }
  for (const value of list(d.teams, 100)) {
    const t = object(value);
    text(t.id);
    if (t.roundsWon !== null) num(t.roundsWon, 0, 10000);
    bool(t.won);
  }
  for (const value of list(d.duels, 100)) {
    const r = object(value);
    uuid(r.subject);
    text(r.name);
    images(r);
    num(r.kills, 0, 10000);
    num(r.deaths, 0, 10000);
  }
  if (d.gauntlet) {
    const g = d.gauntlet;
    if (uuid(g.matchId) !== uuid(d.id) || g.complete !== !!d.completed) invalid();
    bool(g.complete);
    num(g.observedAt);
    const ids = new Set<string>();
    for (const value of list(g.teams, 64)) {
      const t = object(value);
      text(t.id, 60);
      const id = String(t.id).trim().toLowerCase();
      if (!id || ids.has(id)) invalid();
      ids.add(id);
      optional(t.name, (v) => text(v, 120));
      for (const member of list(t.members, 100)) uuid(member);
      for (const field of ['health', 'maxHealth']) optional(t[field], (v) => num(v, 0, 100000));
      for (const field of ['eliminated', 'won']) optional(t[field], bool);
      optional(t.placement, (v) => {
        num(v, 1, 8);
        if (!Number.isInteger(v)) invalid();
      });
      num(t.seenAt, 0, g.observedAt);
      optional(t.evidenceAt, (v) => num(v, 0, g.observedAt));
    }
  }
  if (d.analysis) {
    const a = d.analysis;
    if (a.version !== 1) invalid();
    bool(a.available);
    list(a.events, 6000).forEach(validateEventShape);
    for (const value of list(a.rounds, 300)) {
      const r = object(value);
      num(r.number, 0, 300);
      bool(r.telemetry);
      list(r.events, 6000).forEach(validateEventShape);
      for (const e of list(r.economy, 100)) {
        const row = object(e);
        uuid(row.subject);
        images(row);
        optional(row.weaponName, text);
        for (const key of ['loadoutValue', 'remaining', 'spent'])
          optional(row[key], (v) => num(v, 0, 1000000));
      }
    }
    if (a.minimap) {
      text(a.minimap.name);
      images(a.minimap as unknown as Record<string, unknown>);
      for (const k of ['xMultiplier', 'yMultiplier', 'xScalarToAdd', 'yScalarToAdd'] as const)
        optional(a.minimap[k], (v) => num(v, -1e7, 1e7));
    }
  }
}
export function validateProfileData(value: unknown, kind: string): void {
  const r = object(value);
  if (r.status === 'error') {
    text(r.code);
    text(r.message, 2000);
    return;
  }
  if (r.status !== 'ready') invalid();
  num(r.fetchedAt);
  const d = object(r.data);
  if (kind === 'rank') {
    text(d.name);
    images(d);
    optional(d.note, text);
    optional(d.currentSeason, bool);
    for (const key of ['tier', 'rr', 'wins', 'games']) optional(d[key], (v) => num(v, 0, 1e8));
    if (d.career !== undefined)
      for (const v of list(d.career, 30)) {
        const q = object(v);
        text(q.queue);
        num(q.wins);
        num(q.games);
        for (const a of list(q.acts, 500)) {
          const p = object(a);
          text(p.name);
          images(p);
          text(p.seasonId);
          text(p.tierName);
          bool(p.current);
          num(p.wins);
          num(p.games);
        }
      }
    if (d.peak) {
      const p = object(d.peak);
      text(p.name);
      images(p);
      num(p.tier, 0, 100);
    }
  }
  if (kind === 'xp') {
    num(d.level);
    num(d.xp);
  }
  if (kind === 'loadout') {
    for (const g of list(d.guns, 40)) {
      const gun = object(g);
      text(gun.weapon);
      validateCatalogShape(gun.skin);
      optional(gun.buddy, validateCatalogShape);
    }
    optional(d.card, validateCatalogShape);
    optional(d.title, validateCatalogShape);
  }
  if (kind === 'progression') {
    for (const v of list(d.contracts, 1000)) {
      const c = object(v);
      text(c.id);
      text(c.name);
      num(c.level);
      num(c.xp);
      bool(c.currentBattlepass);
      optional(c.nextReward, validateCatalogShape);
    }
    for (const v of list(d.missions, 1000)) {
      const m = object(v);
      text(m.id);
      bool(m.complete);
      const o = m.objectives;
      if (Array.isArray(o)) list(o, 1000).forEach((v) => num(v));
      else {
        const entries = Object.entries(object(o));
        if (entries.length > 1000) invalid();
        for (const [key, progress] of entries) {
          text(key, 200);
          num(progress);
        }
      }
    }
    optional(d.weeklyCheckpointAt, num);
    optional(d.npeCompleted, bool);
  }
}
