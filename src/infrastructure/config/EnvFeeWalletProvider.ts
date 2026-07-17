import type { Currency } from '../../domain/value-objects/Currency.js';
import type { IFeeWalletProvider } from '../../application/ports/IFeeWalletProvider.js';
import { env } from '../../config/env.js';

const FEE_WALLETS: Record<Currency, string> = {
  LTC: env.LTC_FEE_WALLET_ADDRESS,
  SOL: env.SOL_FEE_WALLET_ADDRESS,
  USDT: env.USDT_FEE_WALLET_ADDRESS,
};

export class EnvFeeWalletProvider implements IFeeWalletProvider {
  getFeeWalletAddress(currency: Currency): string {
    return FEE_WALLETS[currency];
  }
}
