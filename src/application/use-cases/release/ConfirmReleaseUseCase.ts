import type { DealId } from '../../../domain/value-objects/EntityId.js';
import { DealNotFoundError } from '../../../domain/errors/DomainErrors.js';
import type { IDealRepository } from '../../../domain/repositories/IDealRepository.js';
import type { IDealBackupRepository } from '../../../domain/repositories/IDealBackupRepository.js';
import type { IDiscordNotifier } from '../../ports/IDiscordNotifier.js';
import { AuditRecorder } from '../../services/AuditRecorder.js';
import { resolveActingDiscordId } from '../../services/resolveActingDiscordId.js';
import { err, ok, type Result } from '../../../shared/result/Result.js';
import type { Deal } from '../../../domain/entities/Deal.js';
import type { DomainError } from '../../../domain/errors/DomainErrors.js';

/**
 * The buyer's own, independent confirmation that funds should be released —
 * given BEFORE the seller is allowed to submit a payout address (enforced
 * inside Deal.submitPayoutAddress, which requires
 * state === AWAITING_PAYOUT_CONFIRMATION, only reachable via this method).
 * No funds move here: this just opens the gate for the seller's side. The
 * actual payout is triggered later, once the seller confirms their address
 * — see PayoutTrigger, used by ConfirmPayoutWalletUseCase and
 * AdminOverridePayoutAddressUseCase.
 */
export class ConfirmReleaseUseCase {
  constructor(
    private readonly dealRepository: IDealRepository,
    private readonly discordNotifier: IDiscordNotifier,
    private readonly auditRecorder: AuditRecorder,
    private readonly dealBackupRepository: IDealBackupRepository,
  ) {}

  async execute(dealId: DealId, buyerDiscordId: string): Promise<Result<Deal, DomainError>> {
    const deal = await this.dealRepository.findById(dealId);
    if (!deal) {
      return err(new DealNotFoundError(dealId));
    }

    const acting = resolveActingDiscordId(
      deal,
      buyerDiscordId,
      await this.dealBackupRepository.findByDealId(dealId),
    );

    try {
      const fromState = deal.state;
      deal.confirmReleaseByBuyer(acting.effectiveDiscordId);
      await this.dealRepository.save(deal);
      await this.auditRecorder.record({
        dealId,
        actorId: buyerDiscordId,
        action: 'BUYER_CONFIRMED_RELEASE',
        fromState,
        toState: deal.state,
        metadata: acting.viaBackup ? { viaBackupAccount: true } : undefined,
      });
      await this.discordNotifier.releaseConfirmedByBuyer(dealId);
      return ok(deal);
    } catch (error) {
      return err(error as DomainError);
    }
  }
}
