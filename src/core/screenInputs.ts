const sections: Record<string, readonly string[]> = {
  store: ['accountId', 'store', 'wallet', 'nextAutoRefreshAt', 'refreshIssue'],
  collection: ['accountId', 'collection', 'loadout'],
  progress: ['accountId', 'progression', 'xp', 'rank'],
  matches: ['accountId', 'matches', 'rank', 'xp', 'loadout', 'liveGame', 'profileIssue'],
  friends: ['accountId', 'liveGame', 'loadout', 'xp', 'rank'],
};
const equalFields = (a: unknown, b: unknown, keys: readonly string[]) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  return keys.every(
    (key) => (a as Record<string, unknown>)[key] === (b as Record<string, unknown>)[key],
  );
};
/** Exclude unrelated data, not features. A live tick must not rerender the Store catalogue. */
export function sameScreenModel(tab: string, before: object, after: object): boolean {
  const a = before as Record<string, unknown>,
    b = after as Record<string, unknown>;
  if (!equalFields(a, b, ['active', 'catalog', 'settings', 'busy', 'observedIdentity']))
    return false;
  if (tab === 'account' || !sections[tab]) return equalFields(a, b, Object.keys({ ...a, ...b }));
  if (!equalFields(a.snapshot, b.snapshot, sections[tab]!)) return false;
  if (['store', 'collection'].includes(tab) && a.wishlist !== b.wishlist) return false;
  if (tab === 'store' && a.history !== b.history) return false;
  if (tab === 'collection' && !equalFields(a, b, ['aimState', 'aimPresets', 'aimLoading']))
    return false;
  if (tab === 'matches' && !equalFields(a.chat, b.chat, ['status', 'selfPresence', 'friends']))
    return false;
  if (
    tab === 'friends' &&
    !equalFields(a, b, ['chat', 'savedConversations', 'chatHistorySync', 'syncingSavedHistory'])
  )
    return false;
  return true;
}
