import { diagnosticFetcher } from '../core/detailedDiagnostics';
import { fetch as expoFetch } from 'expo/fetch';
import type { Fetcher } from '../core/http';

export const nativeFetcher: Fetcher = diagnosticFetcher(
  (url, init) => expoFetch(url, init) as unknown as Promise<Response>,
);
