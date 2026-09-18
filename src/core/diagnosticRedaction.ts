import { Buffer } from 'buffer';
import { decodeAimDocument, encodeAimDocument } from './aimCodec';
export const REDACTED = '[REDACTED]';
export const TRACE_BODY_LIMIT = 2 * 1024 * 1024;
const normalized = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const secretKeys = new Set([
  'authorization',
  'proxyauthorization',
  'cookie',
  'cookies',
  'setcookie',
  'accesstoken',
  'idtoken',
  'refreshtoken',
  'entitlementstoken',
  'xriotentitlementsjwt',
  'rsotoken',
  'pastoken',
  'token',
  'password',
  'passwd',
  'clientsecret',
  'codeverifier',
  'authorizationcode',
  'authcode',
  'authenticationtoken',
  'credentials',
  'credential',
  'secretkey',
  'jwt',
  'sessionkey',
  'xrsotoken',
  'sessiontoken',
  'sessionid',
  'ssid',
  'csid',
  'clid',
  'tdid',
  'asid',
  'apikey',
  'xapikey',
  'csrf',
  'xsrf',
  'xsrftoken',
  'csrftoken',
  'xcsrftoken',
  'reauthcookies',
  'cookiejar',
  'tokens',
  'secrets',
  'verificationcode',
  'otp',
  'onetimepassword',
  'samlresponse',
  'xamzsignature',
  'xgoogsignature',
]);
const secretKey = (key: string) =>
  secretKeys.has(normalized(key)) ||
  (/(?:password|secret|token)$/.test(normalized(key)) &&
    !['tokentype', 'hasreusabletoken'].includes(normalized(key)));
const authParam = (key: string) =>
  secretKey(key) || ['code', 'state', 'nonce'].includes(key.toLowerCase());
const bytes = (text: string) => Buffer.byteLength(text, 'utf8');

