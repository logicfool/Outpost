import { Buffer } from 'buffer';
import { Inflate, deflateRaw } from 'pako';
import { AppError, object } from './validation';
import type { AimDocument } from './aimTypes';
export const MAX_AIM_BYTES = 512 * 1024;
const MAX_COMPRESSED = 192 * 1024;
export function inspectAimJson(value: unknown): asserts value is Record<string, unknown> {
  let nodes = 0;
  const visit = (v: unknown, depth: number): void => {
    if (++nodes > 40000 || depth > 24)
      throw new AppError('AIM_SIZE', 'The settings document exceeds the safe limit.');
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)))
      return;
    if (typeof v === 'string') {
      if (v.length > MAX_AIM_BYTES)
        throw new AppError('AIM_SIZE', 'A settings field is too large.');
      return;
    }
    if (Array.isArray(v)) {
      if (v.length > 12000) throw new AppError('AIM_SIZE', 'Too many settings entries.');
      for (const x of v) visit(x, depth + 1);
      return;
    }
    if (typeof v !== 'object') throw new AppError('AIM_SCHEMA', 'Unsupported settings value.');
    for (const [k, x] of Object.entries(v)) {
      if (['__proto__', 'prototype', 'constructor'].includes(k))
        throw new AppError('AIM_SCHEMA', 'Unsupported settings key.');
      visit(x, depth + 1);
    }
  };
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AppError('AIM_SCHEMA', 'Settings were not returned as a document.');
  visit(value, 0);
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.floatSettings) || !Array.isArray(data.stringSettings))
    throw new AppError('AIM_SCHEMA', 'Riot returned an unsupported settings format.');
}
export function decodeAimDocument(envelope: unknown): AimDocument {
  const e = object(envelope);
  if (e.type !== undefined && e.type !== 'Ares.PlayerSettings')
    throw new AppError('AIM_SCHEMA', 'Riot returned another settings category.');
  if (
    typeof e.data !== 'string' ||
    e.data.length > (MAX_COMPRESSED * 4) / 3 + 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(e.data)
  )
    throw new AppError('AIM_SCHEMA', 'The compressed settings response is invalid.');
  const bytes = Buffer.from(e.data, 'base64');
  if (
    bytes.length > MAX_COMPRESSED ||
    bytes.toString('base64').replace(/=+$/, '') !== e.data.replace(/=+$/, '')
  )
    throw new AppError('AIM_SIZE', 'Invalid compressed settings length.');
  const chunks: Uint8Array[] = [],
    inflater = new Inflate({ raw: true, chunkSize: 16384 });
  let size = 0;
  inflater.onData = (chunk) => {
    if (typeof chunk === 'string')
      throw new AppError('AIM_SCHEMA', 'Unexpected decompressor output.');
    const part = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    size += part.length;
    if (size > MAX_AIM_BYTES)
      throw new AppError('AIM_SIZE', 'Expanded settings exceed the safe limit.');
    chunks.push(part.slice());
  };
  try {
    inflater.push(bytes, true);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('AIM_SCHEMA', 'Riot settings could not be decompressed.');
  }
  if (
    (inflater as Inflate & { strm: { avail_in: number } }).strm.avail_in !== 0 ||
    inflater.err ||
    !(inflater as Inflate & { ended: boolean }).ended ||
    !size
  )
    throw new AppError('AIM_SCHEMA', 'Riot settings are incomplete.');
  const result = Buffer.concat(chunks.map((c) => Buffer.from(c))),
    text = result.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(result))
    throw new AppError('AIM_SCHEMA', 'Invalid settings text.');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AppError('AIM_SCHEMA', 'Riot settings are not valid JSON.');
  }
  inspectAimJson(data);
  return {
    data,
    modified:
      typeof e.modified === 'number' && Number.isFinite(e.modified) ? e.modified : undefined,
  };
}
export function encodeAimDocument(data: Record<string, unknown>): { type: string; data: string } {
  inspectAimJson(data);
  const bytes = Buffer.from(JSON.stringify(data), 'utf8');
  if (bytes.length > MAX_AIM_BYTES)
    throw new AppError('AIM_SIZE', 'Settings are too large to save.');
  const compressed = deflateRaw(bytes);
  if (compressed.length > MAX_COMPRESSED)
    throw new AppError('AIM_SIZE', 'Compressed settings are too large to save.');
  return { type: 'Ares.PlayerSettings', data: Buffer.from(compressed).toString('base64') };
}
