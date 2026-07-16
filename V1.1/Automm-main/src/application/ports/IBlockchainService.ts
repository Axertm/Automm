import type { Currency } from '../../domain/value-objects/Currency.js';
import type { Money } from '../../domain/value-objects/Money.js';

export interface GeneratedWallet {
  address: string;
  encryptedPrivateKey: string;
  derivationPath: string | null;
}

export interface ObservedTransaction {
  txid: string;
  amount: Money;
  confirmations: number;
  blockTime: number | null;
}

export interface PayoutOutput {
  address: string;
  amount: Money;
}

export interface PayoutResult {
  txid: string;
  feeCharged: Money;
}

/** Either a block-count confirmation model (UTXO chains) or a commitment-level model (Solana). */
export type ConfirmationRequirement =
  { kind: 'blocks'; count: number } | { kind: 'commitment'; level: 'confirmed' | 'finalized' };

/**
 * The sole abstraction the rest of the application depends on for chain
 * access. LitecoinService and SolanaService implement this; nothing outside
 * infrastructure/blockchain ever imports a chain SDK or calls an HTTP API
 * directly. This is what makes ScanDepositsUseCase/ExecutePayoutUseCase/etc.
 * testable against FakeBlockchainService without touching a real chain.
 */
export interface IBlockchainService {
  readonly currency: Currency;

  generateWallet(): Promise<GeneratedWallet>;

  validateAddress(address: string): boolean;

  getBalance(address: string): Promise<Money>;

  getIncomingTransactions(address: string, sinceUnixTime?: number): Promise<ObservedTransaction[]>;

  estimateFee(params: { fromAddress: string; outputs: PayoutOutput[] }): Promise<Money>;

  /**
   * Broadcasts a single transaction with all requested outputs where the
   * chain supports multi-output.
   */
  sendPayout(params: {
    fromWallet: { address: string; encryptedPrivateKey: string };
    outputs: PayoutOutput[];
  }): Promise<PayoutResult>;

  getRequiredConfirmations(): ConfirmationRequirement;

  getTransactionStatus(txid: string): Promise<{ confirmations: number; confirmed: boolean }>;
}
