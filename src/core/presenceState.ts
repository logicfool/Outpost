import { object, text } from './validation';
const stateName = (value: unknown) => text(value).trim().replace(/[_ -]/g, '').toUpperCase();

export function valorantActivity(raw: unknown) {
  const data = object(raw),
    own = stateName(data.sessionLoopState);
  const leader = data.isPartyOwner === true;
  const fallback = leader ? stateName(data.partyOwnerSessionLoopState) : '';
  const loop = ['INGAME', 'PREGAME', 'MENUS'].includes(own) ? own : fallback;
  const queue = text(data.queueId).toLowerCase() || undefined;
  const mapId = text(data.matchMap) || (leader ? text(data.partyOwnerMatchMap) : '');
  const presence =
    loop === 'INGAME'
      ? 'in_game'
      : loop === 'PREGAME'
        ? 'agent_select'
        : stateName(data.partyState) === 'MATCHMAKING'
          ? 'queue'
          : 'online';
  return {
    presence: presence as 'in_game' | 'agent_select' | 'queue' | 'online',
    queue,
    mapId,
    activity: loop === 'MENUS' ? 'In menus' : !loop ? 'Status not reported' : undefined,
  };
}
