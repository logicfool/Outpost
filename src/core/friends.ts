import type { Catalog, CatalogItem } from './types';
import type { Friend, Conversation } from './chatTypes';
import { safeImage } from './validation';
import { queueName } from './normalize';
import { presencePriority } from './chatPresence';

export function squareCardCandidates(card: CatalogItem | undefined, catalog?: Catalog): string[] {
  if (!card) return [];
  const resolved = catalog?.items[card.id.toLowerCase()] ?? card;
  const id = (resolved.canonicalId || resolved.id).toLowerCase();
  const square = (url?: string) =>
    url && /\/(smallart|displayicon)\./i.test(url) ? safeImage(url) : undefined;
  const generated =
    resolved.kind === 'card' && /^[a-f0-9-]{36}$/.test(id)
      ? [
          `https://media.valorant-api.com/playercards/${id}/displayicon.png`,
          `https://media.valorant-api.com/playercards/${id}/smallart.png`,
        ]
      : [];
  return [
    ...new Set(
      [
        square(resolved.image),
        square(resolved.smallArt),
        square(card.image),
        square(card.smallArt),
        ...generated,
      ].filter((v): v is string => !!v),
    ),
  ];
}
export function squareCardArt(
  card: CatalogItem | undefined,
  catalog?: Catalog,
): string | undefined {
  return squareCardCandidates(card, catalog)[0];
}
export function friendStatus(friend: Friend, connected = true): string {
  if (!connected) return 'Last seen · connect for live status';
  if (friend.presence === 'offline') return 'Offline';
  if (friend.presence === 'away') return friend.game ? `Away · ${friend.game}` : 'Away';
  const game = friend.game ?? (friend.presenceSource === 'valorant' ? 'VALORANT' : undefined);
  const action =
    (
      { in_game: 'In game', agent_select: 'Agent select', queue: 'In queue' } as Partial<
        Record<Friend['presence'], string>
      >
    )[friend.presence] ??
    friend.activity ??
    (game === 'VALORANT' ? 'In menus' : game ? 'Online' : 'Riot client');
  const party =
    friend.partySize && friend.partySize > 1
      ? `Party ${friend.partySize}${friend.partyMax ? '/' + friend.partyMax : ''}`
      : undefined;
  return [
    game && game !== 'VALORANT' ? game : undefined,
    action,
    friend.queue && ['in_game', 'agent_select', 'queue'].includes(friend.presence)
      ? queueName(friend.queue)
      : undefined,
    ['in_game', 'agent_select'].includes(friend.presence) ? friend.map : undefined,
    party,
  ]
    .filter(Boolean)
    .join(' · ');
}
export interface FriendSection {
  key: string;
  title: string;
  data: Friend[];
}
export function friendSections(
  live: Friend[],
  saved: Conversation[],
  connected: boolean,
  search = '',
): FriendSection[] {
  const query = search.trim().toLocaleLowerCase();
  const entries = connected
    ? live
    : saved.flatMap((c) => (c.friend ? [{ ...c.friend, presence: 'offline' as const }] : []));
  const groups: FriendSection[] = connected
    ? [
        { key: 'valorant', title: 'VALORANT', data: [] },
        { key: 'other', title: 'RIOT & OTHER GAMES', data: [] },
        { key: 'offline', title: 'OFFLINE', data: [] },
      ]
    : [{ key: 'saved', title: 'SAVED FRIENDS', data: [] }];
  const seen = new Set<string>();
  for (const f of entries) {
    if (seen.has(f.subject) || (query && !`${f.name}#${f.tag}`.toLocaleLowerCase().includes(query)))
      continue;
    seen.add(f.subject);
    const index = !connected
      ? 0
      : f.presence === 'offline'
        ? 2
        : f.presenceSource === 'valorant'
          ? 0
          : 1;
    groups[index]!.data.push(f);
  }
  for (const group of groups)
    group.data.sort(
      (a, b) =>
        presencePriority(b.presence) - presencePriority(a.presence) || a.name.localeCompare(b.name),
    );
  return groups.filter((g) => g.data.length);
}
