/** Single-flight read cache with explicit invalidation; intended for immutable public metadata. */
export class MemoizedRead<T> {
  private version = 0;
  private value?: { data: T };
  private flight?: Promise<T>;
  read(loader: () => Promise<T>): Promise<T> {
    if (this.value) return Promise.resolve(this.value.data);
    if (this.flight) return this.flight;
    const version = this.version;
    const work = Promise.resolve()
      .then(loader)
      .then((data) => {
        if (version === this.version) this.value = { data };
        return data;
      });
    this.flight = work;
    void work.then(
      () => {
        if (this.flight === work) this.flight = undefined;
      },
      () => {
        if (this.flight === work) this.flight = undefined;
      },
    );
    return work;
  }
  replace(data: T): void {
    this.version++;
    this.flight = undefined;
    this.value = { data };
  }
  clear(): void {
    this.version++;
    this.flight = undefined;
    this.value = undefined;
  }
}
