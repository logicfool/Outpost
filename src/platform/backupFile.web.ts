import { BACKUP_LIMIT_BYTES } from '../core/backup';
import { AppError } from '../core/validation';
export async function backupHash(text: string): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
export async function selectBackupFile(guard: () => void): Promise<string | null> {
  guard();
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);
    let finished = false;
    const complete = (text: string | null, error?: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      input.remove();
      try {
        guard();
        if (error) reject(error);
        else resolve(text);
      } catch (e) {
        reject(e);
      }
    };
    const timer = setTimeout(() => complete(null), 600000);
    input.addEventListener('cancel', () => complete(null), { once: true });
    input.addEventListener(
      'change',
      () => {
        const file = input.files?.[0];
        if (!file) {
          complete(null);
          return;
        }
        if (file.size > BACKUP_LIMIT_BYTES) {
          complete(null, new AppError('BACKUP_SIZE', 'Choose a backup smaller than 64 MiB.'));
          return;
        }
        void file.text().then(
          (text) => complete(text),
          (error) => complete(null, error),
        );
      },
      { once: true },
    );
    input.click();
  });
}
export async function saveBackupFile(
  json: string,
  name: string,
  guard: () => void,
): Promise<string> {
  guard();
  if (new TextEncoder().encode(json).byteLength > BACKUP_LIMIT_BYTES)
    throw new AppError('BACKUP_SIZE', 'The backup exceeds 64 MiB.');
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'Backup downloaded. Keep the file somewhere private.';
}
