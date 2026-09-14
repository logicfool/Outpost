import { Buffer } from 'buffer';
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
      data = object(JSON.parse(Buffer.from(payload, 'base64').toString('utf8')));
    } catch {}
  }
  const valOnline =
    !!valorant && data.isValid !== false && child(valorant, 'st')?.text !== 'offline';
  const loop = valOnline ? text(data.sessionLoopState) : '';
  const state: Friend['presence'] =
    loop === 'INGAME'
      ? 'in_game'
      : loop === 'PREGAME'
        ? 'agent_select'
        : valOnline && data.partyState === 'MATCHMAKING'
          ? 'queue'
          : show === 'away' || show === 'xa'
            ? 'away'
            : 'online';
  const cardId = text(data.playerCardId),
    titleId = text(data.playerTitleId),
    mapId = text(data.matchMap);
  const hideLevel = data.hideAccountLevel === true;
  const stamp = Number(valorant && child(valorant, 's.t')?.text);
  const updatedAt = Number.isFinite(stamp) && stamp > 0 && stamp <= now + 60000 ? stamp : now;
  return {
    presence: state,
    updatedAt,
    presenceSource: valOnline ? 'valorant' : 'riot',
    mapId: mapId || undefined,
    map: catalog.maps[mapId]?.name,
    status: (child(node, 'status')?.text || (valOnline ? 'VALORANT' : 'Riot client')).slice(0, 200),
    ...(cardId ? { card: catalogItem(catalog, cardId, 'card') } : {}),
    ...(titleId ? { title: catalogItem(catalog, titleId, 'title') } : {}),
    ...(valOnline
      ? {
          tier: nullableNumber(data.competitiveTier) ?? undefined,
          level: hideLevel ? null : nullableNumber(data.accountLevel),
          hideLevel,
        }
      : {}),
  };
}
export function presencePriority(state: Friend['presence']): number {
  return { in_game: 6, agent_select: 5, queue: 4, online: 3, away: 2, offline: 0 }[state];
}
