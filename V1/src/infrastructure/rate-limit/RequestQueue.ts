/** Simple token-bucket rate limiter used to keep free-tier API usage under a provider's documented ceiling. */
export class TokenBucketLimiter {
  private tokens: number;
  private lastRefillAt: number;

  constructor(
    private readonly maxTokens: number,
    private readonly refillIntervalMs: number,
  ) {
    this.tokens = maxTokens;
    this.lastRefillAt = Date.now();
  }

  private refill(): void {
    const elapsed = Date.now() - this.lastRefillAt;
    if (elapsed <= 0) return;
    const refillRate = this.maxTokens / this.refillIntervalMs;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * refillRate);
    this.lastRefillAt = Date.now();
  }

  private timeUntilNextToken(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    const refillRate = this.maxTokens / this.refillIntervalMs;
    return Math.ceil((1 - this.tokens) / refillRate);
  }

  async acquire(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = this.timeUntilNextToken();
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

/** A minimal FIFO queue that serializes calls through a TokenBucketLimiter. */
export class RequestQueue {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly limiter: TokenBucketLimiter) {}

  async schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      await this.limiter.acquire();
      return task();
    });
    // Swallow rejections in the chain link itself so one failed task doesn't
    // permanently wedge the queue for subsequent callers.
    this.tail = run.catch(() => undefined);
    return run;
  }
}
