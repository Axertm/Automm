import { RETRY_BACKOFF_MS } from '../../config/constants.js';

export class PermanentProviderError extends Error {}

function jitter(ms: number): number {
  return ms + Math.floor(Math.random() * ms * 0.25);
}

/**
 * Retries a transient failure up to RETRY_BACKOFF_MS.length + 1 attempts
 * with exponential backoff + jitter. Throwing PermanentProviderError skips
 * retries entirely (e.g. a 4xx that will never succeed).
 */
export async function retryWithBackoff<T>(
  task: () => Promise<T>,
  onRetry?: (attempt: number, error: unknown) => void,
): Promise<T> {
  let lastError: unknown;
  const maxAttempts = RETRY_BACKOFF_MS.length + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (error instanceof PermanentProviderError || attempt === maxAttempts) {
        throw error;
      }
      onRetry?.(attempt, error);
      const backoffMs = RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]!;
      await new Promise((resolve) => setTimeout(resolve, jitter(backoffMs)));
    }
  }
  throw lastError;
}
