import type { Catalog, LiveGame } from './types';
import type { LiveEquipment, LiveWeapon } from './matchTypes';
import { catalogItem } from './catalog';
import { AppError, array, object, text, uuid } from './validation';

export function normalizeLiveEquipment(
  raw: unknown,
  game: LiveGame,
  self: string,
  catalog: Catalog,
  now = Date.now(),
): LiveEquipment {
  if (
    !game.matchId ||
    !['in_game', 'agent_select'].includes(game.state) ||
    !game.players?.some((p) => p.subject === self)
  )
    throw new AppError('MATCH_SCOPE', 'Open your current match to view equipped skins.');
  const root = object(raw);
  if (root.MatchID && uuid(root.MatchID) !== uuid(game.matchId))
    throw new AppError('MATCH_SCOPE', 'The match changed. Open the current roster again.');
  if (!Array.isArray(root.Loadouts))
    throw new AppError('SCHEMA', 'Riot did not return match cosmetics.');
  const allowed = new Set(
    game.players.filter((p) => !p.hidden || p.subject === self).map((p) => p.subject),
  );
  const result = new Map<string, LiveWeapon[]>();
  for (const entry of root.Loadouts.slice(0, 64)) {
    const row = object(entry),
      loadout = object(row.Loadout ?? row),
      subject = text(loadout.Subject).toLowerCase();
    if (!allowed.has(subject)) continue;
    const weapons = new Map<string, LiveWeapon>();
    for (const [key, value] of Object.entries(object(loadout.Items)).slice(0, 64)) {
      const item = object(value),
        weaponId = text(item.ID, key).toLowerCase();
      const meta = catalog.weapons?.[weaponId];
      const attachments = Object.values(object(item.Sockets))
        .slice(0, 32)
        .map((s) => object(object(s).Item));
      const parts = attachments.map((p) => ({
        id: text(p.ID).toLowerCase(),
        item: catalogItem(catalog, text(p.ID)),
      }));
      const skin = parts.find((p) => p.item.kind === 'skin' && p.item.weaponId === weaponId);
      const chroma = parts.find(
        (p) =>
          p.item.kind === 'chroma' &&
          p.item.weaponId === weaponId &&
          (!skin || p.item.canonicalId === skin.item.canonicalId),
      );
      if (!meta && !skin && !chroma) continue;
      const buddy = parts.find((p) => p.item.kind === 'buddy');
      weapons.set(weaponId, {
        weaponId,
        weapon: meta?.name ?? skin?.item.weapon ?? chroma?.item.weapon ?? 'Weapon',
        skin: chroma?.item ?? skin?.item,
        levelId: skin?.id,
        chromaId: chroma?.id,
        buddy: buddy?.item,
      });
    }

    for (const value of array(loadout.Guns).slice(0, 64)) {
      const g = object(value),
        weaponId = text(g.ID).toLowerCase(),
        meta = catalog.weapons?.[weaponId];
      const level = catalogItem(catalog, text(g.SkinLevelID) || text(g.SkinID), 'skin'),
        chroma = catalogItem(catalog, text(g.ChromaID), 'chroma');
      const skin =
        chroma.weaponId === weaponId && chroma.canonicalId === level.canonicalId
          ? chroma
          : level.weaponId === weaponId
            ? level
            : undefined;
      if (!meta && !skin) continue;
      weapons.set(weaponId, {
        weaponId,
        weapon: meta?.name ?? skin?.weapon ?? 'Weapon',
        skin,
        levelId: text(g.SkinLevelID) || undefined,
        chromaId: text(g.ChromaID) || undefined,
        buddy: text(g.CharmID) ? catalogItem(catalog, text(g.CharmID), 'buddy') : undefined,
      });
    }
    result.set(
      subject,
      [...weapons.values()].sort((a, b) => a.weapon.localeCompare(b.weapon)),
    );
  }
  return {
    matchId: game.matchId,
    observedAt: now,
    players: [...result].map(([subject, weapons]) => ({ subject, weapons })),
  };
}