export class DiagnosticRedactor {
  private secrets = new Set<string>();
  private nodes = 0;
  private learning = 0;
  private remember(value: unknown): void {
    if (typeof value !== 'string' || value.length < 4 || value.length > 32768 || value === REDACTED)
      return;
    if (!this.secrets.has(value) && this.secrets.size >= 160)
      this.secrets.delete(this.secrets.values().next().value!);
    this.secrets.add(value);
    const bearer = /^(?:Bearer|Basic)\s+(.+)$/i.exec(value);
    if (bearer?.[1]) this.secrets.add(bearer[1]);
  }
  private learnSecret(value: unknown, depth = 0): void {
    if (depth > 16 || ++this.learning > 80000) return;
    if (typeof value === 'string') {
      this.remember(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 20000)) this.learnSecret(item, depth + 1);
      return;
    }
    if (value && typeof value === 'object')
      for (const [key, item] of Object.entries(value).slice(0, 10000)) {
        if (
          !['sub', 'domain', 'path', 'expires', 'samesite', 'max-age'].includes(key.toLowerCase())
        )
          this.learnSecret(item, depth + 1);
      }
  }
  private replaceKnown(text: string): string {
    for (const value of this.secrets) {
      if (text.includes(value)) text = text.split(value).join(REDACTED);
      const encoded = encodeURIComponent(value);
      if (encoded !== value && text.includes(encoded)) text = text.split(encoded).join(REDACTED);
    }
    return text
      .replace(
        /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/%=-]+/gi,
        (m) => m.split(/\s/)[0] + ' ' + REDACTED,
      )
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED);
  }
  private learn(value: unknown, depth = 0): void {
    if (++this.learning > 80000 || depth > 20 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 20000)) this.learn(item, depth + 1);
      return;
    }
    const record = value as Record<string, unknown>;
    if (
      typeof record.name === 'string' &&
      /^(?:[^:]+:)?(?:auth|rso_token|pas_token|token|password|secret)$/i.test(record.name)
    ) {
      this.learnSecret(record.text, depth + 1);
      this.learnSecret(record.children, depth + 1);
    }
    for (const [key, item] of Object.entries(value).slice(0, 10000))
      if (secretKey(key)) this.learnSecret(item, depth + 1);
      else this.learn(item, depth + 1);
  }
  headers(input: HeadersInit | Headers): Record<string, string> {
    const rows = [...new Headers(input).entries()];
    for (const [key, value] of rows)
      if (secretKey(key)) {
        this.remember(value);
        if (/cookie/i.test(key))
          for (const m of value.matchAll(/(?:^|[;,]\s*)([\w-]+)=([^;,]*)/g))
            if (
              !['domain', 'path', 'expires', 'max-age', 'samesite', 'sub'].includes(
                m[1]!.toLowerCase(),
              )
            )
              this.remember(m[2]);
      }
    return Object.fromEntries(
      rows.map(([key, value]) => [key, secretKey(key) ? REDACTED : this.text(value)]),
    );
  }
  url(value: string): string {
    try {
      const url = new URL(value);
      if (url.username) {
        this.remember(url.username);
        url.username = REDACTED;
      }
      if (url.password) {
        this.remember(url.password);
        url.password = REDACTED;
      }
      const process = (p: URLSearchParams) => {
        for (const key of [...p.keys()])
          if (authParam(key)) {
            for (const v of p.getAll(key)) this.remember(v);
            p.set(key, REDACTED);
          }
      };
      process(url.searchParams);
      if (url.hash.includes('=')) {
        const params = new URLSearchParams(url.hash.slice(1));
        process(params);
        url.hash = params.toString();
      }
      return this.replaceKnown(url.href);
    } catch {
      return this.text(value);
    }
  }
  text(input: string, depth = 0): string {
    if (bytes(input) > TRACE_BODY_LIMIT) return '[OMITTED: text exceeds 2 MiB capture limit]';
    if (depth > 12) return '[OMITTED: nested text exceeds inspection limit]';
    let text = input;

    text = text.replace(
      /(^|[\r\n])([ \t]*(?:Cookie|Set-Cookie|Authorization|Proxy-Authorization|X-Riot-Entitlements-JWT|X-Api-Key)\s*:\s*)([^\r\n]*)/gi,
      (_m, newline: string, prefix: string, value: string) => {
        const name = prefix.trim().split(':')[0]!;
        this.headers({ [name]: value });
        return newline + prefix + REDACTED;
      },
    );

    text = text.replace(/https?%3A%2F%2F[^\s"'<>]+/gi, (encoded) => {
      try {
        const decoded = decodeURIComponent(encoded),
          safe = this.text(decoded, depth + 1);
        return safe === decoded ? encoded : encodeURIComponent(safe);
      } catch {
        return encoded;
      }
    });
    text = text.replace(
      /([?&#](?:access_token|id_token|refresh_token|token|code|auth_code|state|nonce|code_verifier|x-amz-signature|x-goog-signature)=)([^&#\s"'<>]*)/gi,
      (_m, key: string, v: string) => {
        this.remember(v);
        try {
          this.remember(decodeURIComponent(v));
        } catch {}
        return key + REDACTED;
      },
    );
    text = text.replace(
      /(["']?([A-Za-z_][\w.-]{0,80})["']?\s*[:=]\s*)(?:"([^"]*)"|'([^']*)'|([^\s;,&<>"']+))/g,
      (
        whole,
        prefix: string,
        key: string,
        doubleQuoted: string,
        singleQuoted: string,
        bare: string,
      ) => {
        if (!secretKey(key)) return whole;
        const value = doubleQuoted ?? singleQuoted ?? bare ?? '';
        this.remember(value);
        return prefix + '"' + REDACTED + '"';
      },
    );
    text = text.replace(
      /<((?:[\w-]+:)?(?:rso_token|pas_token|token|password|secret))\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi,
      (_m, tag: string, attrs: string, value: string) => {
        this.remember(value.trim());
        return `<${tag}${attrs}>${REDACTED}</${tag}>`;
      },
    );
    text = text.replace(
      /<((?:[\w-]+:)?auth)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi,
      (_m, tag: string, attrs: string, value: string) => {
        if (!value.includes('<')) this.remember(value.trim());
        return `<${tag}${attrs}>${REDACTED}</${tag}>`;
      },
    );
    text = text.replace(/<input\b[^>]*>/gi, (tag) =>
      /\b(?:name|id|type)\s*=\s*["'](?:.*token.*|password|code_verifier|csrf|nonce|otp)["']/i.test(
        tag,
      )
        ? tag.replace(/\bvalue\s*=\s*(["'])([\s\S]*?)\1/gi, (_m, q: string, v: string) => {
            this.remember(v);
            return `value=${q}${REDACTED}${q}`;
          })
        : tag,
    );
    return this.replaceKnown(text);
  }
  value(input: unknown): unknown {
    this.nodes = 0;
    this.learning = 0;
    this.learn(input);
    return this.walk(input, 0);
  }
  private walk(input: unknown, depth: number): unknown {
    if (++this.nodes > 80000 || depth > 24) return '[OMITTED: inspection limit]';
    if (input === null || typeof input === 'boolean' || typeof input === 'number') return input;
    if (typeof input === 'string') {
      if (bytes(input) > TRACE_BODY_LIMIT) return '[OMITTED: string exceeds 2 MiB]';
      const trimmed = input.trim();
      if (/^[\[{]/.test(trimmed))
        try {
          const parsed = JSON.parse(trimmed);
          this.learn(parsed);
          return JSON.stringify(this.walk(parsed, depth + 1));
        } catch {}
      if (/^https?:\/\//i.test(trimmed)) return this.url(trimmed);
      if (
        trimmed.length >= 16 &&
        trimmed.length < 256000 &&
        /^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)
      )
        try {
          const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
          if (/^\s*[\[{]/.test(decoded)) {
            const parsed = JSON.parse(decoded);
            this.learn(parsed);
            const safe = this.walk(parsed, depth + 1);
            return JSON.stringify(parsed) === JSON.stringify(safe)
              ? this.text(input)
              : Buffer.from(JSON.stringify(safe)).toString('base64');
          }
        } catch {}
      return this.text(input);
    }
    if (Array.isArray(input)) {
      const result = input.slice(0, 20000).map((item) => this.walk(item, depth + 1));
      if (input.length > 20000)
        result.push({
          diagnosticOmission: `${input.length - 20000} array entries exceed the inspection limit`,
        });
      return result;
    }
    if (!input || typeof input !== 'object') return String(input);
    const obj = input as Record<string, unknown>;
    if (obj.type === 'Ares.PlayerSettings' && typeof obj.data === 'string') {
      try {
        const decoded = decodeAimDocument(obj).data;
        this.learn(decoded);
        const safe = this.walk(decoded, depth + 1) as Record<string, unknown>;
        const encoded =
          JSON.stringify(decoded) === JSON.stringify(safe)
            ? obj.data
            : encodeAimDocument(safe).data;
        return {
          ...Object.fromEntries(
            Object.entries(obj)
              .filter(([k]) => k !== 'data')
              .map(([k, v]) => [k, secretKey(k) ? REDACTED : this.walk(v, depth + 1)]),
          ),
          data: encoded,
          decodedData: safe,
          diagnosticRepresentation:
            encoded === obj.data
              ? 'original base64 plus decoded JSON'
              : 'base64 re-encoded after credential redaction',
        };
      } catch {
        return {
          type: obj.type,
          data: '[OMITTED: compressed payload could not be inspected safely]',
        };
      }
    }
    const credentialNode =
      typeof obj.name === 'string' &&
      /^(?:[^:]+:)?(?:auth|rso_token|pas_token|token|password|secret)$/i.test(obj.name);
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [
        this.text(key),
        secretKey(key) || (credentialNode && (key === 'text' || key === 'children'))
          ? REDACTED
          : this.walk(value, depth + 1),
      ]),
    );
  }
  body(
    text: string,
    url = '',
  ): { text?: string; parsed?: unknown; bytes: number; omitted?: string; representation: string } {
    const size = bytes(text);
    if (size > TRACE_BODY_LIMIT)
      return {
        bytes: size,
        omitted: 'Body exceeds 2 MiB limit; headers and timing retained.',
        representation: 'omitted',
      };
    if (/\/pas\/v\d+\//.test(url) && !/^[\[{<]/.test(text.trim())) {
      this.remember(text.trim());
      return { bytes: size, text: REDACTED, representation: 'token body redacted' };
    }
    try {
      const raw = JSON.parse(text);
      const inferredAim =
        /\/playerPref\//.test(url) &&
        raw &&
        typeof raw === 'object' &&
        !Array.isArray(raw) &&
        raw.type === undefined &&
        typeof raw.data === 'string';
      const parsed = this.value(inferredAim ? { ...raw, type: 'Ares.PlayerSettings' } : raw);
      if (inferredAim && parsed && typeof parsed === 'object') {
        delete (parsed as Record<string, unknown>).type;
        (parsed as Record<string, unknown>).diagnosticTypeSource =
          'Ares.PlayerSettings inferred from request route';
      }
      return {
        bytes: size,
        text: JSON.stringify(parsed),
        parsed,
        representation: 'JSON reserialized after redaction',
      };
    } catch {
      return { bytes: size, text: this.text(text), representation: 'text after redaction' };
    }
  }
  tokenClaims(input: HeadersInit): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of new Headers(input)) {
      if (!/authorization|entitlements/i.test(key)) continue;
      const credential = value.replace(/^Bearer\s+/i, ''),
        parts = credential.split('.');
      try {
        const claims = JSON.parse(Buffer.from(parts[1] ?? '', 'base64').toString('utf8'));
        const selected = claims;
        result[
          key
            .replace(/authorization/i, 'accessClaims')
            .replace(/x-riot-entitlements-jwt/i, 'entitlementClaims')
        ] = {
          signatureVerified: false,
          purpose: 'diagnostic hints only',
          claims: this.value(selected),
        };
      } catch {
        result[key === 'authorization' ? 'accessClaims' : 'entitlementClaims'] = {
          parseable: false,
        };
      }
    }
    return result;
  }
}
