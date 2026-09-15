import type { PlayerRef } from './playerTypes';
import { array, object, text } from './validation';

export function hasPlayerName(value: string | undefined): boolean {
  return (
    !!value?.trim() &&
    !['player', 'you', 'friend', 'hidden player', 'name unavailable'].includes(
      value.trim().toLowerCase(),
    )
  );
}
export function mergePlayerIdentity(old: PlayerRef | undefined, next: PlayerRef): PlayerRef {
  if (next.hidden) return { ...next, name: 'Hidden player', tag: '' };
  return {
    ...old,
    ...next,
    name: hasPlayerName(next.name) ? next.name : hasPlayerName(old?.name) ? old!.name : next.name,
    tag: next.tag || old?.tag || '',
    card: next.card ?? old?.card,
    title: next.title ?? old?.title,
    level: next.hideLevel ? null : (next.level ?? old?.level),
  };
}
export function nameAliases(
  raw: unknown,
  requested: string[],
): Map<string, { name: string; tag: string }> {
  const wanted = new Set(requested.map((id) => id.toLowerCase()));
  const aliases = new Map<string, { name: string; tag: string }>();
  for (const row of array(raw).map(object)) {
    const id = text(row.Subject).toLowerCase(),
      name = text(row.GameName).trim(),
      tag = text(row.TagLine).trim();
    if (wanted.has(id) && hasPlayerName(name)) aliases.set(id, { name, tag });
  }
  return aliases;
}
export function playerLabel(player: PlayerRef, ownId?: string): string {
  return player.subject === ownId
    ? 'You'
    : player.hidden
      ? 'Hidden player'
      : hasPlayerName(player.name)
        ? player.name
        : 'Name unavailable';
}
