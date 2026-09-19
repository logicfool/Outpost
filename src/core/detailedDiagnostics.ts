import { Buffer } from 'buffer';
import { DiagnosticRedactor, TRACE_BODY_LIMIT } from './diagnosticRedaction';
export const DIAGNOSTIC_LIMITS = {
  bodyBytes: TRACE_BODY_LIMIT,
  recordBytes: 6 * 1024 * 1024,
  totalBytes: 16 * 1024 * 1024,
  records: 300,
  minutes: 20,
};
type Entry = { id: number; at: number; kind: string; data: unknown; size: number };
let requestSequence = 0;
let active = false,
  startedAt = 0,
  expiresAt = 0,
  stoppedAt = 0,
  sequence = 0,
  generation = 0,
  dropped = 0,
  failures = 0,
  totalBytes = 0;
let redactor = new DiagnosticRedactor();
let entries: Entry[] = [];
const listeners = new Set<() => void>();
function emit() {
  for (const listener of listeners)
    try {
      listener();
    } catch {}
}
export function diagnosticCaptureStatus() {
  if (active && Date.now() >= expiresAt) {
    active = false;
    stoppedAt = Date.now();
  }
  return {
    active,
    startedAt,
    expiresAt,
    stoppedAt,
    count: entries.length,
    bytes: totalBytes,
    droppedRecords: dropped,
    captureFailures: failures,
    generation,
  };
}
export function subscribeDiagnostics(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function startDetailedDiagnostics() {
  generation++;
  active = true;
  startedAt = Date.now();
  expiresAt = startedAt + DIAGNOSTIC_LIMITS.minutes * 60000;
  stoppedAt = 0;
  entries = [];
  redactor = new DiagnosticRedactor();
  totalBytes = 0;
  dropped = 0;
  failures = 0;
  emit();
}
export function stopDetailedDiagnostics() {
  active = false;
  stoppedAt = Date.now();
  emit();
}
export function clearDetailedDiagnostics() {
  stopDetailedDiagnostics();
  generation++;
  entries = [];
  totalBytes = 0;
  redactor = new DiagnosticRedactor();
  dropped = 0;
  failures = 0;
  emit();
}
export function detailedDiagnosticEvent(kind: string, data: unknown): void {
  if (!diagnosticCaptureStatus().active) return;
  try {
    append(kind, redactor.value(data));
  } catch {
    failures++;
    emit();
  }
}
function append(kind: string, data: unknown): number {
  const encoded = JSON.stringify(data),
    size = Buffer.byteLength(encoded, 'utf8');
  if (size > DIAGNOSTIC_LIMITS.recordBytes) {
    dropped++;
    return 0;
  }
  while (
    entries.length &&
    (entries.length >= DIAGNOSTIC_LIMITS.records ||
      totalBytes + size > DIAGNOSTIC_LIMITS.totalBytes)
  ) {
    totalBytes -= entries.shift()!.size;
    dropped++;
  }
  const id = ++sequence;
  entries.push({ id, at: Date.now(), kind, data, size });
  totalBytes += size;
  emit();
  return id;
}
const pending = new Set<Promise<void>>();
async function readTraceBody(response: Response): Promise<string> {
  const length = Number(response.headers.get('content-length'));
  if (length > TRACE_BODY_LIMIT) throw new Error('Body exceeds 2 MiB limit.');
  if (!response.body && [204, 205, 304].includes(response.status)) return '';
  if (!response.body?.getReader)
    throw new Error('A streaming body is not exposed by this transport.');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let size = 0;
  const chunks: string[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Diagnostic body read timed out.')), 15000);
  });
  try {
    for (;;) {
      const result = await Promise.race([reader.read(), timeout]);
      if (result.done) break;
      size += result.value.byteLength;
      if (size > TRACE_BODY_LIMIT) throw new Error('Body exceeds 2 MiB limit.');
      chunks.push(decoder.decode(result.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function diagnosticFetcher(fetcher: (url: string, init: RequestInit) => Promise<Response>) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    if (!diagnosticCaptureStatus().active) return fetcher(url, init);
    const g = generation,
      scrub = redactor,
      begin = Date.now(),
      requestId = `http-${generation}-${++requestSequence}`;
    let request: unknown;
    const keep = (kind: string, data: unknown) => {
      if (g !== generation) return;
      try {
        append(kind, scrub.value({ requestId, ...(data as Record<string, unknown>) }));
      } catch {
        failures++;
      }
    };
    try {
      const headers = scrub.headers(init.headers ?? {});
      request = scrub.value({
        requestId,
        url: scrub.url(url),
        method: init.method ?? 'GET',
        headers,
        claims: scrub.tokenClaims(init.headers ?? {}),
        credentialsMode: init.credentials ?? 'same-origin',
        redirect: init.redirect ?? 'follow',
        body:
          typeof init.body === 'string'
            ? scrub.body(init.body, url)
            : init.body
              ? { omitted: 'Non-text request body is not inspected.' }
              : null,
      });
      keep('http-request', { request, startedAt: begin });
    } catch {
      failures++;
      request = { omitted: 'Request capture failed safely.' };
    }
    try {
      const response = await fetcher(url, init),
        receivedAt = Date.now();
      try {
        const info = scrub.value({
          url: scrub.url(response.url || url),
          status: response.status,
          statusText: response.statusText,
          type: response.type,
          redirected: response.redirected,
          headers: scrub.headers(response.headers),
          receivedAt,
          headerDurationMs: receivedAt - begin,
        });
        keep('http-response', { request, response: info, startedAt: begin });
        const mime = response.headers.get('content-type') ?? '';
        if (/^(image|video|audio)\//i.test(mime) || /application\/octet-stream/i.test(mime))
          keep('http-body', {
            request,
            response: info,
            body: {
              omitted: 'Binary media omitted; native image/video requests are not intercepted.',
            },
          });
        else if (Number(response.headers.get('content-length')) > TRACE_BODY_LIMIT)
          keep('http-body', {
            request,
            response: info,
            body: { omitted: 'Body exceeds 2 MiB capture limit.' },
          });
        else if (pending.size >= 8)
          keep('http-body', {
            request,
            response: info,
            body: { omitted: 'Diagnostic reader concurrency limit reached.' },
          });
        else {
          try {
            const copy = response.clone();
            const work = readTraceBody(copy)
              .then(async (body) => {
                if (g !== generation) return;
                const safeBody = await scrub.bodyAsync(body, url);
                if (g !== generation) return;

                try {
                  append('http-body', {
                    requestId,
                    request,
                    response: info,
                    body: safeBody,
                    startedAt: begin,
                    finishedAt: Date.now(),
                    durationMs: Date.now() - begin,
                  });
                } catch {
                  failures++;
                }
              })
              .catch((error) => {
                keep('http-body', {
                  request,
                  response: info,
                  body: { omitted: scrub.text(String(error?.message ?? 'Body unavailable')) },
                  durationMs: Date.now() - begin,
                });
              });
            pending.add(work);
            void work.finally(() => pending.delete(work)).catch(() => {});
          } catch {
            keep('http-body', {
              request,
              response: info,
              body: { omitted: 'This transport cannot clone its response.' },
            });
          }
        }
      } catch {
        failures++;
      }
      return response;
    } catch (error) {
      keep('http-error', {
        request,
        startedAt: begin,
        durationMs: Date.now() - begin,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      throw error;
    }
  };
}
export async function flushDetailedDiagnostics(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled([...pending]),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, 2000);
    }),
  ]);
  clearTimeout(timer);
}
export function detailedDiagnosticReport(context: unknown, summaries: unknown) {
  const status = diagnosticCaptureStatus();
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    capture: { ...status, pendingBodyReads: pending.size, limits: DIAGNOSTIC_LIMITS },
    coverage: {
      requests:
        'Application HTTP transport, parsed XMPP stanzas and app state events captured after opt-in.',
      headers:
        'Request headers supplied by the app and response headers exposed by Expo; automatic wire headers, DNS and TLS internals are not exposed.',
      bodies:
        'Text/JSON plus decoded Ares settings. Credentials redacted before retention; oversize/uninspectable bodies are explicitly marked.',
      notCaptured:
        'Browser password inputs; native image/video bytes; historical traffic before capture. No automatic upload.',
    },
    context: redactor.value(context),
    summaries: redactor.value(summaries),
    events: entries.map(({ size, ...entry }) => ({ ...entry, data: redactor.value(entry.data) })),
  };
}
