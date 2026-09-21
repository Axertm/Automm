import type { DealId } from '../../../domain/value-objects/EntityId.js';
import { DealNotFoundError, InvalidAddressError } from '../../../domain/errors/DomainErrors.js';
import type { IDealRepository } from '../../../domain/repositories/IDealRepository.js';
import type { IBlockchainServiceFactory } from '../../ports/IBlockchainServiceFactory.js';
import type { IDiscordNotifier } from '../../ports/IDiscordNotifier.js';
import { AuditRecorder } from '../../services/AuditRecorder.js';
import { err, ok, type Result } from '../../../shared/result/Result.js';
import type { Deal } from '../../../domain/entities/Deal.js';
import type { DomainError } from '../../../domain/errors/DomainErrors.js';
import type { PayoutTrigger } from '../../services/PayoutTrigger.js';

/**
 * The single highest-risk admin action in the system: unconditionally
 * forces a payout to an admin-chosen address, bypassing the entire
 * two-party gate — neither the seller's own address submission/confirmation
 * nor the buyer's release confirmation is required (see
 * Deal.overridePayoutAddressByAdmin). Callable from FUNDED,
 * RELEASE_REQUESTED, AWAITING_PAYOUT_CONFIRMATION, or FROZEN wrapping one of
 * those, so an admin can force-resolve a dispute without either party's
 * cooperation. Requires a mandatory reason and is distinctly audited as
 * ADMIN_OVERRIDE_PAYOUT_ADDRESS, then immediately triggers the payout via
 * PayoutTrigger. Presentation-layer callers MUST show materially stronger
 * warning copy for this action than the standard confirm/cancel pattern.
 */
export class AdminOverridePayoutAddressUseCase {
  constructor(
    private readonly dealRepository: IDealRepository,
    private readonly blockchainServiceFactory: IBlockchainServiceFactory,
    private readonly discordNotifier: IDiscordNotifier,
    private readonly auditRecorder: AuditRecorder,
    private readonly payoutTrigger: PayoutTrigger,
  ) {}

  async execute(
    dealId: DealId,
    adminDiscordId: string,
    newAddress: string,
    reason: string,
  ): Promise<Result<Deal, DomainError | Error>> {
    const deal = await this.dealRepository.findById(dealId);
    if (!deal) {
      return err(new DealNotFoundError(dealId));
    }

    const blockchainService = this.blockchainServiceFactory.getService(deal.currency);
    if (!blockchainService.validateAddress(newAddress)) {
      return err(new InvalidAddressError(newAddress, deal.currency));
    }

    const fromState = deal.state;
    try {
      deal.overridePayoutAddressByAdmin(adminDiscordId, newAddress, reason);
    } catch (error) {
      return err(error as DomainError);
    }

    // Atomically claim the override itself (fromState -> AWAITING_PAYOUT_
    // CONFIRMATION) before persisting anything, so a concurrent action on
    // the same deal (the seller submitting/confirming, another admin
    // overriding, a freeze) can't race this one — and so PayoutTrigger's own
    // claim right after has an accurate "what's actually in the DB" state to
    // compare against instead of just this in-memory object's already-
    // mutated state.
    const claimed = await this.dealRepository.saveIfCurrentStateIs(deal, fromState);
    if (!claimed) {
      return err(new Error('This deal was changed by another action just now — override aborted.'));
    }

    await this.auditRecorder.record({
      dealId,
      actorId: adminDiscordId,
      action: 'ADMIN_OVERRIDE_PAYOUT_ADDRESS',
      metadata: { newAddress, reason },
    });

    const result = await this.payoutTrigger.execute(deal, adminDiscordId, 'ADMIN_OVERRIDE_TRIGGERED_PAYOUT');
    if (!result.ok) {
      return err(result.error);
    }
    await this.discordNotifier.dealStateChanged(dealId);
    return ok(result.value);
  }
}
