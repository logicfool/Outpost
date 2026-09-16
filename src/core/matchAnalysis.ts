import type { Catalog, MatchDetail, MatchPlayer } from './types';
import type {
  MapMetadata,
  MatchAnalysis,
  MatchEvent,
  PlayerPosition,
  RoundDetail,
  RoundEconomy,
  WorldPoint,
} from './matchTypes';
import { array, object, text } from './validation';

const MAX_ROUNDS = 200,
  MAX_EVENTS = 6000,
  MAX_PLAYERS = 64;
const id = (value: unknown) => text(value).trim().toLowerCase();
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const time = (value: unknown): number | undefined =>
  finite(value) && value >= 0 && value <= 86400000 ? value : undefined;
const money = (value: unknown): number | undefined =>
  finite(value) && value >= 0 && value <= 1000000 ? value : undefined;
export function worldPoint(raw: unknown): WorldPoint | undefined {
  const p = object(raw);
  return finite(p.x) && finite(p.y) && Math.abs(p.x) < 10000000 && Math.abs(p.y) < 10000000
    ? { x: p.x, y: p.y }
    : undefined;
}

export function mapPoint(point: WorldPoint, map?: MapMetadata): WorldPoint | undefined {
  if (
    !map ||
    !worldPoint(point) ||
    !finite(map.xMultiplier) ||
    !finite(map.yMultiplier) ||
    !finite(map.xScalarToAdd) ||
    !finite(map.yScalarToAdd) ||
    map.xMultiplier === 0 ||
    map.yMultiplier === 0
  )
    return;
  const x = point.y * map.xMultiplier + map.xScalarToAdd,
    y = point.x * map.yMultiplier + map.yScalarToAdd;

  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : undefined;
}
export function eventClock(atMs?: number): string {
  if (!finite(atMs) || atMs < 0) return '-';
  const seconds = Math.floor(atMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export function normalizeAnalysis(
  raw: unknown,
  catalog: Catalog,
  players: MatchPlayer[],
): MatchAnalysis {
  const root = object(raw),
    roster = new Set(players.map((p) => p.subject)),
    allRounds = array(root.roundResults),
    rawRounds = allRounds.slice(0, MAX_ROUNDS);
  const events = new Map<string, MatchEvent>(),
    rounds = new Map<number, RoundDetail>();
  const mirroredByTime = new Map<string, number>();
  let truncated = allRounds.length > MAX_ROUNDS,
    available =
      Array.isArray(root.kills) || rawRounds.some((r) => Array.isArray(object(r).playerStats));
  const positions = (raw: unknown): PlayerPosition[] => {
    const map = new Map<string, PlayerPosition>();
    for (const entry of array(raw).slice(0, MAX_PLAYERS)) {
      const p = object(entry),
        subject = id(p.subject),
        location = worldPoint(p.location);
      if (roster.has(subject) && location)
        map.set(subject, {
          subject,
          location,
          ...(finite(p.viewRadians) ? { viewRadians: p.viewRadians } : {}),
        });
    }
    return [...map.values()];
  };
  const put = (event: MatchEvent) => {
    if (events.size >= MAX_EVENTS && !events.has(event.id)) {
      truncated = true;
      return;
    }
    const old = events.get(event.id);
    if (old) {
      old.positions = [
        ...new Map([...event.positions, ...old.positions].map((p) => [p.subject, p])).values(),
      ];
      old.location ??= event.location;
      old.atMs ??= event.atMs;
      old.gameMs ??= event.gameMs;
      old.assistants = [...new Set([...old.assistants, ...event.assistants])];
    } else events.set(event.id, event);
    if (event.kind === 'kill' && event.gameMs !== undefined)
      mirroredByTime.set(
        `${event.gameMs}:${event.actor ?? 'environment'}:${event.victim}`,
        event.round,
      );
  };
  const kill = (raw: unknown, round: number) => {
    const k = object(raw),
      victim = id(k.victim),
      actorId = id(k.killer),
      actor = roster.has(actorId) ? actorId : undefined;
    if (!roster.has(victim)) return;
    const atMs = time(k.roundTime),
      gameMs = time(k.gameTime),
      damage = object(k.finishingDamage),
      weaponId = id(damage.damageItem),
      weapon = catalog.weapons?.[weaponId];
    const damageType = text(damage.damageType).slice(0, 32);
    const key = `${round}:kill:${gameMs ?? atMs ?? 'unknown'}:${actor ?? 'environment'}:${victim}`;
    put({
      id: key,
      round,
      kind: 'kill',
      atMs,
      gameMs,
      actor,
      victim,
      assistants: [
        ...new Set(
          array(k.assistants)
            .map(id)
            .filter((v) => roster.has(v) && v !== actor && v !== victim),
        ),
      ],
      location: worldPoint(k.victimLocation),
      positions: positions(k.playerLocations),
      damageType,
      weaponId: weaponId || undefined,
      weaponName:
        weapon?.name ??
        (damageType === 'Ability'
          ? 'Ability'
          : damageType === 'Bomb'
            ? 'Spike'
            : damageType === 'Fall'
              ? 'Fall'
              : damageType === 'Melee'
                ? 'Melee'
                : undefined),
      weaponImage: weapon?.killIcon ?? weapon?.image,
    });
  };
  for (const [index, rawRound] of rawRounds.entries()) {
    const r = object(rawRound),
      rn = r.roundNum;
    const number =
      finite(rn) && Number.isInteger(rn) && rn >= 0 && rn < MAX_ROUNDS ? rn + 1 : index + 1;
    const economy = new Map<string, RoundEconomy>();
    const addEconomy = (value: unknown, subject: string) => {
      if (!roster.has(subject)) return;
      const e = object(value),
        weaponId = id(e.weapon),
        weapon = catalog.weapons?.[weaponId];
      economy.set(subject, {
        subject,
        weaponId: weaponId || undefined,
        weaponName: weapon?.name,
        weaponImage: weapon?.image,
        loadoutValue: money(e.loadoutValue),
        remaining: money(e.remaining),
        spent: money(e.spent),
      });
    };
    for (const stats of array(r.playerStats).slice(0, MAX_PLAYERS).map(object)) {
      const list = array(stats.kills);
      if (list.length > 512) truncated = true;
      for (const value of list.slice(0, 512)) kill(value, number);
      if (stats.economy) addEconomy(stats.economy, id(stats.subject));
    }
    for (const e of array(r.playerEconomies).slice(0, MAX_PLAYERS))
      addEconomy(e, id(object(e).subject));
    for (const kind of ['plant', 'defuse'] as const) {
      const atMs = time(r[`${kind}RoundTime`]),
        actorId = id(r[kind === 'plant' ? 'bombPlanter' : 'bombDefuser']);

      if (atMs === undefined || atMs <= 0) continue;
      put({
        id: `${number}:${kind}:${atMs}`,
        round: number,
        kind,
        atMs,
        actor: roster.has(actorId) ? actorId : undefined,
        assistants: [],
        location: worldPoint(r[`${kind}Location`]),
        positions: positions(r[`${kind}PlayerLocations`]),
        site: /^[ABC]$/.test(text(r.plantSite)) ? text(r.plantSite) : undefined,
      });
    }
    rounds.set(number, {
      number,
      events: [],
      economy: [...economy.values()],
      ceremony: text(r.roundCeremony).replace(/^Ceremony/, '') || undefined,
      telemetry: Array.isArray(r.playerStats),
    });
  }
  const flat = array(root.kills);
  if (flat.length > MAX_EVENTS) truncated = true;
  for (const rawKill of flat.slice(0, MAX_EVENTS)) {
    const k = object(rawKill),
      round = k.round;

    const number =
      finite(round) && Number.isInteger(round) && round >= 0 && round < MAX_ROUNDS ? round + 1 : 0;
    const rootVictim = id(k.victim),
      rootActor = id(k.killer),
      gameMs = time(k.gameTime);
    const mirroredRound =
      gameMs !== undefined
        ? mirroredByTime.get(
            `${gameMs}:${roster.has(rootActor) ? rootActor : 'environment'}:${rootVictim}`,
          )
        : undefined;
    kill(k, mirroredRound ?? number);
  }
  const sorted = [...events.values()].sort(
    (a, b) =>
      a.round - b.round ||
      (a.atMs ?? Infinity) - (b.atMs ?? Infinity) ||
      (a.gameMs ?? Infinity) - (b.gameMs ?? Infinity) ||
      a.id.localeCompare(b.id),
  );
  for (const event of sorted) {
    if (!event.round) continue;
    const r = rounds.get(event.round) ?? {
      number: event.round,
      events: [],
      economy: [],
      telemetry: true,
    };
    r.events.push(event);
    rounds.set(event.round, r);
  }
  return {
    version: 1,
    minimap: catalog.maps[text(object(root.matchInfo).mapId)],
    events: sorted,
    rounds: [...rounds.values()].sort((a, b) => a.number - b.number),
    available,
    ...(truncated ? { truncated: true } : {}),
  };
}
export function isEnemyKill(event: MatchEvent, players: MatchPlayer[]): boolean {
  if (event.kind !== 'kill' || !event.actor || !event.victim || event.actor === event.victim)
    return false;
  const killer = players.find((p) => p.subject === event.actor),
    victim = players.find((p) => p.subject === event.victim);
  return (
    !!killer &&
    !!victim &&
    (killer.teamId !== victim.teamId || killer.teamId.toLowerCase() === 'neutral')
  );
}
export function duelGrid(detail: MatchDetail) {
  const allies = detail.players.filter((p) => p.teamId === detail.teamId),
    enemies = detail.players.filter((p) => p.teamId !== detail.teamId);
  const events = (detail.analysis?.events ?? []).filter((e) => isEnemyKill(e, detail.players));
  const counts = new Map<string, number>();
  for (const event of events) {
    const key = `${event.actor}:${event.victim}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const count = (a: string, b: string) => counts.get(`${a}:${b}`) ?? 0;
  const cells = allies.flatMap((a) =>
    enemies.map((b) => ({
      ally: a,
      enemy: b,
      kills: count(a.subject, b.subject),
      deaths: count(b.subject, a.subject),
    })),
  );
  const rivalry = [...cells]
    .filter((c) => c.kills + c.deaths > 0)
    .sort((a, b) => b.kills + b.deaths - a.kills - a.deaths)[0];
  const strongest = [...cells]
    .filter((c) => c.kills > c.deaths)
    .sort((a, b) => b.kills - b.deaths - (a.kills - a.deaths) || b.kills - a.kills)[0];
  const self = detail.players.find((p) => p.self);
  const assists = self
    ? allies
        .filter((p) => p.subject !== self.subject)
        .map((player) => ({
          player,
          count: events.filter(
            (e) =>
              (e.actor === self.subject && e.assistants.includes(player.subject)) ||
              (e.actor === player.subject && e.assistants.includes(self.subject)),
          ).length,
        }))
        .sort((a, b) => b.count - a.count)[0]
    : undefined;
  return {
    allies,
    enemies,
    cells,
    rivalry,
    strongest,
    assists: assists?.count ? assists : undefined,
    events,
  };
}

export function eventPositions(
  round: RoundDetail,
  selected: MatchEvent,
): { subject: string; location: WorldPoint; lastDeath: boolean }[] {
  const pins = new Map<string, { subject: string; location: WorldPoint; lastDeath: boolean }>();
  const index = round.events.findIndex((e) => e.id === selected.id);
  if (index < 0) return [];
  for (const e of round.events.slice(0, index + 1))
    if (e.kind === 'kill' && e.victim && e.location)
      pins.set(e.victim, { subject: e.victim, location: e.location, lastDeath: true });
  for (const p of selected.positions)
    pins.set(p.subject, { subject: p.subject, location: p.location, lastDeath: false });
  if (selected.kind === 'kill' && selected.victim && selected.location)
    pins.set(selected.victim, {
      subject: selected.victim,
      location: selected.location,
      lastDeath: true,
    });
  return [...pins.values()];
}
