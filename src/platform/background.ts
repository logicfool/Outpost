import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { AppError } from '../core/validation';
import { getRuntime } from './runtime';
const TASK = 'outpost-store-observer-v1';
TaskManager.defineTask(TASK, async () => {
  try {
    const runtime = await getRuntime();
    if (!(await runtime.repository.settings()).backgroundSync)
      return BackgroundTask.BackgroundTaskResult.Success;

    for (const account of await runtime.repository.accounts()) {
      try {
        await runtime.sync(account.puuid);
      } catch {}
    }
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});
export async function configureBackground(enabled: boolean): Promise<void> {
  if (!enabled) {
    if (await TaskManager.isTaskRegisteredAsync(TASK))
      await BackgroundTask.unregisterTaskAsync(TASK);
    return;
  }
  if (!(await TaskManager.isAvailableAsync()))
    throw new AppError(
      'NATIVE_BUILD',
      'Background sync requires a native development or release build, not Expo Go.',
    );
  if ((await BackgroundTask.getStatusAsync()) === BackgroundTask.BackgroundTaskStatus.Restricted)
    throw new AppError(
      'BACKGROUND_RESTRICTED',
      'Your device currently restricts background execution.',
    );
  await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 15 });
}
