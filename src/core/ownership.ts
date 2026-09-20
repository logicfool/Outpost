import { AppError, array, object, text, uuid } from './validation';

function ownedEntries(raw: unknown, type: string): unknown[] {
  type = uuid(type);
  const root = object(raw);
  let entries: unknown[];
  if (Array.isArray(root.EntitlementsByTypes)) {
    if (!root.EntitlementsByTypes.length) return [];
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
  return entries;
}

export function ownedItemIds(raw: unknown, type: string): Set<string> {
  return new Set(ownedEntries(raw, type).map((item) => uuid(object(item).ItemID)));
}

export function ownedQuantities(raw: unknown, type: string): Map<string, number> {
  const result = new Map<string, number>(),
    instances = new Map<string, string>();
  for (const value of ownedEntries(raw, type)) {
    const row = object(value),
      id = uuid(row.ItemID),
      quantity = row.Quantity ?? row.Amount ?? 1;
    if (
      typeof quantity !== 'number' ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > 1000
    )
      throw new AppError('SCHEMA', 'Inventory quantities are incomplete.');
    if (row.InstanceID !== undefined && row.InstanceID !== null) {
      const instance = uuid(row.InstanceID);
      if (instances.has(instance)) {
        if (instances.get(instance) !== id)
          throw new AppError('SCHEMA', 'An inventory instance identifies more than one item.');
        continue;
      }
      instances.set(instance, id);
      result.set(id, (result.get(id) ?? 0) + quantity);
    } else result.set(id, Math.max(result.get(id) ?? 0, quantity));
  }
  return result;
}
