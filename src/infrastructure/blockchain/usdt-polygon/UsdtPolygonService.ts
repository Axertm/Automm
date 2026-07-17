import { Contract, Wallet, type EventLog } from 'ethers';
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
import type { IPolygonRpcClient } from './IPolygonRpcClient.js';

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

const REQUIRED_CONFIRMATIONS = 30; // ~1 minute at Polygon's ~2s block time

// Bounded recent-history lookback for deposit scanning. Free/public RPC
// providers cap eth_getLogs block ranges anyway, and this window is far
// wider than DEPOSIT_SCAN_CRON's default 2-minute cadence needs.
const DEPOSIT_LOOKBACK_BLOCKS = 100_000; // ~55 hours at ~2s/block

// A conservative fixed gas-limit estimate for a plain ERC20 transfer() call
// — real usage is typically 45k-65k; padded well above that so a legitimate
// transfer is never blocked by an under-estimate.
const ERC20_TRANSFER_GAS_LIMIT = 100_000n;

/**
 * Implements IBlockchainService for USDT on Polygon (an ERC-20 token, unlike
 * LTC/SOL which are native assets). The one fundamental difference this
 * drives: an ERC-20 transfer needs the wallet to hold native POL to pay gas,
 * and USDT itself cannot pay it. This bot's gas model is "the buyer sends a
 * small amount of POL alongside their USDT deposit" — the deposit wallet is
 * never pre-funded by the operator, keeping every deal wallet self-contained
 * exactly like LTC/SOL (see generateWallet). POL is intentionally NOT part
 * of Money/Currency accounting: it's a pure infrastructure-level fuel this
 * service checks/spends internally, invisible to the deal/domain layer.
 */
export class UsdtPolygonService implements IBlockchainService {
  readonly currency = 'USDT' as const;

  constructor(
    private readonly rpcClient: IPolygonRpcClient,
    private readonly contractAddress: string,
    private readonly logger: Logger,
    private readonly requiredConfirmations: number = REQUIRED_CONFIRMATIONS,
  ) {}

  async generateWallet(): Promise<GeneratedWallet> {
    const wallet = Wallet.createRandom();
    const keyBytes = Buffer.from(wallet.privateKey.slice(2), 'hex');
    const encryptedPrivateKey = keyBytes.toString('base64');
    // The mnemonic/wallet object is never referenced again after this returns.
    return { address: wallet.address, encryptedPrivateKey, derivationPath: wallet.path ?? null };
  }

  validateAddress(address: string): boolean {
    return isValidAddress('USDT', address);
  }

  async getBalance(address: string): Promise<Money> {
    const balance = await this.rpcClient.withProvider('getBalance', async (provider) => {
      const contract = new Contract(this.contractAddress, ERC20_ABI, provider);
      return (await contract.balanceOf!(address)) as bigint;
    });
    return Money.fromSmallestUnits('USDT', balance);
  }

