import { object, text } from './validation';
const stateName = (value: unknown) => text(value).trim().replace(/[_ -]/g, '').toUpperCase();

export function presenceFields(raw: unknown) {
  const root = object(raw);
  return {
    root,
    player: { ...root, ...object(root.playerPresenceData) },
    match: { ...root, ...object(root.matchPresenceData) },
    party: { ...root, ...object(root.partyPresenceData) },
  };
}

export function valorantActivity(raw: unknown) {
  const { match, party } = presenceFields(raw),
    own = stateName(match.sessionLoopState);
  const leader = party.isPartyOwner === true;
  const fallback = leader ? stateName(party.partyOwnerSessionLoopState) : '';
  const loop = ['INGAME', 'PREGAME', 'MENUS'].includes(own) ? own : fallback;
  const queue = text(match.queueId).toLowerCase() || text(party.queueId).toLowerCase() || undefined;
  const mapId = text(match.matchMap) || (leader ? text(party.partyOwnerMatchMap) : '');
  const presence =
    loop === 'INGAME'
      ? 'in_game'
      : loop === 'PREGAME'
        ? 'agent_select'
        : stateName(party.partyState) === 'MATCHMAKING'
          ? 'queue'
          : 'online';
  return {
    presence: presence as 'in_game' | 'agent_select' | 'queue' | 'online',
    queue,
    mapId,
    activity: loop === 'MENUS' ? 'In menus' : !loop ? 'Online' : undefined,
  };
}
