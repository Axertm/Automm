import { DealNotFoundError } from '../../../domain/errors/DomainErrors.js';
import type { DealId } from '../../../domain/value-objects/EntityId.js';
import type { IDealRepository } from '../../../domain/repositories/IDealRepository.js';
import type { IBlockchainServiceFactory } from '../../ports/IBlockchainServiceFactory.js';
import type { IDiscordNotifier } from '../../ports/IDiscordNotifier.js';
import { AuditRecorder, SYSTEM_ACTOR } from '../../services/AuditRecorder.js';
import { err, ok, type Result } from '../../../shared/result/Result.js';
import type { Deal } from '../../../domain/entities/Deal.js';
import type { DomainError } from '../../../domain/errors/DomainErrors.js';

/** Polls the fee + main payout transactions of a PAYOUT_IN_PROGRESS deal and advances it to COMPLETED once both are confirmed. */
export class ConfirmPayoutTransactionsUseCase {
  constructor(
    private readonly dealRepository: IDealRepository,
    private readonly blockchainServiceFactory: IBlockchainServiceFactory,
    private readonly discordNotifier: IDiscordNotifier,
    private readonly auditRecorder: AuditRecorder,
  ) {}

  async execute(dealId: DealId): Promise<Result<Deal, DomainError>> {
    const deal = await this.dealRepository.findById(dealId);
    if (!deal) {
      return err(new DealNotFoundError(dealId));
    }
    if (deal.state !== 'PAYOUT_IN_PROGRESS') {
      return ok(deal);
    }
    if (!deal.payoutFeeTxId || !deal.payoutMainTxId) {
      return ok(deal);
    }

    const blockchainService = this.blockchainServiceFactory.getService(deal.currency);
    // Fee and main are always the same on-chain transaction (ExecutePayoutUseCase
    // sends both outputs in a single broadcast) — dedupe to one status check
    // per poll instead of two identical ones, which matters now that this
    // runs on a fast fixed interval rather than the slower deposit-scan cron.
    const uniqueTxIds = [...new Set([deal.payoutFeeTxId, deal.payoutMainTxId])];
    const statuses = await Promise.all(
      uniqueTxIds.map((txid) => blockchainService.getTransactionStatus(txid)),
    );

    if (!statuses.every((status) => status.confirmed)) {
      return ok(deal);
    }

    deal.markCompleted();
    await this.dealRepository.save(deal);
    await this.auditRecorder.record({
      dealId,
      actorId: SYSTEM_ACTOR,
      action: 'PAYOUT_COMPLETED',
      fromState: 'PAYOUT_IN_PROGRESS',
      toState: 'COMPLETED',
    });
    await this.discordNotifier.payoutCompleted(dealId);

    return ok(deal);
  }
}
