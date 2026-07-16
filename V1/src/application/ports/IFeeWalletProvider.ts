import type { Currency } from '../../domain/value-objects/Currency.js';

export interface IFeeWalletProvider {
  getFeeWalletAddress(currency: Currency): string;
}
