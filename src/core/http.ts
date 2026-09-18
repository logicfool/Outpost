import { mimeLabel, recordRequest, serviceLabel } from './diagnostics';
import { AppError } from './validation';
import { purchaseRejection, purchaseHttpError } from './purchaseErrors';
import { parseJsonBody, readBoundedText } from './responseBody';
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
export interface JsonResponse {
  data: unknown;
  serverTime: number;
  receivedAt: number;
  status?: number;
}
export interface RequestPolicy {
  beforeDispatch?(): Promise<void>;
  allowEmptyJson?: boolean;
  purchase?: boolean;
  maxResponseBytes?: number;
}
export class HttpClient {
  private active = 0;
  private queue: (() => void)[] = [];
  private cooldowns = new Map<string, number>();
  constructor(
    private fetcher: Fetcher = (url, init) => fetch(url, init),
    private now: () => number = Date.now,
    private limit = 3,
  ) {}
  private async enter() {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }
  private leave() {
    const next = this.queue.shift();
    if (next) next();
    else this.active--;
  }
  async json(
    url: string,
    init: RequestInit = {},
    policy: RequestPolicy = {},
  ): Promise<JsonResponse> {
    return this.request(url, init, 'json', policy);
  }
  async text(url: string, init: RequestInit = {}): Promise<JsonResponse> {
    return this.request(url, init, 'text');
  }
  private async request(
    url: string,
    init: RequestInit,
    format: 'json' | 'text',
    policy: RequestPolicy = {},
  ): Promise<JsonResponse> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port)
      throw new AppError('NETWORK_POLICY', 'Only trusted HTTPS endpoints are allowed.');
    const started = this.now();
    let status: number | undefined,
      mime: string | undefined,
      shape: string | undefined,
      code = 'OK';
    await this.enter();
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const until = this.cooldowns.get(parsed.origin) ?? 0;
      if (until > this.now())
        throw new AppError(
          'RATE_LIMIT',
          'Riot asked this app to wait before making another request.',
          until,
          429,
        );
      await policy.beforeDispatch?.();

      timeout = setTimeout(() => controller.abort(), 15000);
      let response: Response;
      try {
        response = await this.fetcher(url, {
          ...init,
          credentials: 'omit',
          redirect: 'error',
          signal: controller.signal,
        });
      } catch {
        throw new AppError(
          controller.signal.aborted ? 'TIMEOUT' : 'NETWORK',
          controller.signal.aborted
            ? 'The request timed out. Try again when the connection is stable.'
            : 'The service could not be reached. Check your connection.',
        );
      }
      status = response.status;
      mime = mimeLabel(response.headers.get('content-type') ?? '');
      if (response.redirected || (response.url && new URL(response.url).origin !== parsed.origin))
        throw new AppError('NETWORK_POLICY', 'An unexpected network redirect was blocked.');
      if (!response.ok) {
        if (response.status === 401)
          throw new AppError(
            'SESSION_EXPIRED',
            'Your Riot session expired. Sign in again.',
            undefined,
            401,
          );
        if (response.status === 403)
          throw new AppError(
            'ACCESS_DENIED',
            'Riot denied this request. Reconnect the account; access may be restricted.',
            undefined,
            403,
          );
        if (response.status === 429) {
          const header = response.headers.get('retry-after');
          const seconds =
            header !== null && /^\d+(\.\d+)?$/.test(header.trim()) ? Number(header) * 1000 : NaN;
          const absolute = header ? Date.parse(header) : NaN;
          const retryAt =
            this.now() +
            Math.max(
              1000,
              Number.isFinite(seconds)
                ? seconds
                : Number.isFinite(absolute)
                  ? absolute - this.now()
                  : 60000,
            );
          this.cooldowns.set(parsed.origin, retryAt);
          throw new AppError(
            'RATE_LIMIT',
            'Riot asked this app to wait before making another request.',
            retryAt,
            429,
          );
        }
        if (policy.purchase) {
          let data: unknown;
          try {
            const body = await readBoundedText(response, 65536);
            data = parseJsonBody(body, response.headers.get('content-type') ?? '');
          } catch {}
          throw purchaseRejection(data, response.status) ?? purchaseHttpError(response.status);
        }
        if (response.status === 400) {
          let semanticCode = '';
          try {
            const body = await response.json();
            semanticCode = String(body?.errorCode ?? '');
          } catch {}
          if (semanticCode === 'PLAYER_DOES_NOT_EXIST' || semanticCode === 'RESOURCE_NOT_FOUND')
            throw new AppError('PLAYER_ABSENT', 'No live session was returned.', undefined, 400);
        }
        throw new AppError(
          response.status >= 500 ? 'SERVICE_UNAVAILABLE' : 'ENDPOINT_UNAVAILABLE',
          'This Riot feature is temporarily unavailable or its endpoint has changed.',
          undefined,
          response.status,
        );
      }
      const contentType = response.headers.get('content-type') ?? '';
      let body: string;
      try {
        body = await readBoundedText(
          response,
          Math.min(
            policy.maxResponseBytes ?? (format === 'json' ? 32 * 1024 * 1024 : 32000),
            32 * 1024 * 1024,
          ),
        );
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(
          controller.signal.aborted ? 'TIMEOUT' : 'NETWORK',
          'The response could not be read. Refresh to retry.',
        );
      }
      const data =
        format === 'json'
          ? policy.allowEmptyJson && !body.trim()
            ? null
            : parseJsonBody(body, contentType)
          : body;
      shape = Array.isArray(data) ? 'array' : data === null ? 'null' : typeof data;
      const receivedAt = this.now();
      const date = Date.parse(response.headers.get('date') ?? '');
      return {
        data,
        receivedAt,
        serverTime: Number.isFinite(date) ? date : receivedAt,
        status: response.status,
      };
    } catch (error) {
      code = error instanceof AppError ? error.code : 'UNKNOWN';
      throw error;
    } finally {
      recordRequest({
        at: this.now(),
        service: serviceLabel(url),
        method: init.method ?? 'GET',
        status,
        mime,
        shape,
        code,
        durationMs: Math.max(0, this.now() - started),
      });
      clearTimeout(timeout);
      this.leave();
    }
  }
}
export class SingleFlightCache {
  private pending = new Map<string, Promise<unknown>>();
  private generation = 0;
  private values = new Map<string, { until: number; data: unknown }>();
  constructor(private now: () => number = Date.now) {}
  async get<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const saved = this.values.get(key);
    if (ttlMs > 0 && saved && saved.until > this.now()) return saved.data as T;
    const existing = this.pending.get(key);
    if (existing) return existing as Promise<T>;
    const generation = this.generation;
    const work = loader().then((data) => {
      if (generation !== this.generation) return data;

      if (this.values.size >= 128) this.values.delete(this.values.keys().next().value!);
      this.values.set(key, { data, until: this.now() + ttlMs });
      return data;
    });
    this.pending.set(key, work);
    try {
      return await work;
    } finally {
      if (this.pending.get(key) === work) this.pending.delete(key);
    }
  }
  clear() {
    this.generation++;
    this.values.clear();
    this.pending.clear();
  }
}
