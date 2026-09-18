export class CredentialQueue {
  private jobs = new Map<string, Promise<unknown>>();
  run<T>(id: string, work: () => Promise<T>): Promise<T> {
    const previous = this.jobs.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    this.jobs.set(id, next);
    void next
      .finally(() => {
        if (this.jobs.get(id) === next) this.jobs.delete(id);
      })
      .catch(() => {});
    return next;
  }
  async drain(id: string): Promise<void> {
    await this.jobs.get(id)?.catch(() => {});
  }
}
