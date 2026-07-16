import type { DealId } from '../../../domain/value-objects/EntityId.js';
import { DealNotFoundError, InvalidAddressError } from '../../../domain/errors/DomainErrors.js';
import type { IDealRepository } from '../../../domain/repositories/IDealRepository.js';
import type { IBlockchainServiceFactory } from '../../ports/IBlockchainServiceFactory.js';
import type { IDiscordNotifier } from '../../ports/IDiscordNotifier.js';
import { AuditRecorder } from '../../services/AuditRecorder.js';
import { err, ok, type Result } from '../../../shared/result/Result.js';
import type { Deal } from '../../../domain/entities/Deal.js';
import type { DomainError } from '../../../domain/errors/DomainErrors.js';

/**
 * The single highest-risk admin action in the system: redirects payout away
 * from the address the seller themselves submitted and confirmed. Requires
 * a mandatory reason and is distinctly audited as
 * ADMIN_OVERRIDE_PAYOUT_ADDRESS. Deliberately does NOT bypass the buyer's
 * own release confirmation — see Deal.overridePayoutAddressByAdmin.
 * Presentation-layer callers MUST show materially stronger warning copy for
 * this action than the standard confirm/cancel pattern.
 */
export class AdminOverridePayoutAddressUseCase {
  constructor(
    private readonly dealRepository: IDealRepository,
    private readonly blockchainServiceFactory: IBlockchainServiceFactory,
    private readonly discordNotifier: IDiscordNotifier,
    private readonly auditRecorder: AuditRecorder,
  ) {}

  async execute(
    dealId: DealId,
    adminDiscordId: string,
    newAddress: string,
    reason: string,
  ): Promise<Result<Deal, DomainError>> {
    const deal = await this.dealRepository.findById(dealId);
    if (!deal) {
      return err(new DealNotFoundError(dealId));
    }

    const blockchainService = this.blockchainServiceFactory.getService(deal.currency);
    if (!blockchainService.validateAddress(newAddress)) {
      return err(new InvalidAddressError(newAddress, deal.currency));
    }

    try {
      const fromState = deal.state;
      deal.overridePayoutAddressByAdmin(adminDiscordId, newAddress, reason);
      await this.dealRepository.save(deal);
      await this.auditRecorder.record({
        dealId,
        actorId: adminDiscordId,
        action: 'ADMIN_OVERRIDE_PAYOUT_ADDRESS',
        fromState,
        toState: deal.state,
        metadata: { newAddress, reason },
      });
      await this.discordNotifier.dealStateChanged(dealId);
      return ok(deal);
    } catch (error) {
      return err(error as DomainError);
    }
  }
}
