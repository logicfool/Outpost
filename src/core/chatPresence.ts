import { Buffer } from 'buffer';
import { presenceProgress } from './liveProgress';
import { valorantActivity, presenceFields } from './presenceState';
import type { Catalog } from './types';
import type { Friend } from './chatTypes';
import { catalogItem } from './catalog';
import { nullableNumber, object, text } from './validation';
import { child, type XmlNode } from './xmppXml';

export function friendPresence(node: XmlNode, catalog: Catalog, now = Date.now()): Partial<Friend> {
  if (node.attrs.type === 'unavailable') return { presence: 'offline', updatedAt: now };
  const show = child(node, 'show')?.text,
    games = child(node, 'games'),
    valorant = games && child(games, 'valorant');
  const payload = valorant && child(valorant, 'p')?.text;
  let data: Record<string, unknown> = {};
  if (payload && payload.length < 64000) {
    try {
      data = object(
        JSON.parse(
          payload.trim().startsWith('{')
            ? payload
            : Buffer.from(payload, 'base64').toString('utf8'),
        ),
      );
    } catch {}
  }
  const { player, party, match } = presenceFields(data);
  const valOnline =
    !!valorant && data.isValid !== false && child(valorant, 'st')?.text !== 'offline';
  const activityData = valorantActivity(data);
  const loop = valOnline ? text(data.sessionLoopState) : '';
  const gameNames: Record<string, string> = {
    league_of_legends: 'League of Legends',
    league: 'League of Legends',
    bacon: 'Legends of Runeterra',
    wildrift: 'Wild Rift',
    wildrift_mobile: 'Wild Rift',
  };
  const other = games?.children.find(
    (g) => !!gameNames[g.name] && child(g, 'st')?.text !== 'offline',
  );
  const game = valOnline ? 'VALORANT' : other ? gameNames[other.name] : undefined;
  const activity = valOnline ? activityData.activity : other ? 'Online' : undefined;
  const rawSize = nullableNumber(party.partySize),
    rawMax = nullableNumber(party.maxPartySize);
  const partySize =
    valOnline && rawSize !== null && Number.isInteger(rawSize) && rawSize >= 1 && rawSize <= 100
      ? rawSize
      : undefined;
  const partyMax =
    partySize && rawMax !== null && Number.isInteger(rawMax) && rawMax >= partySize && rawMax <= 100
      ? rawMax
      : undefined;
  const state: Friend['presence'] =
    valOnline && activityData.presence !== 'online'
      ? activityData.presence
      : show === 'away' || show === 'xa'
        ? 'away'
        : 'online';
  const cardId = text(player.playerCardId),
    titleId = text(player.playerTitleId),
    mapId = valOnline ? activityData.mapId : '';
  const hideLevel = player.hideAccountLevel === true;
  const stamp = Number(valorant && child(valorant, 's.t')?.text);

  const updatedAt = now;
  return {
    presence: state,
    updatedAt,
    progress: presenceProgress(data, state === 'in_game', now),
    matchId: valOnline ? text(match.matchId) || text(match.matchID) || undefined : undefined,
    game,
    activity,
    queue: valOnline ? activityData.queue : undefined,
    partySize,
    partyMax,
    presenceSource: valOnline ? 'valorant' : 'riot',
    mapId: mapId || undefined,
    map: catalog.maps[mapId]?.name,
    status: (child(node, 'status')?.text || (valOnline ? 'VALORANT' : 'Riot client')).slice(0, 200),
    ...(cardId ? { card: catalogItem(catalog, cardId, 'card') } : {}),
    ...(titleId ? { title: catalogItem(catalog, titleId, 'title') } : {}),
    ...(valOnline
      ? {
          tier: nullableNumber(player.competitiveTier) ?? undefined,
          level: hideLevel ? null : nullableNumber(player.accountLevel),
          hideLevel,
        }
      : {}),
  };
}
export function presencePriority(state: Friend['presence']): number {
  return { in_game: 6, agent_select: 5, queue: 4, online: 3, away: 2, offline: 0 }[state];
}
