import type { DealId } from '../../../domain/value-objects/EntityId.js';
import { DealNotFoundError } from '../../../domain/errors/DomainErrors.js';
import type { IDealRepository } from '../../../domain/repositories/IDealRepository.js';
import type { IWalletRepository } from '../../../domain/repositories/IWalletRepository.js';
import type { ITransactionRepository } from '../../../domain/repositories/ITransactionRepository.js';
import type { IBlockchainServiceFactory } from '../../ports/IBlockchainServiceFactory.js';
import type { IDiscordNotifier } from '../../ports/IDiscordNotifier.js';
import { AuditRecorder } from '../../services/AuditRecorder.js';
import { broadcastRefund } from '../../services/broadcastRefund.js';
import { err, type Result } from '../../../shared/result/Result.js';
import { Deal } from '../../../domain/entities/Deal.js';
import type { DomainError } from '../../../domain/errors/DomainErrors.js';
import { KeyedMutex } from '../../../shared/concurrency/KeyedMutex.js';

/**
 * Sends the deal's confirmed deposited balance back to a buyer-supplied
 * refund address — no escrow fee is charged on a refund.
 *
 * The money-moving core (fee carve-out, atomic REFUNDED claim, broadcast and
 * revert-on-failure) lives in broadcastRefund, shared with the
 * seller-initiated refund button. This use case adds the admin-facing shell:
 * the per-deal mutex that catches a double-clicked confirmation before any
 * work starts, plus the Discord status refresh.
 */
export class AdminRefundUseCase {
  constructor(
    private readonly dealRepository: IDealRepository,
    private readonly walletRepository: IWalletRepository,
    private readonly transactionRepository: ITransactionRepository,
    private readonly blockchainServiceFactory: IBlockchainServiceFactory,
    private readonly discordNotifier: IDiscordNotifier,
    private readonly auditRecorder: AuditRecorder,
    private readonly mutex: KeyedMutex = new KeyedMutex(),
  ) {}

  async execute(
    dealId: DealId,
    adminDiscordId: string,
    reason: string,
    refundAddress: string,
  ): Promise<Result<Deal, DomainError | Error>> {
    return this.mutex.runExclusive(dealId, () =>
      this.executeLocked(dealId, adminDiscordId, reason, refundAddress),
    );
  }

  private async executeLocked(
    dealId: DealId,
    adminDiscordId: string,
    reason: string,
    refundAddress: string,
  ): Promise<Result<Deal, DomainError | Error>> {
    const deal = await this.dealRepository.findById(dealId);
    if (!deal) {
      return err(new DealNotFoundError(dealId));
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
        actorDiscordId: adminDiscordId,
        reason,
        refundAddress,
        successAction: 'ADMIN_REFUND',
        failureAction: 'ADMIN_REFUND_BROADCAST_FAILED',
        onBroadcast: (id) => this.discordNotifier.dealStateChanged(id),
      },
    );
  }
}
