import { AppError, object, text } from './validation';

export function chatRouting(configRaw: unknown, affinity: string) {
  const config = object(configRaw);
  const host = text(object(config['chat.affinities'])[affinity]).trim().toLowerCase();
  const label = text(object(config['chat.affinity_domains'])[affinity]).trim().toLowerCase();
  if (!host || !label)
    throw new AppError(
      'CHAT_CONFIG_MISSING',
      'Riot did not return chat routing for this account. Refresh the connection.',
    );
  const domain = /^[a-z0-9][a-z0-9-]{0,62}$/.test(label) ? `${label}.pvp.net` : label;
  const rawPort = config['chat.port'];
  const port = rawPort === undefined ? 5223 : rawPort === '5223' ? 5223 : rawPort;
  if (
    !/^[a-z0-9][a-z0-9-]{0,62}\.chat\.si\.riotgames\.com$/.test(host) ||
    !/^[a-z0-9][a-z0-9-]{0,62}\.pvp\.net$/.test(domain) ||
    port !== 5223
  ) {
    throw new AppError(
      'CHAT_CONFIG',
      'Riot returned unsupported chat routing. No credentials were sent to the socket.',
    );
  }
  return { host, domain, port: 5223 };
}
