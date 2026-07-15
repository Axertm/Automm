import { CONFIRMATION_CACHE_TTL_MS, LTC_PROVIDER_RATE_LIMITS } from '../../../config/constants.js';
import type { Logger } from 'pino';
import { RequestQueue, TokenBucketLimiter } from '../../rate-limit/RequestQueue.js';
import { retryWithBackoff } from '../../rate-limit/retryWithBackoff.js';
import type { IUtxoProvider, Utxo, UtxoProviderTransaction } from './providers/IUtxoProvider.js';
import type { IFailoverUtxoProvider } from './IFailoverUtxoProvider.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Wraps a primary + fallback IUtxoProvider with per-provider rate limiting,
 * retry-with-backoff, automatic failover, and a short TTL cache so multiple
 * internal calls within one scan cycle don't multiply API usage.
 */
export class FailoverUtxoProvider implements IFailoverUtxoProvider {
  private readonly primaryQueue: RequestQueue;
  private readonly fallbackQueue: RequestQueue;
  private readonly txCache = new Map<string, CacheEntry<UtxoProviderTransaction[]>>();
  private readonly utxoCache = new Map<string, CacheEntry<Utxo[]>>();

  constructor(
    private readonly primary: IUtxoProvider,
    private readonly fallback: IUtxoProvider,
    private readonly logger: Logger,
  ) {
    this.primaryQueue = new RequestQueue(
      new TokenBucketLimiter(LTC_PROVIDER_RATE_LIMITS.blockcypher.requestsPerSecond, 1000),
    );
    this.fallbackQueue = new RequestQueue(
      new TokenBucketLimiter(LTC_PROVIDER_RATE_LIMITS.blockchair.requestsPerSecond, 1000),
    );
  }

  private async withFailover<T>(
    operation: string,
    call: (provider: IUtxoProvider, queue: RequestQueue) => Promise<T>,
  ): Promise<T> {
    try {
      return await retryWithBackoff(
        () => this.primaryQueue.schedule(() => call(this.primary, this.primaryQueue)),
        (attempt, error) =>
          this.logger.warn(
            { provider: this.primary.name, operation, attempt, err: (error as Error).message },
            'ltc_provider_retry',
          ),
      );
    } catch (primaryError) {
      this.logger.warn(
        {
          provider: this.primary.name,
          fallbackProvider: this.fallback.name,
          operation,
          err: (primaryError as Error).message,
        },
        'provider_failover',
      );
      return retryWithBackoff(
        () => this.fallbackQueue.schedule(() => call(this.fallback, this.fallbackQueue)),
        (attempt, error) =>
          this.logger.warn(
            { provider: this.fallback.name, operation, attempt, err: (error as Error).message },
            'ltc_provider_retry',
          ),
      );
    }
  }

  async getAddressTransactions(address: string): Promise<UtxoProviderTransaction[]> {
    const cached = this.txCache.get(address);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const value = await this.withFailover('getAddressTransactions', (provider) =>
      provider.getAddressTransactions(address),
    );
    this.txCache.set(address, { value, expiresAt: Date.now() + CONFIRMATION_CACHE_TTL_MS });
    return value;
  }

  async getUtxos(address: string): Promise<Utxo[]> {
    const cached = this.utxoCache.get(address);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const value = await this.withFailover('getUtxos', (provider) => provider.getUtxos(address));
    this.utxoCache.set(address, { value, expiresAt: Date.now() + CONFIRMATION_CACHE_TTL_MS });
    return value;
  }

  async getFeeEstimateSatPerVByte(): Promise<number> {
    return this.withFailover('getFeeEstimateSatPerVByte', (provider) => provider.getFeeEstimateSatPerVByte());
  }

  async broadcastRawTransaction(txHex: string): Promise<string> {
    // Broadcasting is not idempotent across providers — no cache, and a
    // failover here means "primary was unreachable", not "resend the same
    // funds twice"; both providers relay to the same public LTC mempool.
    return this.withFailover('broadcastRawTransaction', (provider) =>
      provider.broadcastRawTransaction(txHex),
    );
  }

  async getTransactionConfirmations(txid: string): Promise<number> {
    return this.withFailover('getTransactionConfirmations', (provider) =>
      provider.getTransactionConfirmations(txid),
    );
  }
}
