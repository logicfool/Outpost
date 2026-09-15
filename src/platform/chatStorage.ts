import * as SQLite from 'expo-sqlite';
import { File } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { randomHex } from './secure';
import { openRepository } from './storage';
import { createChatStore, type ChatStore } from '../core/chatStore';
import { AppError, uuid } from '../core/validation';
import { DEMO_ID } from '../core/demo';

interface OpenStore {
  store: ChatStore;
  db: SQLite.SQLiteDatabase;
}
const opened = new Map<string, Promise<OpenStore>>();
const removing = new Set<string>();
const removed = new Set<string>();

export function activateChatStorage(id: string): void {
  removed.delete(uuid(id));
}
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const databaseName = (id: string) => `outpost-chat-${uuid(id)}.db`;
const keyName = (id: string) => `outpost.chat.key.${uuid(id)}`;

export async function openChatStorage(accountId: string): Promise<ChatStore> {
  const id = uuid(accountId);
  if (id === DEMO_ID || removing.has(id) || removed.has(id))
    throw new AppError('CHAT_ACCOUNT', 'This account cannot open persistent chat storage.');
  let promise = opened.get(id);
  if (!promise) {
    promise = initialize(id);
    opened.set(id, promise);
    void promise.catch(() => {
      if (opened.get(id) === promise) opened.delete(id);
    });
  }
  return (await promise).store;
}
async function initialize(id: string): Promise<OpenStore> {
  if (
    removed.has(id) ||
    removing.has(id) ||
    !(await (await openRepository()).accounts()).some((a) => a.puuid === id) ||
    removing.has(id)
  )
    throw new AppError('CHAT_ACCOUNT', 'Select a linked account to open its saved messages.');
  const db = await SQLite.openDatabaseAsync(databaseName(id), { useNewConnection: true });
  let createdKey = false;
  try {
    const cipher = await db.getFirstAsync<Record<string, unknown>>('PRAGMA cipher_version');
    if (!cipher || !Object.values(cipher).some((v) => typeof v === 'string' && v.length > 0)) {
      throw new AppError(
        'CHAT_ENCRYPTION',
        'This build has no encrypted chat database support. Install the new native build.',
      );
    }
    let key = await SecureStore.getItemAsync(keyName(id), options);
    if (!key) {
      key = randomHex();
      await SecureStore.setItemAsync(keyName(id), key, options);
      createdKey = true;
    }
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid storage key');
    await db.execAsync(`PRAGMA key = "x'${key}'";`);
    const store = await createChatStore(db);
    return { store, db };
  } catch (reason) {
    await db.closeAsync().catch(() => {});
    if (createdKey) await SecureStore.deleteItemAsync(keyName(id), options);
    if (reason instanceof AppError) throw reason;
    throw new AppError(
      'CHAT_STORAGE',
      'Local chat history could not be unlocked. Existing data has not been replaced.',
    );
  }
}

export async function removeChatStorage(accountId: string): Promise<void> {
  const id = uuid(accountId);
  removing.add(id);
  removed.add(id);
  try {
    const value = await opened.get(id)?.catch(() => undefined);
    if (value) {
      await value.store.close();
      await value.db.closeAsync();
    }
    opened.delete(id);
    const directory = SQLite.defaultDatabaseDirectory as string;
    const uri = directory.startsWith('file://') ? directory : 'file://' + directory;
    if (new File(uri, databaseName(id)).exists) await SQLite.deleteDatabaseAsync(databaseName(id));
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const sidecar = new File(uri, databaseName(id) + suffix);
      if (sidecar.exists) sidecar.delete();
    }
    await SecureStore.deleteItemAsync(keyName(id), options);
  } finally {
    removing.delete(id);
  }
}
