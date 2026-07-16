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
    // Pushed to BOTH providers, always — not just failover-on-error. Observed
    // in production: BlockCypher's push endpoint returned HTTP success and
    // tracked the transaction in its own dashboard, yet it never actually
    // reached the real Litecoin network (an independent full-node explorer
    // never saw it, for hours). An HTTP-level "success" from one relay does
    // not prove real network propagation, so relying on failover-on-throw
    // alone means a relay that's silently unreliable (but never errors) can
    // permanently starve the other provider of ever being tried. Rebroadcast
    // is idempotent — pushing the same valid signed tx twice is harmless —
    // so this maximizes the chance at least one relay actually reaches a
    // miner. Prefers the primary's txid when both succeed (they're always
    // identical anyway, since signing is deterministic); only throws if
    // BOTH relays fail outright.
    const [primaryResult, fallbackResult] = await Promise.allSettled([
      retryWithBackoff(
        () => this.primaryQueue.schedule(() => this.primary.broadcastRawTransaction(txHex)),
        (attempt, error) =>
          this.logger.warn(
            { provider: this.primary.name, operation: 'broadcastRawTransaction', attempt, err: (error as Error).message },
            'ltc_provider_retry',
          ),
      ),
      retryWithBackoff(
        () => this.fallbackQueue.schedule(() => this.fallback.broadcastRawTransaction(txHex)),
        (attempt, error) =>
          this.logger.warn(
            { provider: this.fallback.name, operation: 'broadcastRawTransaction', attempt, err: (error as Error).message },
            'ltc_provider_retry',
          ),
      ),
    ]);

    if (primaryResult.status === 'fulfilled') return primaryResult.value;
    this.logger.warn(
      { provider: this.primary.name, err: primaryResult.reason instanceof Error ? primaryResult.reason.message : String(primaryResult.reason) },
      'broadcast_provider_failed',
    );
    if (fallbackResult.status === 'fulfilled') return fallbackResult.value;
    this.logger.warn(
      { provider: this.fallback.name, err: fallbackResult.reason instanceof Error ? fallbackResult.reason.message : String(fallbackResult.reason) },
      'broadcast_provider_failed',
    );
    throw primaryResult.reason;
  }

  async getTransactionConfirmations(txid: string): Promise<number> {
    return this.withFailover('getTransactionConfirmations', (provider) =>
      provider.getTransactionConfirmations(txid),
    );
  }

  async transactionExists(txid: string): Promise<boolean> {
    // withFailover only fails over on a THROWN error — a clean `false`
    // return (a provider definitively saying "not found") is a normal,
    // valid answer, not a failure, so it's returned as-is without
    // consulting the fallback provider.
    return this.withFailover('transactionExists', (provider) => provider.transactionExists(txid));
  }
}
