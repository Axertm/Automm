import type { DealActorRole } from '../../../domain/entities/Deal.js';
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
 * The seller's own request to refund the buyer — the mirror image of
 * RequestReleaseUseCase. It only opens the refund flow (FUNDED →
 * REFUND_REQUESTED); no funds move until the buyer submits and confirms an
 * address to receive the refund. An ADMIN may drive this on the seller's
 * behalf.
 */
export class RequestRefundUseCase {
  constructor(
    private readonly dealRepository: IDealRepository,
    private readonly discordNotifier: IDiscordNotifier,
    private readonly auditRecorder: AuditRecorder,
    private readonly dealBackupRepository: IDealBackupRepository,
  ) {}

  async execute(
    dealId: DealId,
    actorDiscordId: string,
    actorRole: DealActorRole,
  ): Promise<Result<Deal, DomainError>> {
    const deal = await this.dealRepository.findById(dealId);
    if (!deal) {
      return err(new DealNotFoundError(dealId));
    }

    // Only SELLER is ever checked against the deal's real party id
    // (assertActorIsSeller) — ADMIN bypasses that check entirely, so backup
    // resolution is only relevant for the SELLER path.
    const acting =
      actorRole === 'SELLER'
        ? resolveActingDiscordId(deal, actorDiscordId, await this.dealBackupRepository.findByDealId(dealId))
        : { effectiveDiscordId: actorDiscordId, viaBackup: false };

    try {
      const fromState = deal.state;
      deal.requestRefund(acting.effectiveDiscordId, actorRole);
      await this.dealRepository.save(deal);
      await this.auditRecorder.record({
        dealId,
        actorId: actorDiscordId,
        action: actorRole === 'ADMIN' ? 'ADMIN_FORCE_REFUND_REQUEST' : 'REFUND_REQUESTED',
        fromState,
        toState: deal.state,
        metadata: acting.viaBackup ? { viaBackupAccount: true } : undefined,
      });
      await this.discordNotifier.refundRequested(dealId);
      return ok(deal);
    } catch (error) {
      return err(error as DomainError);
    }
  }
}
