import type { DealId } from '../../../domain/value-objects/EntityId.js';
import { DealNotFoundError } from '../../../domain/errors/DomainErrors.js';
import type { IDealRepository } from '../../../domain/repositories/IDealRepository.js';
import type { IDiscordNotifier } from '../../ports/IDiscordNotifier.js';
import { AuditRecorder } from '../../services/AuditRecorder.js';
import { err, ok, type Result } from '../../../shared/result/Result.js';
import type { Deal } from '../../../domain/entities/Deal.js';
import type { DomainError } from '../../../domain/errors/DomainErrors.js';

/** The seller's affirmative confirmation that the payout address they submitted is correct. */
export class ConfirmPayoutWalletUseCase {
  constructor(
    private readonly dealRepository: IDealRepository,
    private readonly discordNotifier: IDiscordNotifier,
    private readonly auditRecorder: AuditRecorder,
  ) {}

  async execute(dealId: DealId, sellerDiscordId: string): Promise<Result<Deal, DomainError>> {
    const deal = await this.dealRepository.findById(dealId);
    if (!deal) {
      return err(new DealNotFoundError(dealId));
    }

    try {
      const fromState = deal.state;
      deal.confirmPayoutAddressBySeller(sellerDiscordId);
      await this.dealRepository.save(deal);
      await this.auditRecorder.record({
        dealId,
        actorId: sellerDiscordId,
        action: 'PAYOUT_ADDRESS_CONFIRMED_BY_SELLER',
        fromState,
        toState: deal.state,
      });
      await this.discordNotifier.payoutConfirmedBySeller(dealId);
      return ok(deal);
    } catch (error) {
      return err(error as DomainError);
    }
  }
}
