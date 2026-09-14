import { AppError } from '../core/validation';
export async function configureBackground(enabled: boolean): Promise<void> {
  if (enabled) throw new AppError('NATIVE_REQUIRED', 'Background sync requires the native app.');
}
