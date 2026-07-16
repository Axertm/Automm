import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import type { Logger } from 'pino';
import type {
  ConfirmationRequirement,
  GeneratedWallet,
  IBlockchainService,
  ObservedTransaction,
  PayoutOutput,
  PayoutResult,
} from '../../../application/ports/IBlockchainService.js';
import { Money } from '../../../domain/value-objects/Money.js';
import { isValidAddress } from '../../../domain/value-objects/Address.js';
import type { ISolanaRpcClient } from './ISolanaRpcClient.js';

const SIGNATURE_HISTORY_LIMIT = 50;
const BASE_TRANSFER_FEE_LAMPORTS = 5_000;

export class SolanaService implements IBlockchainService {
  readonly currency = 'SOL' as const;

  constructor(
    private readonly rpcClient: ISolanaRpcClient,
    private readonly logger: Logger,
  ) {}

  async generateWallet(): Promise<GeneratedWallet> {
    const keypair = Keypair.generate();
    const encryptedPrivateKey = Buffer.from(keypair.secretKey).toString('base64');
    return { address: keypair.publicKey.toBase58(), encryptedPrivateKey, derivationPath: null };
  }

  validateAddress(address: string): boolean {
    return isValidAddress('SOL', address);
  }

  async getBalance(address: string): Promise<Money> {
    const pubkey = new PublicKey(address);
    const lamports = await this.rpcClient.withConnection('getBalance', (connection) =>
      connection.getBalance(pubkey),
    );
    return Money.fromSmallestUnits('SOL', BigInt(lamports));
  }

  async getIncomingTransactions(address: string, sinceUnixTime?: number): Promise<ObservedTransaction[]> {
    const pubkey = new PublicKey(address);
    const signatures = await this.rpcClient.withConnection('getSignaturesForAddress', (connection) =>
      connection.getSignaturesForAddress(pubkey, { limit: SIGNATURE_HISTORY_LIMIT }),
    );

    const results: ObservedTransaction[] = [];
    for (const sigInfo of signatures) {
      if (sinceUnixTime && sigInfo.blockTime && sigInfo.blockTime < sinceUnixTime) continue;
      const tx = await this.rpcClient.withConnection('getParsedTransaction', (connection) =>
        connection.getParsedTransaction(sigInfo.signature, { maxSupportedTransactionVersion: 0 }),
      );
      if (!tx?.meta || tx.meta.err) continue;

      const accountKeys = tx.transaction.message.accountKeys;
      const accountIndex = accountKeys.findIndex((key) => key.pubkey.equals(pubkey));
      if (accountIndex === -1) continue;

      const preBalance = tx.meta.preBalances[accountIndex] ?? 0;
      const postBalance = tx.meta.postBalances[accountIndex] ?? 0;
      const delta = postBalance - preBalance;
      if (delta <= 0) continue; // not an incoming transfer to this address

      results.push({
        txid: sigInfo.signature,
        amount: Money.fromSmallestUnits('SOL', BigInt(delta)),
        confirmations:
          sigInfo.confirmationStatus === 'finalized'
            ? Number.MAX_SAFE_INTEGER
            : sigInfo.confirmationStatus === 'confirmed'
              ? 1
              : 0,
        blockTime: sigInfo.blockTime ?? null,
      });
    }
    return results;
  }

  async estimateFee(params: { fromAddress: string; outputs: PayoutOutput[] }): Promise<Money> {
    void params;
    // Solana's base fee is a flat 5000 lamports per signature; one output
    // set = one signature. No priority fee is added by default.
    return Money.fromSmallestUnits('SOL', BigInt(BASE_TRANSFER_FEE_LAMPORTS));
  }

  async sendPayout(params: {
    fromWallet: { address: string; encryptedPrivateKey: string };
    outputs: PayoutOutput[];
  }): Promise<PayoutResult> {
    let decryptedKey: Buffer | null = null;
    try {
      decryptedKey = Buffer.from(params.fromWallet.encryptedPrivateKey, 'base64');
      const keypair = Keypair.fromSecretKey(new Uint8Array(decryptedKey));

      const transaction = new Transaction();
      for (const output of params.outputs) {
        transaction.add(
          SystemProgram.transfer({
            fromPubkey: keypair.publicKey,
            toPubkey: new PublicKey(output.address),
            lamports: Number(output.amount.smallestUnits),
          }),
        );
      }

      const txid = await this.rpcClient.withConnection('sendAndConfirmTransaction', (connection) =>
        sendAndConfirmTransaction(connection, transaction, [keypair], { commitment: 'confirmed' }),
      );

      this.logger.info(
        { dealCurrency: 'SOL', txid, outputCount: params.outputs.length },
        'sol_payout_broadcast',
      );
      return { txid, feeCharged: Money.fromSmallestUnits('SOL', BigInt(BASE_TRANSFER_FEE_LAMPORTS)) };
    } finally {
      decryptedKey?.fill(0);
    }
  }

  getRequiredConfirmations(): ConfirmationRequirement {
    return { kind: 'commitment', level: 'finalized' };
  }

  async getTransactionStatus(txid: string): Promise<{ confirmations: number; confirmed: boolean }> {
    const statuses = await this.rpcClient.withConnection('getSignatureStatuses', (connection) =>
      connection.getSignatureStatuses([txid]),
    );
    const status = statuses.value[0];
    if (!status) return { confirmations: 0, confirmed: false };
    const confirmed = status.confirmationStatus === 'finalized';
    return { confirmations: confirmed ? Number.MAX_SAFE_INTEGER : (status.confirmations ?? 0), confirmed };
  }
}

export { LAMPORTS_PER_SOL };
