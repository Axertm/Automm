import type { Currency } from '../../domain/value-objects/Currency.js';

/**
 * Live USD price feed, used only to convert a buyer's USD amount entry into
 * the coin-denominated amount the rest of the system (Money, deposit
 * wallets, the blockchain itself) actually operates on. Never consulted
 * again after a deal is created — the deal's expectedAmount is fixed at
 * creation time, same as before this existed.
 */
export interface IPriceProvider {
  /** Current USD price of one whole unit of `currency` (e.g. 1 LTC, 1 SOL). */
  getUsdPrice(currency: Currency): Promise<number>;
}
