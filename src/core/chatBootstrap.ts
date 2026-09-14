import type { ChatBootstrap } from './chatTypes';
import type { Session } from './types';
import { decodeJwtClaimsUnverified } from './auth';
import { AppError, number, object, text, token, uuid } from './validation';

export function parseChatBootstrap(
  session: Session,
  pasRaw: unknown,
  configRaw: unknown,
  now = Date.now(),
): ChatBootstrap {
  let value = text(pasRaw).trim();

  if (value.startsWith('"')) {
    try {
      value = JSON.parse(value);
    } catch {
      throw new AppError('CHAT_AUTH', 'Riot returned an invalid chat token.');
    }
  }
  const pasToken = token(value),
    claims = decodeJwtClaimsUnverified(pasToken),
    config = object(configRaw);
  if (uuid(claims.sub) !== session.account.puuid)
    throw new AppError('ACCOUNT_MISMATCH', 'The chat token belongs to another account.');
  const affinity = text(claims.affinity);
  if (!/^[a-z0-9-]{1,24}$/.test(affinity))
    throw new AppError('CHAT_CONFIG', 'Riot did not return a supported chat affinity.');
  const host = text(object(config['chat.affinities'])[affinity]).toLowerCase();
  const domain = text(object(config['chat.affinity_domains'])[affinity]).toLowerCase();
  const port = number(config['chat.port']);
  if (
    !/^[a-z0-9-]+\.chat\.si\.riotgames\.com$/.test(host) ||
    !/^[a-z0-9-]+\.pvp\.net$/.test(domain) ||
    port !== 5223
  ) {
    throw new AppError(
      'CHAT_CONFIG',
      'Riot chat routing changed. No credentials were sent to the socket.',
    );
  }
  const expiresAt = Math.min(session.account.expiresAt, number(claims.exp) * 1000);
  if (expiresAt < now + 30000)
    throw new AppError('SESSION_EXPIRED', 'The chat session has expired. Reconnect to renew it.');
  return {
    subject: session.account.puuid,
    host,
    domain,
    port,
    expiresAt,
    pasToken,
    accessToken: session.accessToken,
    entitlementsToken: session.entitlementsToken,
  };
}
