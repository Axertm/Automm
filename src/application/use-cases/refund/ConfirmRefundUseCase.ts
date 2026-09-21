import type { DealId } from '../../../domain/value-objects/EntityId.js';
import {
  DealNotFoundError,
  InvalidTransitionError,
  PayoutConfirmationIncompleteError,
  UnauthorizedActorError,
} from '../../../domain/errors/DomainErrors.js';
import type { IDealRepository } from '../../../domain/repositories/IDealRepository.js';
import type { IWalletRepository } from '../../../domain/repositories/IWalletRepository.js';
import type { ITransactionRepository } from '../../../domain/repositories/ITransactionRepository.js';
import type { IDealBackupRepository } from '../../../domain/repositories/IDealBackupRepository.js';
import type { IBlockchainServiceFactory } from '../../ports/IBlockchainServiceFactory.js';
import type { IDiscordNotifier } from '../../ports/IDiscordNotifier.js';
import { AuditRecorder } from '../../services/AuditRecorder.js';
import { broadcastRefund } from '../../services/broadcastRefund.js';
import { resolveActingDiscordId } from '../../services/resolveActingDiscordId.js';
import { err, type Result } from '../../../shared/result/Result.js';
import type { Deal } from '../../../domain/entities/Deal.js';
import type { DomainError } from '../../../domain/errors/DomainErrors.js';
import { KeyedMutex } from '../../../shared/concurrency/KeyedMutex.js';

/**
 * The buyer's own final, fund-moving confirmation of the refund address they
 * submitted — the mirror image of ConfirmPayoutWalletUseCase. Only reachable
 * once the seller requested the refund and the buyer submitted an address, so
 * this is the last step: it immediately broadcasts the refund back to the
 * buyer via the shared broadcastRefund core.
 */
export class ConfirmRefundUseCase {
  constructor(
    private readonly dealRepository: IDealRepository,
    private readonly walletRepository: IWalletRepository,
    private readonly transactionRepository: ITransactionRepository,
    private readonly blockchainServiceFactory: IBlockchainServiceFactory,
    private readonly discordNotifier: IDiscordNotifier,
    private readonly auditRecorder: AuditRecorder,
    private readonly dealBackupRepository: IDealBackupRepository,
    private readonly mutex: KeyedMutex = new KeyedMutex(),
  ) {}

  async execute(dealId: DealId, buyerDiscordId: string): Promise<Result<Deal, DomainError | Error>> {
    return this.mutex.runExclusive(dealId, () => this.executeLocked(dealId, buyerDiscordId));
  }

  private async executeLocked(
    dealId: DealId,
    buyerDiscordId: string,
  ): Promise<Result<Deal, DomainError | Error>> {
    const deal = await this.dealRepository.findById(dealId);
    if (!deal) {
      return err(new DealNotFoundError(dealId));
    }

    const acting = resolveActingDiscordId(
      deal,
      buyerDiscordId,
      await this.dealBackupRepository.findByDealId(dealId),
    );

    // The domain refund() below carries no actor check (it's also the admin
    // break-glass path), so this is the one place the buyer is authorised for
    // the fund-moving confirmation — mirror of Deal.confirmPayoutAddressBySeller.
    if (acting.effectiveDiscordId !== deal.buyerDiscordId) {
      return err(new UnauthorizedActorError('confirmRefund', 'BUYER'));
    }
    if (deal.state !== 'REFUND_REQUESTED') {
      return err(new InvalidTransitionError(deal.state, 'REFUNDED'));
    }
    const refundAddress = deal.refundAddress;
    if (!refundAddress) {
      return err(new PayoutConfirmationIncompleteError('a submitted refund address'));
    }

    return broadcastRefund(
      {
        dealRepository: this.dealRepository,
        walletRepository: this.walletRepository,
        transactionRepository: this.transactionRepository,
        blockchainServiceFactory: this.blockchainServiceFactory,
        auditRecorder: this.auditRecorder,
      },
      {
        deal,
        actorDiscordId: buyerDiscordId,
        reason: 'Seller refunded the buyer',
        refundAddress,
        successAction: 'REFUND_COMPLETED',
        failureAction: 'REFUND_BROADCAST_FAILED',
        extraAuditMetadata: acting.viaBackup ? { viaBackupAccount: true } : undefined,
        onBroadcast: (id) => this.discordNotifier.refundCompleted(id),
      },
    );
  }
}
