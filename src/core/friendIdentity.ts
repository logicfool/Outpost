import type { Friend } from './chatTypes';
import type { PlayerRef } from './playerTypes';
import { mergePlayerIdentity } from './playerNames';
export const FRIEND_IDENTITY_TTL = 24 * 60 * 60 * 1000;

export function mergeFriendIdentity(
  old: Friend | undefined,
  next: Friend,
  now = Date.now(),
): Friend {
  if (old && old.subject !== next.subject) old = undefined;
  const identity = mergePlayerIdentity(old, next);
  const hasCard = next.card?.kind === 'card';
  return {
    ...next,
    ...identity,
    presence: next.presence,
    progress: next.progress,
    matchId: next.matchId,
    game: next.game,
    activity: next.activity,
    presenceSource: next.presenceSource,
    cardObservedAt: hasCard ? (next.cardObservedAt ?? next.updatedAt ?? now) : old?.cardObservedAt,
    cardSource: hasCard ? (next.cardSource ?? 'presence') : old?.cardSource,
    identityCheckedAt:
      Math.max(next.identityCheckedAt ?? 0, old?.identityCheckedAt ?? 0) || undefined,
  };
}
export function storedFriend(next: Friend, old?: Friend, now = Date.now()): Friend {
  const f = mergeFriendIdentity(old, next, now);
  return {
    subject: f.subject,
    jid: f.jid,
    name: f.name,
    tag: f.tag,
    card: f.card,
    title: f.title,
    level: f.level,
    hideLevel: f.hideLevel,
    hidden: f.hidden,
    tier: f.tier,
    presence: 'offline',
    cardObservedAt: f.cardObservedAt,
    cardSource: f.cardSource,
    identityCheckedAt: f.identityCheckedAt,
  };
}
export function withCachedFriends(live: Friend[], saved: Friend[], now = Date.now()): Friend[] {
  const byId = new Map(saved.map((f) => [f.subject, f]));
  return live.map((f) => mergeFriendIdentity(byId.get(f.subject), f, now));
}
export function friendIdentityDue(friend: Friend, now = Date.now()): boolean {
  const at = Math.max(friend.cardObservedAt ?? 0, friend.identityCheckedAt ?? 0);
  return !friend.hidden && (!at || at + FRIEND_IDENTITY_TTL <= now);
}
export function observedFriend(
  old: Friend,
  player: PlayerRef | undefined,
  at: number,
  now = Date.now(),
): Friend {
  const canReplace =
    player?.subject === old.subject &&
    !player.hidden &&
    player.card &&
    at >= (old.cardObservedAt ?? 0);
  return storedFriend(
    {
      ...old,
      ...(canReplace ? { ...player, cardObservedAt: at, cardSource: 'match' as const } : {}),
      identityCheckedAt: now,
    },
    old,
    now,
  );
}
