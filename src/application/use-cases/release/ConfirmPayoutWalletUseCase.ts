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
import type { PayoutTrigger } from '../../services/PayoutTrigger.js';

/**
 * The seller's own affirmative confirmation that the payout address they
 * submitted is correct. Only reachable once the buyer already confirmed
 * release (see ConfirmReleaseUseCase), so this is the last piece of the
 * two-party gate — it immediately triggers the actual payout via
 * PayoutTrigger rather than waiting for any further buyer action.
 */
export class ConfirmPayoutWalletUseCase {
  constructor(
    private readonly dealRepository: IDealRepository,
    private readonly discordNotifier: IDiscordNotifier,
    private readonly auditRecorder: AuditRecorder,
    private readonly payoutTrigger: PayoutTrigger,
    private readonly dealBackupRepository: IDealBackupRepository,
  ) {}

  async execute(dealId: DealId, sellerDiscordId: string): Promise<Result<Deal, DomainError | Error>> {
    const deal = await this.dealRepository.findById(dealId);
    if (!deal) {
      return err(new DealNotFoundError(dealId));
    }

    const acting = resolveActingDiscordId(
      deal,
      sellerDiscordId,
      await this.dealBackupRepository.findByDealId(dealId),
    );

    try {
      deal.confirmPayoutAddressBySeller(acting.effectiveDiscordId);
    } catch (error) {
      return err(error as DomainError);
    }

    const result = await this.payoutTrigger.execute(
      deal,
      sellerDiscordId,
      'SELLER_CONFIRMED_PAYOUT_ADDRESS',
    );
    if (!result.ok) {
      return err(result.error);
    }
    await this.discordNotifier.payoutConfirmedBySeller(dealId);
    return ok(result.value);
  }
}
