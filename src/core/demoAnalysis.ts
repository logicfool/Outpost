import type { Catalog, MatchDetail, MatchPlayer } from './types';
import { normalizeAnalysis, isEnemyKill } from './matchAnalysis';

export function demoAnalysis(
  rounds: MatchDetail['rounds'],
  players: MatchPlayer[],
  catalog: Catalog,
  mapId: string,
) {
  const map = catalog.maps[mapId],
    weapons = Object.values(catalog.weapons ?? {}),
    rifle = weapons.find((w) => w.name === 'Vandal'),
    pistol = weapons.find((w) => w.name === 'Classic');
  const point = (u: number, v: number) => ({
    x: map?.yMultiplier ? (v - (map.yScalarToAdd ?? 0)) / map.yMultiplier : v * 1000,
    y: map?.xMultiplier ? (u - (map.xScalarToAdd ?? 0)) / map.xMultiplier : u * 1000,
  });
  const roundResults = rounds.map((round, index) => {
    const winners = players.filter((p) => p.teamId === round.winningTeam),
      losers = players.filter((p) => p.teamId !== round.winningTeam);
    const weapon = index % 12 === 0 ? pistol : rifle;
    const deaths = new Set<string>(),
      kills: Record<string, unknown>[] = [];
    const location = (p: MatchPlayer, step: number) => {
      const i = players.indexOf(p);
      return point(
        0.25 + ((i * 7 + index + step) % 11) * 0.045,
        0.2 + ((i * 3 + index + step) % 12) * 0.044,
      );
    };
    const positions = (step: number) =>
      players
        .filter((p) => !deaths.has(p.subject))
        .map((p) => ({ subject: p.subject, location: location(p, step), viewRadians: 0 }));
    const record = (actor: MatchPlayer, victim: MatchPlayer, step: number) => {
      const atMs = 8000 + step * 7200 + (index % 3) * 1000;
      kills.push({
        killer: actor.subject,
        victim: victim.subject,
        assistants:
          step % 3 === 1
            ? players
                .filter(
                  (p) =>
                    p.teamId === actor.teamId &&
                    p.subject !== actor.subject &&
                    !deaths.has(p.subject),
                )
                .slice(0, 1)
                .map((p) => p.subject)
            : [],
        roundTime: atMs,
        gameTime: index * 120000 + atMs,
        victimLocation: location(victim, step),
        playerLocations: positions(step),
        finishingDamage: { damageType: 'Weapon', damageItem: weapon?.id ?? '' },
      });
      deaths.add(victim.subject);
    };
    const losses = index % 4;
    for (let n = 0; n < losses; n++) record(losers[n % losers.length]!, winners[n]!, n);
    for (let n = 0; n < losers.length; n++)
      record(winners[losses + (n % (winners.length - losses))]!, losers[n]!, losses + n);
    const last = Number(kills[kills.length - 1]?.roundTime ?? 30000);
    return {
      roundNum: index,
      roundResultCode: round.outcome,
      winningTeam: round.winningTeam,
      roundCeremony: index % 7 === 0 ? 'CeremonyFlawless' : 'CeremonyDefault',
      ...(round.outcome === 'detonate' || round.outcome === 'defuse'
        ? {
            plantRoundTime: 25000,
            bombPlanter: losers[0]!.subject,
            plantSite: 'A',
            plantLocation: point(0.37, 0.3),
            plantPlayerLocations: players
              .slice(0, 5)
              .map((p) => ({ subject: p.subject, location: location(p, 2) })),
          }
        : {}),
      ...(round.outcome === 'defuse'
        ? {
            defuseRoundTime: last + 10000,
            bombDefuser: winners[losses]!.subject,
            defuseLocation: point(0.37, 0.3),
            defusePlayerLocations: positions(8),
          }
        : {}),
      playerStats: players.map((p) => ({
        subject: p.subject,
        kills: kills.filter((k) => k.killer === p.subject),
        economy: {
          weapon: weapon?.id ?? '',
          loadoutValue: index === 0 ? 650 : 3900,
          remaining: 1200 + index * 50,
          spent: index === 0 ? 650 : 2900,
        },
      })),
    };
  });
  return normalizeAnalysis(
    {
      matchInfo: { mapId },
      roundResults,
      kills: roundResults.flatMap((r) =>
        r.playerStats.flatMap((p) => p.kills.map((k) => ({ ...k, round: r.roundNum }))),
      ),
    },
    catalog,
    players,
  );
}
export function demoDuelStats(
  players: MatchPlayer[],
  analysis: ReturnType<typeof demoAnalysis>,
  self: string,
) {
  const kills = analysis.events.filter((e) => isEnemyKill(e, players));
  for (const p of players) {
    p.kills = kills.filter((e) => e.actor === p.subject).length;
    p.deaths = kills.filter((e) => e.victim === p.subject).length;
    p.assists = kills.filter((e) => e.assistants.includes(p.subject)).length;
  }
  const own = players.find((p) => p.subject === self)!;
  return players
    .filter((p) => p.teamId !== own.teamId)
    .map((p) => ({
      subject: p.subject,
      name: p.name,
      agentImage: p.agentImage,
      kills: kills.filter((e) => e.actor === self && e.victim === p.subject).length,
      deaths: kills.filter((e) => e.actor === p.subject && e.victim === self).length,
    }));
}
