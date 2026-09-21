/** A short, bounded record of actual successful image loads, not network/cache promises. */
const displayed = new Map<string, number>();
const TTL = 5 * 60 * 1000;
const MAX = 256;
export function wasArtworkReady(url: string, now = Date.now()): boolean {
  const until = displayed.get(url);
  if (!until || until <= now) {
    displayed.delete(url);
    return false;
  }
  return true;
}
export function rememberArtwork(url: string, now = Date.now()): void {
  displayed.delete(url);
  displayed.set(url, now + TTL);
  if (displayed.size > MAX) displayed.delete(displayed.keys().next().value!);
}
export function forgetArtwork(url: string): void {
  displayed.delete(url);
}
export function clearArtworkMemory(): void {
  displayed.clear();
}
