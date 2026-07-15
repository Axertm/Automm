import type { DealId } from '../../../domain/value-objects/EntityId.js';
import { DealNotFoundError } from '../../../domain/errors/DomainErrors.js';
import type { IDealRepository } from '../../../domain/repositories/IDealRepository.js';
import type { IDiscordNotifier } from '../../ports/IDiscordNotifier.js';
import { AuditRecorder } from '../../services/AuditRecorder.js';
import { err, ok, type Result } from '../../../shared/result/Result.js';
import type { Deal } from '../../../domain/entities/Deal.js';
import type { DomainError } from '../../../domain/errors/DomainErrors.js';

/** Only valid before any funds have arrived — the state machine guard rejects a funded deal, directing the caller to AdminRefundUseCase instead. */
export class AdminCancelUseCase {
  constructor(
    private readonly dealRepository: IDealRepository,
    private readonly discordNotifier: IDiscordNotifier,
    private readonly auditRecorder: AuditRecorder,
  ) {}

  async execute(dealId: DealId, adminDiscordId: string, reason: string): Promise<Result<Deal, DomainError>> {
    const deal = await this.dealRepository.findById(dealId);
    if (!deal) {
      return err(new DealNotFoundError(dealId));
    }

    try {
      const fromState = deal.state;
      deal.cancel(reason);
      await this.dealRepository.save(deal);
      await this.auditRecorder.record({
        dealId,
        actorId: adminDiscordId,
        action: 'ADMIN_CANCEL',
        fromState,
        toState: deal.state,
        metadata: { reason },
      });
      await this.discordNotifier.dealStateChanged(dealId);
      return ok(deal);
    } catch (error) {
      return err(error as DomainError);
    }
  }
}
