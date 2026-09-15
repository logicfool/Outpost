export class AutoHistoryGate {
  private times = new Map<string, number>();
  private running = new Map<string, Promise<unknown>>();
  private generation = 0;
  clear() {
    this.generation++;
    this.times.clear();
    this.running.clear();
  }
  run(key: string, work: () => Promise<unknown>, now = Date.now()): Promise<unknown> {
    const pending = this.running.get(key);
    if (pending) return pending;
    if ((this.times.get(key) ?? 0) > now) return Promise.resolve();
    const generation = this.generation;
    this.times.set(key, now + 60000);
    if (this.times.size > 100) this.times.delete(this.times.keys().next().value!);
    const task = Promise.resolve()
      .then(() => (generation === this.generation ? work() : undefined))
      .finally(() => {
        if (this.running.get(key) === task) this.running.delete(key);
      });
    this.running.set(key, task);
    return task.catch((error) => {
      if (generation === this.generation)
        this.times.set(
          key,
          Math.max(
            now + 60000,
            typeof error?.retryAt === 'number' && Number.isFinite(error.retryAt)
              ? error.retryAt
              : 0,
          ),
        );
      throw error;
    });
  }
}
