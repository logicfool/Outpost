import type { LiveGame, MatchDetail } from './types';
import { isGauntletMap } from './maps';
import { object } from './validation';

export const GAUNTLET_DUOS = 8;
export type DuoStatus = 'active' | 'eliminated' | 'winner' | 'unknown';
export interface GauntletTeam {
  id: string;
  name?: string;
  members: string[];
  health?: number;
  maxHealth?: number;
  eliminated?: boolean;
  placement?: number;
  won?: boolean;
  evidenceAt?: number;
  seenAt: number;
}
export interface GauntletState {
  matchId: string;
  complete: boolean;
  observedAt: number;
  teams: GauntletTeam[];
}
const key = (v: string) => v.trim().toLowerCase();
const clean = (v: unknown, max = 60): string | undefined =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f]/.test(v)
    ? v.trim()
    : undefined;
const amount = (v: unknown, max = 100000): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : undefined;
const place = (v: unknown) => {
  const n = amount(v, GAUNTLET_DUOS);
  return n !== undefined && Number.isInteger(n) && n >= 1 ? n : undefined;
};
export function isGauntlet(value: { queue?: string; mapId?: string; map?: string }): boolean {
  return (
    ['abilitydraft', 'abilitydraftarena'].includes(key(value.queue ?? '')) ||
    isGauntletMap(value.mapId ?? value.map ?? '')
  );
}
/** Optional team-scoped extensions only. No HP is inferred from points, kills or rounds.
 * Live extension field availability needs an authenticated Gauntlet capture; public docs
 * currently guarantee team IDs and post-match won/round totals, not live elimination data. */
export function readGauntlet(
  matchId: string,
  rawTeams: readonly unknown[],
  players: readonly { subject: string; teamId: string }[],
  complete = false,
  now = Date.now(),
): GauntletState {
  const rows = new Map<string, Record<string, unknown>>();
  for (const value of rawTeams.slice(0, 64)) {
    const row = object(value),
      id = clean(row.TeamID ?? row.teamId ?? row.id);
    if (id) rows.set(key(id), { ...rows.get(key(id)), ...row });
  }
  for (const player of players) {
    const id = clean(player.teamId);
    if (id && !rows.has(key(id)) && rows.size < 64) rows.set(key(id), { teamId: id });
  }
  const teams = [...rows.entries()].map(([teamKey, row]): GauntletTeam => {
    const health = amount(row.TeamHealth ?? row.teamHealth);
    const maximum = amount(row.MaxTeamHealth ?? row.maxTeamHealth);
    const rawEliminated = row.IsEliminated ?? row.isEliminated;
    const eliminated = typeof rawEliminated === 'boolean' ? rawEliminated : undefined;
    const placement = place(
      row.FinalPlacement ??
        row.finalPlacement ??
        (complete ? (row.Placement ?? row.placement) : undefined),
    );
    const rawWon = row.Won ?? row.won;
    const won = complete && typeof rawWon === 'boolean' ? rawWon : undefined;
    const evidence =
      health !== undefined ||
      eliminated !== undefined ||
      placement !== undefined ||
      won !== undefined;
    return {
      id: clean(row.TeamID ?? row.teamId ?? row.id)!,
      name: clean(row.TeamName ?? row.teamName, 120),
      members: [
        ...new Set(players.filter((p) => key(p.teamId) === teamKey).map((p) => p.subject)),
      ].slice(0, 100),
      health,
      maxHealth: maximum && (health === undefined || maximum >= health) ? maximum : undefined,
      eliminated,
      placement,
      won,
      evidenceAt: evidence ? now : undefined,
      seenAt: now,
    };
  });
  return { matchId, complete, observedAt: now, teams };
}
function conflictingOutcome(team: GauntletTeam): boolean {
  const winner = team.won === true || team.placement === 1;
  return (
    (team.won === true && team.placement !== undefined && team.placement !== 1) ||
    (winner && (team.eliminated === true || team.health === 0 || team.won === false)) ||
    (team.eliminated === false && (team.health === 0 || (team.placement ?? 0) > 1))
  );
}
export function duoStatus(team: GauntletTeam, state: GauntletState): DuoStatus {
  if (conflictingOutcome(team)) return 'unknown';
  // Do not infer a winner while the tournament is running, even if only one duo remains.
  const winners = state.complete
    ? state.teams.filter((t) => t.won === true || t.placement === 1)
    : [];
  if (winners.length === 1 && !conflictingOutcome(winners[0]!))
    return key(team.id) === key(winners[0]!.id) ? 'winner' : 'eliminated';
  // An explicit *final* placement can be returned for a departed duo before everyone finishes.
  if (team.eliminated === true || team.health === 0 || (team.placement ?? 0) > 1)
    return 'eliminated';
  if (!state.complete && (team.eliminated === false || (team.health ?? 0) > 0)) return 'active';
  return 'unknown';
}
export function gauntletForGame(game: LiveGame): GauntletState | undefined {
  if (!isGauntlet(game) || !game.matchId) return;
  return game.gauntlet && key(game.gauntlet.matchId) === key(game.matchId)
    ? game.gauntlet
    : readGauntlet(game.matchId, [], game.players ?? [], false, game.observedAt ?? 0);
}
export function gauntletForReport(detail: MatchDetail): GauntletState | undefined {
  if (!isGauntlet(detail)) return;
  return detail.gauntlet &&
    key(detail.gauntlet.matchId) === key(detail.id) &&
    detail.gauntlet.complete === !!detail.completed
    ? detail.gauntlet
    : readGauntlet(detail.id, detail.teams, detail.players, !!detail.completed, 0);
}
export function duoLabel(team: GauntletTeam, teams: readonly GauntletTeam[]): string {
  const ids = teams.map((t) => key(t.id)).sort();
  return team.name ?? `Duo ${ids.indexOf(key(team.id)) + 1}`;
}
export function gauntletGroups(game: LiveGame, ownId?: string) {
  const state = gauntletForGame(game);
  if (!state) return [];
  const own = game.players?.find((p) => p.subject === ownId || p.self)?.teamId;
  const groups = [...state.teams]
    .sort(
      (a, b) =>
        Number(key(b.id) === key(own ?? '')) - Number(key(a.id) === key(own ?? '')) ||
        key(a.id).localeCompare(key(b.id)),
    )
    .map((team) => ({
      id: team.id,
      label: duoLabel(team, state.teams),
      friendly: !!own && key(team.id) === key(own),
      team,
      players: (game.players ?? []).filter((p) => key(p.teamId) === key(team.id)),
    }));
  const unassigned = (game.players ?? []).filter((p) => !clean(p.teamId));
  return [
    ...groups,
    ...(unassigned.length
      ? [
          {
            id: '@unassigned',
            label: 'Team not reported',
            friendly: unassigned.some((p) => p.self || p.subject === ownId),
            team: undefined,
            players: unassigned,
          },
        ]
      : []),
  ];
}
export function teamStale(team: GauntletTeam, state: GauntletState, now = Date.now()): boolean {
  return (
    !state.complete &&
    (team.evidenceAt === undefined ||
      team.evidenceAt < state.observedAt ||
      now - team.evidenceAt > 60000 ||
      team.evidenceAt > now + 60000)
  );
}
export function gauntletCounts(state: GauntletState, now = Date.now()) {
  const statuses = state.teams.map((t) => duoStatus(t, state));
  const eliminated = statuses.filter((s) => s === 'eliminated').length;
  const unknown = statuses.filter((s) => s === 'unknown').length;
  const stale = state.teams.some((t) => teamStale(t, state, now));
  return {
    reported: state.teams.length,
    eliminated,
    unknown,
    stale,
    remaining:
      state.teams.length === GAUNTLET_DUOS && !unknown && !stale
        ? GAUNTLET_DUOS - eliminated
        : undefined,
  };
}
/** Missing rows do not mean elimination; preserve evidence with its original timestamp.
 * Kept team membership is display-only and never extends the current player authorization scope. */
