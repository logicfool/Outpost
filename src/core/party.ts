import { catalogItem } from './catalog';
import { tierMeta } from './rank';
import type { Catalog } from './types';
import type {
  Party,
  PartyAccessibility,
  PartyCustomGame,
  PartyMember,
  PartyPing,
  PartyRequest,
} from './partyTypes';
import {
  AppError,
  array,
  nullableNumber,
  number,
  object,
  text,
  timestamp,
  uuid,
} from './validation';

const QUEUE_ID = /^[a-z0-9]{2}[a-z0-9-]{0,30}$/;

const INVITE_CODE = /^[a-z0-9]{4,16}$/i;

export function validateQueueId(value: unknown): string {
  const id = text(value).trim().toLowerCase();
  if (!QUEUE_ID.test(id)) throw new AppError('QUEUE_INVALID', 'Select a queue from the list.');
  return id;
}
export function validateInviteCode(value: unknown): string {
  const code = text(value).trim();
  if (!INVITE_CODE.test(code))
    throw new AppError('CODE_INVALID', 'Party codes are 4 to 16 letters and digits.');
  return code.toLowerCase();
}

export function validateRiotId(name: unknown, tag: unknown): { name: string; tag: string } {
  const gameName = text(name).trim(),
    tagLine = text(tag).trim().replace(/^#/, '');
  if (gameName.length < 3 || gameName.length > 16 || /[\x00-\x1f#/\\?]/.test(gameName))
    throw new AppError('RIOT_ID_INVALID', 'Enter a Riot ID between 3 and 16 characters.');
  if (tagLine.length < 3 || tagLine.length > 5 || !/^[a-z0-9]+$/i.test(tagLine))
    throw new AppError('RIOT_ID_INVALID', 'Enter the tag after the # sign, for example 1234.');
  return { name: gameName, tag: tagLine };
}

function pings(raw: unknown): PartyPing[] {
  return array(raw)
    .map(object)
    .map((p) => ({ gamePodId: text(p.GamePodID), ping: number(p.Ping, -1) }))
    .filter((p) => !!p.gamePodId && p.ping >= 0 && p.ping < 100000)
    .slice(0, 40);
}

function member(raw: unknown, self: string, owner: string, catalog: Catalog): PartyMember {
  const p = object(raw),
    identity = object(p.PlayerIdentity),
    subject = uuid(p.Subject ?? identity.Subject);
  const isSelf = subject === self;
  const hidden = identity.Incognito === true && !isSelf,
    hideLevel = identity.HideAccountLevel === true && !isSelf;
  const tier = nullableNumber(p.CompetitiveTier),
    meta = tierMeta(catalog, tier);
  const remaining = nullableNumber(p.QueueEligibleRemainingAccountLevels);
  return {
    subject,
    self: isSelf,
    owner: subject === owner,
    name: hidden ? 'Hidden player' : text(p.GameName, isSelf ? 'You' : 'Player'),
    tag: hidden ? '' : text(p.TagLine),
    ready: p.IsReady === true,
    moderator: p.IsModerator === true,
    hidden,
    level: hideLevel ? null : nullableNumber(identity.AccountLevel),
    card: text(identity.PlayerCardID)
      ? catalogItem(catalog, text(identity.PlayerCardID), 'card')
      : undefined,
    title: text(identity.PlayerTitleID)
      ? catalogItem(catalog, text(identity.PlayerTitleID), 'title')
      : undefined,
    tier,
    tierName: tier !== null ? meta.name : undefined,
    tierImage: meta.image,
    platform: text(object(p.PlatformType).Type) || text(p.PlatformType) || undefined,
    pings: pings(p.Pings),
    ...(remaining !== null && remaining > 0 ? { queueEligibleRemainingLevels: remaining } : {}),
  };
}

function requests(raw: unknown): PartyRequest[] {
  return array(raw)
    .map(object)
    .flatMap((r) => {
      const subjects = array(r.Subjects)
        .map((v) => text(v))
        .filter(Boolean);
      const subject = text(r.Subject) || subjects[0] || '';
      if (!subject) return [];
      try {
        return [
          {
            id: text(r.ID) || uuid(subject),
            subject: uuid(subject),
            createdAt: timestamp(r.CreatedAt),
            expiresAt: timestamp(r.ExpiresIn ?? r.ExpiresAt),
          },
        ];
      } catch {
        return [];
      }
    })
    .slice(0, 20);
}

function customGame(raw: unknown, catalog: Catalog): PartyCustomGame | undefined {
  const data = object(raw),
    settings = object(data.Settings),
    membership = object(data.Membership);
  const mapUrl = text(settings.Map);
  if (!mapUrl && !text(settings.Mode)) return undefined;
  return {
    mapId: mapUrl || undefined,
    map: catalog.maps[mapUrl]?.name,
    mode:
      text(settings.Mode)
        .split('/')
        .pop()
        ?.replace(/_?GameMode.*$/i, '') || undefined,
    useBots: settings.UseBots === true,
    teamOne: array(membership.teamOne).length,
    teamTwo: array(membership.teamTwo).length,
    spectators: array(membership.teamSpectate).length,
    coaches: array(membership.coaches).length,
  };
}

export function normalizePartyPlayer(
  raw: unknown,
  self: string,
): { partyId: string; version?: number } {
  const r = object(raw);
  const id = text(r.CurrentPartyID) || text(r.PartyID);
  if (!id)
    throw new AppError('PARTY_ABSENT', 'No party is open. Start VALORANT on your computer first.');
  if (text(r.Subject) && uuid(r.Subject) !== uuid(self))
    throw new AppError('ACCOUNT_MISMATCH', 'Riot returned a party for a different account.');
  return { partyId: uuid(id), version: nullableNumber(r.Version) ?? undefined };
}

export function normalizeParty(
  raw: unknown,
  expectedId: string,
  self: string,
  catalog: Catalog,
  now = Date.now(),
): Party {
  const r = object(raw),
    id = text(r.ID);
  if (id && uuid(id) !== uuid(expectedId))
    throw new AppError('PARTY_SCOPE', 'Your party changed. Refresh to try again.');
  if (!Array.isArray(r.Members))
    throw new AppError('SCHEMA', 'Riot did not return the party roster.');
  const rawMembers = r.Members.map(object);
  const reported =
    text(r.PartyOwnerID) || text(object(rawMembers.find((m) => m.IsOwner === true)).Subject);
  let owner: string | undefined;
  try {
    owner = reported ? uuid(reported) : undefined;
  } catch {
    owner = undefined;
  }
  const members = rawMembers.map((value) => member(value, uuid(self), owner ?? '', catalog));
  if (!members.some((m) => m.self))
    throw new AppError('ACCOUNT_MISMATCH', 'This party does not contain your account.');
  const matchmaking = object(r.MatchmakingData);
  const accessibility: PartyAccessibility =
    text(r.Accessibility).toUpperCase() === 'OPEN' ? 'OPEN' : 'CLOSED';
  const state = text(r.State, 'DEFAULT');
  const queueId = text(matchmaking.QueueID).toLowerCase() || undefined;
  return {
    id: uuid(expectedId),
    version: nullableNumber(r.Version) ?? undefined,
    state,
    previousState: text(r.PreviousState) || undefined,
    stateReason: text(r.StateTransitionReason) || undefined,
    accessibility,
    queueId,
    eligibleQueues: [
      ...new Set(
        array(r.EligibleQueues)
          .map((v) => text(v).toLowerCase())
          .filter((v) => QUEUE_ID.test(v)),
      ),
    ].slice(0, 40),
    ineligibleQueues: array(r.QueueIneligibilities)
      .map(object)
      .flatMap((v) => {
        const queue = text(v.QueueID ?? v).toLowerCase();
        return QUEUE_ID.test(queue)
          ? [{ queueId: queue, reason: text(v.Reason) || undefined }]
          : [];
      })
      .slice(0, 40),
    members,
    maxSize:
      nullableNumber(r.MaxPartySize) ??
      nullableNumber(object(r.CustomGameData).MaxPartySize) ??
      undefined,
    leaderId: owner,
    selfIsLeader: owner !== undefined && owner === uuid(self),
    inviteCode: text(r.InviteCode) || undefined,
    requests: requests(r.Requests),
    preferredGamePods: array(matchmaking.PreferredGamePods)
      .map((v) => text(v))
      .filter(Boolean)
      .slice(0, 20),
    skillDisparityPenalty: nullableNumber(matchmaking.SkillDisparityRRPenalty) ?? undefined,
    queueEntryAt: timestamp(r.QueueEntryTime),
    inQueue: state.toUpperCase() === 'MATCHMAKING',
    customGame: customGame(r.CustomGameData, catalog),
    observedAt: now,
  };
}

export function assertLeader(party: Party, action: string): void {
  if (!party.selfIsLeader)
    throw new AppError('PARTY_NOT_LEADER', `Only the party leader can ${action}.`);
}
export function assertQueueSelectable(party: Party, queueId: string): string {
  const id = validateQueueId(queueId);
  if (party.ineligibleQueues.some((q) => q.queueId === id))
    throw new AppError('QUEUE_INELIGIBLE', 'Your party cannot enter this queue yet.');
  if (party.eligibleQueues.length && !party.eligibleQueues.includes(id))
    throw new AppError('QUEUE_INELIGIBLE', 'Riot did not list this queue for your party.');
  return id;
}
export function assertQueueReady(party: Party): void {
  assertLeader(party, 'start the queue');
  if (party.inQueue) throw new AppError('QUEUE_ALREADY', 'Your party is already in the queue.');
  if (!party.queueId) throw new AppError('QUEUE_MISSING', 'Choose a queue first.');
  const waiting = party.members.filter((m) => !m.ready && !m.owner);
  if (waiting.length)
    throw new AppError(
      'QUEUE_NOT_READY',
      `${waiting.length === 1 ? waiting[0]!.name + ' is' : `${waiting.length} members are`} not ready yet.`,
    );
}
export function assertInQueue(party: Party): void {
  assertLeader(party, 'stop the queue');
  if (!party.inQueue) throw new AppError('QUEUE_IDLE', 'Your party is not in the queue.');
}
export function assertRemovable(party: Party, subject: string): string {
  const id = uuid(subject);
  assertLeader(party, 'remove a member');
  if (id === party.leaderId)
    throw new AppError('PARTY_SELF_REMOVE', 'The leader cannot be removed from the party.');
  if (!party.members.some((m) => m.subject === id))
    throw new AppError('PARTY_MEMBER_MISSING', 'That player already left the party.');
  return id;
}
export function assertRequest(party: Party, requestId: string): string {
  assertLeader(party, 'answer join requests');
  const request = party.requests.find((r) => r.id === requestId);
  if (!request)
    throw new AppError('PARTY_REQUEST_MISSING', 'That join request is no longer pending.');
  return request.id;
}
