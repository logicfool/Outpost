import type { IdentityEdit } from './playerTypes';
import { AppError, object, requiredArray, text, uuid } from './validation';

export function prepareIdentityEdit(
  raw: unknown,
  edit: IdentityEdit,
  cards: Set<string>,
  titles: Set<string>,
) {
  const current = object(raw),
    identity = object(current.Identity);
  requiredArray(current.Guns, 'weapon loadout');
  if (!Array.isArray(current.ActiveExpressions) && !Array.isArray(current.Sprays))
    throw new AppError(
      'SCHEMA',
      'The current expression loadout is incomplete. No changes were sent.',
    );
  if (current.ActiveExpressions !== undefined)
    requiredArray(current.ActiveExpressions, 'expression loadout');
  if (current.Sprays !== undefined) requiredArray(current.Sprays, 'spray loadout');
  if (
    !text(identity.PlayerCardID) ||
    !text(identity.PlayerTitleID) ||
    typeof current.Incognito !== 'boolean'
  )
    throw new AppError('SCHEMA', 'The current loadout is incomplete. No changes were sent.');
  if (!edit.cardId && !edit.titleId)
    throw new AppError('NO_CHANGE', 'Select a card or title first.');
  if (edit.expectedVersion === undefined && !edit.expectedCardId && !edit.expectedTitleId)
    throw new AppError('LOADOUT_CONFLICT', 'Refresh the equipped identity before changing it.');
  if (
    (edit.expectedVersion !== undefined && current.Version !== edit.expectedVersion) ||
    (edit.expectedCardId &&
      text(identity.PlayerCardID).toLowerCase() !== uuid(edit.expectedCardId)) ||
    (edit.expectedTitleId &&
      text(identity.PlayerTitleID).toLowerCase() !== uuid(edit.expectedTitleId))
  )
    throw new AppError(
      'LOADOUT_CONFLICT',
      'Your loadout changed in another client. Refresh before saving.',
    );
  const updated = { ...identity };
  if (edit.cardId) {
    const id = uuid(edit.cardId);
    if (id !== text(identity.PlayerCardID).toLowerCase() && !cards.has(id))
      throw new AppError('ITEM_NOT_OWNED', 'This card is not in your collection.');
    updated.PlayerCardID = id;
  }
  if (edit.titleId) {
    const id = uuid(edit.titleId);
    if (id !== text(identity.PlayerTitleID).toLowerCase() && !titles.has(id))
      throw new AppError('ITEM_NOT_OWNED', 'This title is not in your collection.');
    updated.PlayerTitleID = id;
  }
  return {
    Guns: current.Guns,
    ...(current.ActiveExpressions !== undefined
      ? { ActiveExpressions: current.ActiveExpressions }
      : {}),
    ...(current.Sprays !== undefined ? { Sprays: current.Sprays } : {}),
    Identity: updated,
    Incognito: current.Incognito,
  };
}
export function verifyIdentity(raw: unknown, body: ReturnType<typeof prepareIdentityEdit>) {
  const identity = object(object(raw).Identity);
  if (
    identity.PlayerCardID !== body.Identity.PlayerCardID ||
    identity.PlayerTitleID !== body.Identity.PlayerTitleID
  )
    throw new AppError(
      'SAVE_UNCONFIRMED',
      'Riot has not confirmed this change. Refresh before trying again.',
    );
}
