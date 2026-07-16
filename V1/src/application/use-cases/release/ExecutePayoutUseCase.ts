import { randomUUID } from 'node:crypto';
import { Transaction } from '../../../domain/entities/Transaction.js';
import { asTransactionId, asTxId, type DealId } from '../../../domain/value-objects/EntityId.js';
import { DealNotFoundError } from '../../../domain/errors/DomainErrors.js';
import type { IDealRepository } from '../../../domain/repositories/IDealRepository.js';
import type { IWalletRepository } from '../../../domain/repositories/IWalletRepository.js';
import type { ITransactionRepository } from '../../../domain/repositories/ITransactionRepository.js';
import type { IBlockchainServiceFactory } from '../../ports/IBlockchainServiceFactory.js';
import type { IFeeWalletProvider } from '../../ports/IFeeWalletProvider.js';
import type { IDiscordNotifier } from '../../ports/IDiscordNotifier.js';
import { AuditRecorder, SYSTEM_ACTOR } from '../../services/AuditRecorder.js';
import type { IClock } from '../../ports/IClock.js';
import { err, ok, type Result } from '../../../shared/result/Result.js';
import type { Deal } from '../../../domain/entities/Deal.js';
import type { DomainError } from '../../../domain/errors/DomainErrors.js';

/**
 * Runs immediately after ConfirmReleaseUseCase transitions a deal into
 * PAYOUT_IN_PROGRESS. Splits the deal's escrowed balance into a fee and a
 * seller remainder using integer basis-point math (see Money.splitByBasisPoints),
 * delegates the actual signing/broadcast to the currency's IBlockchainService
 * (which is the only place the private key is ever transiently decrypted),
 * and records both legs as Transaction rows. Leaves the deal in
 * PAYOUT_IN_PROGRESS with whatever txid was recorded on partial failure so
 * an admin can see and manually resolve a stuck payout rather than silently
 * reverting state.
 */
export class ExecutePayoutUseCase {
  constructor(
    private readonly dealRepository: IDealRepository,
    private readonly walletRepository: IWalletRepository,
    private readonly transactionRepository: ITransactionRepository,
    private readonly blockchainServiceFactory: IBlockchainServiceFactory,
    private readonly feeWalletProvider: IFeeWalletProvider,
    private readonly discordNotifier: IDiscordNotifier,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: IClock,
  ) {}

  async execute(dealId: DealId): Promise<Result<Deal, DomainError | Error>> {
    const deal = await this.dealRepository.findById(dealId);
    if (!deal) {
      return err(new DealNotFoundError(dealId));
    }
    if (deal.state !== 'PAYOUT_IN_PROGRESS') {
      return err(
        new Error(`Cannot execute payout: deal is in state ${deal.state}, expected PAYOUT_IN_PROGRESS`),
      );
    }
    if (!deal.payoutAddress) {
      return err(new Error('Cannot execute payout: no payout address on the deal'));
    }

    const wallet = await this.walletRepository.findByDealId(dealId);
    if (!wallet) {
      return err(new Error(`No deposit wallet found for deal ${dealId}`));
    }

    const blockchainService = this.blockchainServiceFactory.getService(deal.currency);
    const { fee, remainder } = deal.expectedAmount.splitByBasisPoints(deal.feeBasisPointsSnapshot);
    const feeWalletAddress = this.feeWalletProvider.getFeeWalletAddress(deal.currency);

    try {
      const result = await blockchainService.sendPayout({
        fromWallet: { address: wallet.address, encryptedPrivateKey: wallet.encryptedPrivateKey },
        outputs: [
          { address: feeWalletAddress, amount: fee },
          { address: deal.payoutAddress, amount: remainder },
        ],
      });

      deal.recordPayoutFeeTx(result.txid);
      deal.recordPayoutMainTx(result.txid);
      await this.dealRepository.save(deal);

      const now = this.clock.now();
      await this.transactionRepository.save(
        Transaction.create({
          id: asTransactionId(randomUUID()),
          dealId,
          txid: asTxId(result.txid),
          direction: 'FEE',
          status: 'PENDING',
          currency: deal.currency,
          amount: fee,
          confirmations: 0,
          detectedAt: now,
          confirmedAt: null,
        }),
      );
      await this.transactionRepository.save(
        Transaction.create({
          id: asTransactionId(randomUUID()),
          dealId,
          txid: asTxId(result.txid),
          direction: 'PAYOUT',
          status: 'PENDING',
          currency: deal.currency,
          amount: remainder,
          confirmations: 0,
          detectedAt: now,
          confirmedAt: null,
        }),
      );

      await this.auditRecorder.record({
        dealId,
        actorId: SYSTEM_ACTOR,
        action: 'PAYOUT_BROADCAST',
        metadata: {
          txid: result.txid,
          feeAmount: fee.toDecimalString(),
          remainderAmount: remainder.toDecimalString(),
        },
      });

      return ok(deal);
    } catch (error) {
      // Deliberately do NOT revert the deal's state here — it stays
      // PAYOUT_IN_PROGRESS with whatever fee/main txid fields were already
      // set (possibly none), so an admin can inspect and manually resolve
      // a stuck payout rather than the bot silently pretending funds are
      // still safely escrowed when a broadcast may have partially succeeded.
      await this.auditRecorder.record({
        dealId,
        actorId: SYSTEM_ACTOR,
        action: 'PAYOUT_BROADCAST_FAILED',
        metadata: { error: (error as Error).message },
      });
      return err(error as Error);
    }
  }
}
