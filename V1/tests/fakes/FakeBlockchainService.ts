import { randomUUID } from 'node:crypto';
import type {
  ConfirmationRequirement,
  GeneratedWallet,
  IBlockchainService,
  ObservedTransaction,
  PayoutOutput,
  PayoutResult,
} from '../../src/application/ports/IBlockchainService.js';
import type { Currency } from '../../src/domain/value-objects/Currency.js';
import { Money } from '../../src/domain/value-objects/Money.js';

/**
 * Scriptable in-memory stand-in for a real chain. Tests push
 * `ObservedTransaction[]` sequences onto `scanQueue`, drained one array per
 * `getIncomingTransactions` call, so a single test can simulate deposits
 * arriving across multiple scan cycles.
 */
export class FakeBlockchainService implements IBlockchainService {
  readonly generatedWallets: GeneratedWallet[] = [];
  readonly sentPayouts: Array<{ fromAddress: string; outputs: PayoutOutput[] }> = [];
  scanQueue: ObservedTransaction[][] = [];
  requiredConfirmations: ConfirmationRequirement = { kind: 'blocks', count: 3 };
  failNextSend = false;

  constructor(public readonly currency: Currency) {}

  async generateWallet(): Promise<GeneratedWallet> {
    const wallet: GeneratedWallet = {
      address: `fake-${this.currency.toLowerCase()}-${randomUUID()}`,
      encryptedPrivateKey: { iv: 'iv', authTag: 'tag', ciphertext: 'cipher', keyVersion: 1 },
      derivationPath: null,
    };
    this.generatedWallets.push(wallet);
    return wallet;
  }

  validateAddress(address: string): boolean {
    return address.startsWith(`fake-${this.currency.toLowerCase()}-`) || address.length > 0;
  }

  async getBalance(_address: string): Promise<Money> {
    return Money.zero(this.currency);
  }

  async getIncomingTransactions(_address: string, _sinceUnixTime?: number): Promise<ObservedTransaction[]> {
    return this.scanQueue.shift() ?? [];
  }

  async estimateFee(_params: { fromAddress: string; outputs: PayoutOutput[] }): Promise<Money> {
    return Money.fromDecimalString(this.currency, this.currency === 'LTC' ? '0.0001' : '0.000005');
  }

  async sendPayout(params: {
    fromWallet: {
      address: string;
      encryptedPrivateKey: { iv: string; authTag: string; ciphertext: string; keyVersion: number };
    };
    outputs: PayoutOutput[];
  }): Promise<PayoutResult> {
    if (this.failNextSend) {
      this.failNextSend = false;
      throw new Error('Simulated broadcast failure');
    }
    this.sentPayouts.push({ fromAddress: params.fromWallet.address, outputs: params.outputs });
    return { txid: `fake-payout-tx-${randomUUID()}`, feeCharged: Money.zero(this.currency) };
  }

  getRequiredConfirmations(): ConfirmationRequirement {
    return this.requiredConfirmations;
  }

  async getTransactionStatus(_txid: string): Promise<{ confirmations: number; confirmed: boolean }> {
    return { confirmations: 10, confirmed: true };
  }
}
