export const yieldToUI = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
export function drainNow<T>(steps: Generator<void, T>): T {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

export async function drainCooperatively<T>(steps: Generator<void, T>, budgetMs = 6): Promise<T> {
  let started = Date.now();
  await yieldToUI();
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
    if (Date.now() - started >= budgetMs) {
      await yieldToUI();
      started = Date.now();
    }
  }
}
