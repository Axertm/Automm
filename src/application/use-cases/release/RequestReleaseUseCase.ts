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

export class RequestReleaseUseCase {
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

    // Only BUYER is ever checked against the deal's real party id
    // (assertActorIsBuyer) — ADMIN bypasses that check entirely, so backup
    // resolution is only relevant for the BUYER path.
    const acting =
      actorRole === 'BUYER'
        ? resolveActingDiscordId(deal, actorDiscordId, await this.dealBackupRepository.findByDealId(dealId))
        : { effectiveDiscordId: actorDiscordId, viaBackup: false };

    try {
      const fromState = deal.state;
      deal.requestRelease(acting.effectiveDiscordId, actorRole);
      await this.dealRepository.save(deal);
      await this.auditRecorder.record({
        dealId,
        actorId: actorDiscordId,
        action: actorRole === 'ADMIN' ? 'ADMIN_FORCE_RELEASE_REQUEST' : 'RELEASE_REQUESTED',
        fromState,
        toState: deal.state,
        metadata: acting.viaBackup ? { viaBackupAccount: true } : undefined,
      });
      await this.discordNotifier.releaseRequested(dealId);
      return ok(deal);
    } catch (error) {
      return err(error as DomainError);
    }
  }
}
