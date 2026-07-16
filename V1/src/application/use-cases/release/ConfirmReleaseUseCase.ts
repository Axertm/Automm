import type { DealId } from '../../../domain/value-objects/EntityId.js';
import { DealNotFoundError } from '../../../domain/errors/DomainErrors.js';
import type { IDealRepository } from '../../../domain/repositories/IDealRepository.js';
import { AuditRecorder } from '../../services/AuditRecorder.js';
import { err, ok, type Result } from '../../../shared/result/Result.js';
import type { Deal } from '../../../domain/entities/Deal.js';
import type { DomainError } from '../../../domain/errors/DomainErrors.js';
import type { ExecutePayoutUseCase } from './ExecutePayoutUseCase.js';

/**
 * The buyer's final, independent confirmation. Both confirmation flags are
 * required before startPayout() will succeed — enforced inside the Deal
 * entity itself, not just here — so this is the only place payout actually
 * begins executing.
 */
export class ConfirmReleaseUseCase {
  constructor(
    private readonly dealRepository: IDealRepository,
    private readonly executePayoutUseCase: ExecutePayoutUseCase,
    private readonly auditRecorder: AuditRecorder,
  ) {}

  async execute(dealId: DealId, buyerDiscordId: string): Promise<Result<Deal, DomainError | Error>> {
    const deal = await this.dealRepository.findById(dealId);
    if (!deal) {
      return err(new DealNotFoundError(dealId));
    }

    try {
      deal.confirmReleaseByBuyer(buyerDiscordId);
      deal.startPayout();
      await this.dealRepository.save(deal);
      await this.auditRecorder.record({
        dealId,
        actorId: buyerDiscordId,
        action: 'BUYER_CONFIRMED_RELEASE',
        fromState: 'AWAITING_PAYOUT_CONFIRMATION',
        toState: 'PAYOUT_IN_PROGRESS',
      });
    } catch (error) {
      return err(error as DomainError);
    }

    const payoutResult = await this.executePayoutUseCase.execute(dealId);
    if (!payoutResult.ok) {
      return err(payoutResult.error);
    }
    return ok(payoutResult.value);
  }
}
