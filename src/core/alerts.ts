import type { Store, Settings } from './types';
import type { ChatMessage } from './chatTypes';
import { uuid } from './validation';
export interface WishlistAlert {
  key: string;
  source: 'daily' | 'night' | 'bundle';
  itemId: string;
  name: string;
  expiresAt: number;
}
export function wishlistAlerts(store: Store, wishes: string[], now = Date.now()): WishlistAlert[] {
  const wanted = new Set(wishes.map((v) => v.toLowerCase())),
    seen = new Set<string>(),
    out: WishlistAlert[] = [];
  const add = (
    source: WishlistAlert['source'],
    offers: Store['daily'],
    expiry: number,
    group = '',
  ) => {
    const local = expiry - (Number.isFinite(store.clockOffsetMs) ? store.clockOffsetMs : 0);
    if (!Number.isFinite(local) || local <= now) return;
    for (const offer of offers) {
      const id = offer.item.canonicalId.toLowerCase();
      if (!wanted.has(id) && !wanted.has(offer.item.id.toLowerCase())) continue;
      const key = `${source}:${group}:${id}:${Math.round(local / 60000)}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ key, source, itemId: id, name: offer.item.name, expiresAt: local });
      }
    }
  };
  add('daily', store.daily, store.dailyExpiresAt);
  if (store.nightMarket) add('night', store.nightMarket.offers, store.nightMarket.expiresAt);
  for (const bundle of store.bundles) add('bundle', bundle.offers, bundle.expiresAt, bundle.id);
  return out;
}
export function chatAlertEligible(
  message: ChatMessage,
  own: string,
  openPeer: string | undefined,
  foreground: boolean,
  prefs: Settings,
  now = Date.now(),
): boolean {
  return (
    prefs.chatAlerts === true &&
    message.subject !== own &&
    message.direction === 'incoming' &&
    message.state === 'received' &&
    ['live', 'riot-client'].includes(message.source ?? '') &&
    !message.serverStored &&
    message.at <= now + 30000 &&
    now - message.at <= 120000 &&
    !(foreground && openPeer === message.subject)
  );
}
export function alertTarget(
  data: unknown,
): { kind: 'chat' | 'wishlist' | 'reset'; accountId: string; peer?: string } | undefined {
  try {
    const d = data as Record<string, unknown>;
    if (!d || !['chat', 'wishlist', 'reset'].includes(String(d.kind))) return;
    return {
      kind: d.kind as 'chat' | 'wishlist' | 'reset',
      accountId: uuid(d.accountId),
      ...(d.kind === 'chat' ? { peer: uuid(d.peer) } : {}),
    };
  } catch {
    return;
  }
}
