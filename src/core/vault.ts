import { AppError, object, text, uuid } from './validation';
import { validateSession } from './auth';
import type { Session } from './types';
export interface SecretStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
interface Manifest {
  generation: string;
  chunks: number;
}
const CHUNK_SIZE = 1200,
  MAX_CHUNKS = 64;
function manifest(value: string | null): Manifest | null {
  if (!value) return null;
  try {
    const m = object(JSON.parse(value));
    if (
      /^[a-f0-9-]{16,64}$/i.test(text(m.generation)) &&
      Number.isInteger(m.chunks) &&
      Number(m.chunks) > 0 &&
      Number(m.chunks) <= MAX_CHUNKS
    )
      return m as unknown as Manifest;
  } catch {}
  throw new AppError(
    'VAULT_CORRUPT',
    'Secure session storage is unreadable. Remove this account and sign in again.',
  );
}
export class SessionVault {
  private locks = new Map<string, Promise<unknown>>();
  constructor(
    private storage: SecretStorage,
    private randomId: () => string,
  ) {}
  private prefix(id: string) {
    return `outpost.session.${uuid(id)}`;
  }
  private async serialized<T>(id: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const result = previous.catch(() => {}).then(work);
    this.locks.set(id, result);
    try {
      return await result;
    } finally {
      if (this.locks.get(id) === result) this.locks.delete(id);
    }
  }
  private async purge(prefix: string, value: Manifest | null) {
    if (value)
      for (let i = 0; i < value.chunks; i++)
        await this.storage.remove(`${prefix}.${value.generation}.${i}`);
  }
  private async recover(prefix: string): Promise<void> {
    const raw = await this.storage.get(`${prefix}.journal`);
    if (!raw) return;
    let next: Manifest | null, previous: Manifest | null;
    try {
      const journal = object(JSON.parse(raw));
      next = manifest(JSON.stringify(journal.next));
      previous = journal.previous ? manifest(JSON.stringify(journal.previous)) : null;
      if (!next) throw new Error();
    } catch {
      throw new AppError('VAULT_CORRUPT', 'Secure session recovery metadata is unreadable.');
    }
    const current = manifest(await this.storage.get(`${prefix}.manifest`));

    await this.purge(prefix, current?.generation === next.generation ? previous : next);
    await this.storage.remove(`${prefix}.journal`);
  }
  async read(id: string): Promise<Session | null> {
    id = uuid(id);
    return this.serialized(id, async () => {
      const prefix = this.prefix(id);
      await this.recover(prefix);
      const m = manifest(await this.storage.get(`${prefix}.manifest`));
      if (!m) return null;
      let encoded = '';
      for (let i = 0; i < m.chunks; i++) {
        const chunk = await this.storage.get(`${prefix}.${m.generation}.${i}`);
        if (chunk === null)
          throw new AppError(
            'VAULT_CORRUPT',
            'A secure session segment is missing. Sign in again.',
          );
        encoded += chunk;
      }
      try {
        const session = validateSession(JSON.parse(decodeURIComponent(encoded)));
        if (session.account.puuid !== id) throw new Error();
        return session;
      } catch {
        throw new AppError(
          'VAULT_CORRUPT',
          'The saved session could not be verified. Sign in again.',
        );
      }
    });
  }
  async write(input: Session): Promise<void> {
    const session = validateSession(input);
    return this.serialized(session.account.puuid, async () => {
      const prefix = this.prefix(session.account.puuid);
      await this.recover(prefix);
      const generation = this.randomId();
      if (!/^[a-f0-9-]{16,64}$/i.test(generation))
        throw new AppError('VAULT_WRITE', 'A secure storage identifier could not be created.');
      const encoded = encodeURIComponent(JSON.stringify(session));
      const chunks = Math.ceil(encoded.length / CHUNK_SIZE);
      if (chunks > MAX_CHUNKS)
        throw new AppError('VAULT_SIZE', 'This session is too large to save securely.');
      const old = manifest(await this.storage.get(`${prefix}.manifest`));
      if (old?.generation === generation)
        throw new AppError('VAULT_WRITE', 'A storage generation was reused. Retry sign-in.');

      await this.storage.set(
        `${prefix}.journal`,
        JSON.stringify({ next: { generation, chunks }, previous: old }),
      );
      try {
        for (let i = 0; i < chunks; i++)
          await this.storage.set(
            `${prefix}.${generation}.${i}`,
            encoded.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
          );
        await this.storage.set(`${prefix}.manifest`, JSON.stringify({ generation, chunks }));
      } catch (error) {
        await this.recover(prefix).catch(() => {});
        throw error;
      }
      await this.recover(prefix).catch(() => {});
    });
  }
  async remove(id: string): Promise<void> {
    id = uuid(id);
    return this.serialized(id, async () => {
      const prefix = this.prefix(id);
      await this.recover(prefix);
      const m = manifest(await this.storage.get(`${prefix}.manifest`));
      await this.purge(prefix, m);
      await this.storage.remove(`${prefix}.manifest`);
    });
  }
}
