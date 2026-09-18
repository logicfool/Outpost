import { Platform, Share } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Legacy from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { BACKUP_LIMIT_BYTES } from '../core/backup';
import { AppError } from '../core/validation';
export const backupHash = (text: string) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text);
export async function selectBackupFile(guard: () => void): Promise<string | null> {
  guard();
  const selected = await File.pickFileAsync({
    mimeTypes: ['application/json', 'text/plain', 'application/octet-stream'],
  });
  guard();
  if (selected.canceled) return null;
  const file = selected.result;
  if (file.size > BACKUP_LIMIT_BYTES)
    throw new AppError('BACKUP_SIZE', 'Choose a backup smaller than 64 MiB.');
  const reader = file.readableStream().getReader(),
    decoder = new TextDecoder();
  const chunks: string[] = [];
  let size = 0;
  try {
    for (;;) {
      guard();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > BACKUP_LIMIT_BYTES)
        throw new AppError('BACKUP_SIZE', 'The backup exceeds 64 MiB.');
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    guard();
    return chunks.join('');
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function saveBackupFile(
  json: string,
  name: string,
  guard: () => void,
): Promise<string> {
  if (
    !/^Outpost-backup-[A-Za-z0-9._-]+\.json$/.test(name) ||
    new TextEncoder().encode(json).byteLength > BACKUP_LIMIT_BYTES
  )
    throw new AppError('BACKUP_SIZE', 'The backup file is too large or its name is invalid.');
  guard();
  if (Platform.OS === 'android') {
    const access = await Legacy.StorageAccessFramework.requestDirectoryPermissionsAsync();
    guard();
    if (!access.granted) return 'Backup cancelled.';
    const uri = await Legacy.StorageAccessFramework.createFileAsync(
      access.directoryUri,
      name.replace(/\.json$/, ''),
      'application/json',
    );
    try {
      guard();
      await Legacy.writeAsStringAsync(uri, json, { encoding: Legacy.EncodingType.UTF8 });
      guard();
    } catch (e) {
      await Legacy.deleteAsync(uri, { idempotent: true }).catch(() => {});
      throw e;
    }
    return 'Backup saved to the selected folder.';
  }
  if (!Legacy.cacheDirectory) throw new AppError('BACKUP_FILE', 'Backup sharing is unavailable.');
  const folder = Legacy.cacheDirectory + 'outpost-backup-export/';
  await Legacy.makeDirectoryAsync(folder, { intermediates: true });
  guard();
  const uri = folder + name;
  await Legacy.writeAsStringAsync(uri, json, { encoding: Legacy.EncodingType.UTF8 });
  try {
    guard();
    const result = await Share.share({ url: uri, title: 'Outpost backup' });
    return result.action === Share.dismissedAction
      ? 'Backup sharing cancelled.'
      : 'Backup shared. Keep it outside Outpost to survive uninstall.';
  } finally {
    await Legacy.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
}
