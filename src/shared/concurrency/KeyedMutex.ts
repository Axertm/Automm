/**
 * Serializes async work per key within this process. Used to close the race
 * where two near-simultaneous requests for the same deal (e.g. a
 * double-clicked "Confirm Release" button) both pass their in-memory state
 * checks before either has persisted, and both go on to broadcast a payout —
 * see ConfirmReleaseUseCase / AdminRefundUseCase.
 */
export class KeyedMutex {
  private readonly queues = new Map<string, Promise<unknown>>();

  async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.then(() => gate);
    this.queues.set(key, chained);

    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.queues.get(key) === chained) {
        this.queues.delete(key);
      }
    }
  }
}
