import type { Friend, FriendAction, FriendRequest } from './chatTypes';
import type { PlayerRef } from './playerTypes';
import { AppError, uuid } from './validation';
import { child, parseJid, xmlEscape, type XmlNode } from './xmppXml';
export const FRIEND_ACTION_COOLDOWN = 60_000;
export type RosterEntry =
  | { kind: 'friend'; friend: Friend }
  | { kind: 'request'; request: FriendRequest }
  | { kind: 'remove'; subject: string };

export function rosterEntry(
  item: XmlNode,
  self: string,
  now: number,
  old?: PlayerRef,
): RosterEntry | undefined {
  const jid = parseJid(item.attrs.jid ?? '');
  if (!jid || jid.subject === self) return;
  if (item.attrs.puuid && item.attrs.puuid.toLowerCase() !== jid.subject) return;
  const subscription = item.attrs.subscription ?? 'both';
  if (subscription === 'remove') return { kind: 'remove', subject: jid.subject };
  const identity = child(item, 'id');
  const player = {
    ...old,
    subject: jid.subject,
    jid: jid.bare,
    name: (identity?.attrs.name || item.attrs.name || old?.name || 'Riot player').slice(0, 80),
    tag: (identity?.attrs.tagline || old?.tag || '').slice(0, 32),
  };
  if (subscription === 'pending_in' || subscription === 'pending_out')
    return {
      kind: 'request',
      request: {
        ...player,
        direction: subscription === 'pending_in' ? 'incoming' : 'outgoing',
        updatedAt: now,
      },
    };
  if (subscription === 'both' || subscription === 'to')
    return {
      kind: 'friend',
      friend: { ...player, presence: (old as Friend)?.presence ?? 'offline' },
    };
}
export function friendMutationXml(
  id: string,
  action: FriendAction,
  subject: string,
  request?: FriendRequest,
): string {
  subject = uuid(subject);
  if (action === 'decline') {
    const jid = request && parseJid(request.jid);
    if (!jid || jid.subject !== subject || request?.direction !== 'incoming')
      throw new AppError('FRIEND_REQUEST_CHANGED', 'This incoming request is no longer available.');
    return `<iq type="set" id="${xmlEscape(id)}"><query xmlns="jabber:iq:riotgames:roster"><item jid="${xmlEscape(jid.bare)}" subscription="remove"/></query></iq>`;
  }
  return `<iq type="set" id="${xmlEscape(id)}"><query xmlns="jabber:iq:riotgames:roster"><item puuid="${subject}" subscription="pending_out"/></query></iq>`;
}
export function validFriendTarget(player: PlayerRef, self: string): string {
  const subject = uuid(player.subject);
  if (subject === self) throw new AppError('FRIEND_SELF', 'You cannot add yourself.');
  if (player.hidden)
    throw new AppError('PROFILE_PRIVATE', 'This player has hidden their identity.');
  return subject;
}
