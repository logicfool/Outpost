import { AppError } from '../core/validation';
export async function saveDiagnosticFile(
  json: string,
  filename: string,
  guard: () => void = () => {},
): Promise<string> {
  if (!/^Outpost-[a-zA-Z0-9._-]+\.json$/.test(filename) || json.length > 28 * 1024 * 1024)
    throw new AppError('DIAGNOSTIC_FILE', 'The diagnostic file exceeds the safe export limit.');
  guard();
  const blob = new Blob([json], { type: 'application/json' }),
    url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return `Saved ${filename}.`;
}
