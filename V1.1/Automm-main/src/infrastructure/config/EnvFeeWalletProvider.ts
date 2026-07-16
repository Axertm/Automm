import type { Currency } from '../../domain/value-objects/Currency.js';
import type { IFeeWalletProvider } from '../../application/ports/IFeeWalletProvider.js';
import { env } from '../../config/env.js';

export class EnvFeeWalletProvider implements IFeeWalletProvider {
  getFeeWalletAddress(currency: Currency): string {
    return currency === 'LTC' ? env.LTC_FEE_WALLET_ADDRESS : env.SOL_FEE_WALLET_ADDRESS;
  }
}
