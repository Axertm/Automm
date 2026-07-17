import type { Logger } from 'pino';
import type { Currency } from '../../domain/value-objects/Currency.js';
import type { IPriceProvider } from '../../application/ports/IPriceProvider.js';
import { retryWithBackoff, PermanentProviderError } from '../rate-limit/retryWithBackoff.js';

const BASE_URL = 'https://api.coingecko.com/api/v3/simple/price';

const COINGECKO_IDS: Record<Currency, string> = {
  LTC: 'litecoin',
  SOL: 'solana',
  USDT: 'tether',
};

/** Short enough that a stale price is never shown for long, long enough that a buyer re-opening the amount modal a few times doesn't burn through CoinGecko's free-tier rate limit. */
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  price: number;
  expiresAt: number;
}

/**
 * Free, keyless CoinGecko "simple price" endpoint — no API key required at
 * this call volume (one lookup per amount-entry attempt, cached). Same
 * transient/permanent retry split as the UTXO providers, just far
 * lower-stakes: this only feeds a USD->coin conversion shown to the buyer
 * before a deal even exists, never a fund-moving call.
 */
export class CoinGeckoPriceProvider implements IPriceProvider {
  private readonly cache = new Map<Currency, CacheEntry>();

  constructor(private readonly logger: Logger) {}

  async getUsdPrice(currency: Currency): Promise<number> {
    const cached = this.cache.get(currency);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.price;
    }

    const id = COINGECKO_IDS[currency];
    const price = await retryWithBackoff(
      async () => {
        const response = await fetch(`${BASE_URL}?ids=${id}&vs_currencies=usd`);
        if (response.status === 429 || response.status >= 500) {
          throw new Error(`CoinGecko transient error: HTTP ${response.status}`);
        }
        if (!response.ok) {
          throw new PermanentProviderError(`CoinGecko permanent error: HTTP ${response.status}`);
        }
        const data = (await response.json()) as Record<string, { usd?: number }>;
        const usd = data[id]?.usd;
        if (typeof usd !== 'number' || usd <= 0) {
          throw new PermanentProviderError(`CoinGecko returned no usable USD price for ${id}`);
        }
        return usd;
      },
      (attempt, error) => {
        this.logger.warn({ currency, attempt, err: (error as Error).message }, 'price_fetch_retry');
      },
    );

    this.cache.set(currency, { price, expiresAt: Date.now() + CACHE_TTL_MS });
    return price;
  }
}