  async getIncomingTransactions(address: string, sinceUnixTime?: number): Promise<ObservedTransaction[]> {
    return this.rpcClient.withProvider('getIncomingTransactions', async (provider) => {
      const currentBlock = await provider.getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - DEPOSIT_LOOKBACK_BLOCKS);
      const contract = new Contract(this.contractAddress, ERC20_ABI, provider);
      const filter = contract.filters.Transfer!(null, address);
      const events = await contract.queryFilter(filter, fromBlock, currentBlock);

      const results: ObservedTransaction[] = [];
      for (const event of events) {
        if (!('args' in event) || !event.args) continue;
        const eventLog = event as EventLog;
        const amount = eventLog.args[2] as bigint;
        if (amount <= 0n) continue;

        const block = await eventLog.getBlock();
        const blockTime = block.timestamp;
        if (sinceUnixTime && blockTime < sinceUnixTime) continue;

        results.push({
          txid: eventLog.transactionHash,
          amount: Money.fromSmallestUnits('USDT', amount),
          confirmations: Math.max(0, currentBlock - eventLog.blockNumber + 1),
          blockTime,
        });
      }
      return results;
    });
  }

  /**
   * Always zero: gas is paid separately out of the wallet's own pre-funded
   * POL balance (see class doc), never carved out of the escrowed USDT the
   * way LTC/SOL carve their network fee from the same asset being paid out.
   */
  async estimateFee(): Promise<Money> {
    return Money.zero('USDT');
  }

  /**
   * Unlike LTC (one UTXO tx, many outputs) or SOL (one tx, many instructions),
   * an ERC-20 transfer() call has exactly one recipient — a fee output and a
   * remainder output to different addresses genuinely require two separate
   * on-chain transactions (ExecutePayoutUseCase's fee/payout-address merge
   * still collapses this to one when they coincide, same as for LTC).
   * PayoutResult only carries a single txid, so with two real transactions
   * only the LAST one's hash is returned/recorded as both the fee and main
   * payout txid — outputs are processed fee-first, so in practice that's
   * always the seller's remainder transfer, the economically significant
   * one. The fee leg's own txid is still logged (see 'usdt_payout_broadcast')
   * for manual audit, just not tracked as its own Transaction row.
   */
  async sendPayout(params: {
    fromWallet: { address: string; encryptedPrivateKey: string };
    outputs: PayoutOutput[];
  }): Promise<PayoutResult> {
    let decryptedKey: Buffer | null = null;
    try {
      decryptedKey = Buffer.from(params.fromWallet.encryptedPrivateKey, 'base64');
      const privateKeyHex = `0x${decryptedKey.toString('hex')}`;

      const txHashes: string[] = [];
      for (const output of params.outputs) {
        const txHash = await this.rpcClient.withProvider('sendPayout', async (provider) => {
          const feeData = await provider.getFeeData();
          const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;
          const estimatedGasCost = ERC20_TRANSFER_GAS_LIMIT * gasPrice;
          const polBalance = await provider.getBalance(params.fromWallet.address);
          if (polBalance < estimatedGasCost) {
            throw new Error(
              `Insufficient POL for gas on ${params.fromWallet.address}: needs ~${estimatedGasCost} wei, has ${polBalance} wei. Ask the buyer to send a small amount of POL (MATIC) to this same deposit address for network fees, then retry.`,
            );
          }

          const wallet = new Wallet(privateKeyHex, provider);
          const contract = new Contract(this.contractAddress, ERC20_ABI, wallet);
          const tx = await contract.transfer!(output.address, output.amount.smallestUnits, {
            gasLimit: ERC20_TRANSFER_GAS_LIMIT,
          });
          await tx.wait(1);
          return tx.hash as string;
        });
        txHashes.push(txHash);
        this.logger.info({ dealCurrency: 'USDT', txid: txHash, to: output.address }, 'usdt_transfer_broadcast');
      }

      const finalTxHash = txHashes[txHashes.length - 1]!;
      this.logger.info(
        { dealCurrency: 'USDT', txid: finalTxHash, outputCount: params.outputs.length },
        'usdt_payout_broadcast',
      );
      return { txid: finalTxHash, feeCharged: Money.zero('USDT') };
    } finally {
      decryptedKey?.fill(0);
    }
  }

  getRequiredConfirmations(): ConfirmationRequirement {
    return { kind: 'blocks', count: this.requiredConfirmations };
  }

  async getTransactionStatus(txid: string): Promise<{ confirmations: number; confirmed: boolean }> {
    return this.rpcClient.withProvider('getTransactionStatus', async (provider) => {
      const [receipt, currentBlock] = await Promise.all([
        provider.getTransactionReceipt(txid),
        provider.getBlockNumber(),
      ]);
      if (!receipt || receipt.status !== 1) {
        return { confirmations: 0, confirmed: false };
      }
      const confirmations = Math.max(0, currentBlock - receipt.blockNumber + 1);
      return { confirmations, confirmed: confirmations >= this.requiredConfirmations };
    });
  }
}
