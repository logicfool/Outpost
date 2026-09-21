import { yieldToUI } from './cooperative';
/** Show the selected account's snapshot before optional history/catalog/session reads.
 * No tokens are read here. Scope guards prevent late work from publishing into another account.
 * Optional failures are isolated; they cannot prevent the normal network refresh. */
export async function restoreProgressively<T>(options: {
  snapshot(): Promise<T>;
  publish(value: T): void;
  current(): boolean;
  resume(): Promise<unknown>;
  optional: (() => Promise<unknown>)[];
  failed(): void;
  yield?: () => Promise<void>;
}): Promise<void> {
  const pause = options.yield ?? yieldToUI;
  try {
    const cached = await options.snapshot();
    if (!options.current()) return;
    options.publish(cached);
  } catch {
    if (options.current()) options.failed();
  }
  if (!options.current()) return;
  // Leave the cache commit a chance to paint before starting additional JS/native work.
  await pause();
  if (!options.current()) return;
  const resume = Promise.resolve().then(() => options.current() && options.resume());
  const secondary = options.optional.map(async (task) => {
    await pause();
    if (options.current()) await task();
  });
  const outcomes = await Promise.allSettled([resume, ...secondary]);
  if (options.current() && outcomes.some((outcome) => outcome.status === 'rejected'))
    options.failed();
}
