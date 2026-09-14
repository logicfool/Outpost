import type { Fetcher } from '../core/http';
export const nativeFetcher: Fetcher = (url, init) => fetch(url, init);
