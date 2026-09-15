import { AppError, array, object, text, uuid } from './validation';

export function ownedItemIds(raw: unknown, type: string): Set<string> {
  type = uuid(type);
  const root = object(raw);
  let entries: unknown[];
  if (Array.isArray(root.EntitlementsByTypes)) {
    if (!root.EntitlementsByTypes.length) return new Set();
    const groups = root.EntitlementsByTypes.map(object);
    for (const group of groups) {
      uuid(group.ItemTypeID);
      if (!Array.isArray(group.Entitlements))
        throw new AppError('SCHEMA', 'Ownership details are incomplete. No purchase was sent.');
    }
    const matching = groups.filter((group) => text(group.ItemTypeID).toLowerCase() === type);
    if (!matching.length)
      throw new AppError(
        'SCHEMA',
        'Riot returned another inventory category. No purchase was sent.',
      );
    entries = matching.flatMap((group) => array(group.Entitlements));
  } else if (Array.isArray(root.Entitlements)) {
    if (root.ItemTypeID !== undefined && uuid(root.ItemTypeID) !== type)
      throw new AppError('SCHEMA', 'Riot returned another inventory category.');
    entries = root.Entitlements;
  } else throw new AppError('SCHEMA', 'Ownership could not be verified. No purchase was sent.');
  return new Set(entries.map((item) => uuid(object(item).ItemID)));
}