export function mergeGauntletLive(previous: LiveGame | undefined, next: LiveGame): LiveGame {
  const incoming = gauntletForGame(next),
    old = previous && gauntletForGame(previous);
  if (
    !incoming ||
    !old ||
    key(incoming.matchId) !== key(old.matchId) ||
    next.state !== 'in_game' ||
    previous?.state !== 'in_game'
  )
    return next;
  const a = previous?.players?.find((p) => p.self)?.subject;
  const b = next.players?.find((p) => p.self)?.subject;
  if (!a || !b || a !== b) return next;
  if (incoming.observedAt < old.observedAt) return previous!;
  const rows = new Map(old.teams.map((t) => [key(t.id), t]));
  const assignments = new Map((next.players ?? []).map((p) => [p.subject, key(p.teamId)]));
  for (const team of incoming.teams) {
    const prior = rows.get(key(team.id));
    rows.set(
      key(team.id),
      prior
        ? {
            ...team,
            // Preserve navigation keys when Riot changes only the spelling/case of a team ID.
            id: prior.id,
            name: team.name ?? prior.name,
            ...(team.evidenceAt === undefined
              ? {
                  health: prior.health,
                  maxHealth: prior.maxHealth,
                  eliminated: prior.eliminated,
                  placement: prior.placement,
                  won: prior.won,
                  evidenceAt: prior.evidenceAt,
                }
              : {}),
            members: [...new Set([...team.members, ...prior.members])]
              .filter((id) => !assignments.has(id) || assignments.get(id) === key(team.id))
              .slice(0, 100),
          }
        : team,
    );
  }
  const teams = [...rows.values()].slice(0, 64).map((team) => ({
    ...team,
    members: team.members.filter(
      (id) => !assignments.has(id) || assignments.get(id) === key(team.id),
    ),
  }));
  return { ...next, gauntlet: { ...incoming, teams } };
}
export function gauntletOwnResult(detail: MatchDetail): string {
  const state = gauntletForReport(detail);
  const team = state?.teams.find((t) => key(t.id) === key(detail.teamId ?? ''));
  if (!team || !state) return 'Placement not reported';
  if (team.placement) return `Placed #${team.placement}`;
  const status = duoStatus(team, state);
  return status === 'winner'
    ? 'Winning duo'
    : status === 'eliminated'
      ? 'Duo eliminated'
      : state.complete
        ? 'Placement not reported'
        : 'Tournament in progress';
}
