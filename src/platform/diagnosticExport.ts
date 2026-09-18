import { Platform, Share } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { AppError } from '../core/validation';

export async function saveDiagnosticFile(
  json: string,
  filename: string,
  guard: () => void = () => {},
): Promise<string> {
  if (!/^Outpost-[a-zA-Z0-9._-]+\.json$/.test(filename) || json.length > 28 * 1024 * 1024)
    throw new AppError(
      'DIAGNOSTIC_FILE',
      'The diagnostic export exceeds its safe size or name limit.',
    );
  guard();
  if (Platform.OS === 'android') {
    const access = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    guard();
    if (!access.granted) return 'Export cancelled. No diagnostic file was saved.';
    const uri = await FileSystem.StorageAccessFramework.createFileAsync(
      access.directoryUri,
      filename.replace(/\.json$/, ''),
      'application/json',
    );
    try {
      guard();
      await FileSystem.writeAsStringAsync(uri, json, { encoding: FileSystem.EncodingType.UTF8 });
      guard();
    } catch (error) {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      throw error;
    }
    return `Saved ${filename} in the folder you selected.`;
  }
  if (Platform.OS === 'ios') {
    if (!FileSystem.cacheDirectory)
      throw new AppError('DIAGNOSTIC_FILE', 'The export cache is unavailable.');
    const folder = FileSystem.cacheDirectory + 'outpost-diagnostic-export/';
    await FileSystem.makeDirectoryAsync(folder, { intermediates: true });
    guard();

    const old = await FileSystem.readDirectoryAsync(folder);
    for (const name of old)
      if (/^Outpost-[a-zA-Z0-9._-]+\.json$/.test(name))
        await FileSystem.deleteAsync(folder + name, { idempotent: true });
    const uri = folder + filename;
    await FileSystem.writeAsStringAsync(uri, json, { encoding: FileSystem.EncodingType.UTF8 });
    try {
      guard();
      const result = await Share.share(
        { url: uri, title: 'Outpost diagnostics' },
        { subject: 'Outpost diagnostics' },
      );
      return result.action === Share.dismissedAction
        ? 'Export cancelled.'
        : 'Diagnostic file shared.';
    } finally {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
  }
  throw new AppError('DIAGNOSTIC_PLATFORM', 'File export is unavailable on this platform.');
}
