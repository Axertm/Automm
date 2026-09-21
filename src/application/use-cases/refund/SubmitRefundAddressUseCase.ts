import type { DealId } from '../../../domain/value-objects/EntityId.js';
import { DealNotFoundError, InvalidAddressError } from '../../../domain/errors/DomainErrors.js';
import type { IDealRepository } from '../../../domain/repositories/IDealRepository.js';
import type { IDealBackupRepository } from '../../../domain/repositories/IDealBackupRepository.js';
import type { IBlockchainServiceFactory } from '../../ports/IBlockchainServiceFactory.js';
import type { IDiscordNotifier } from '../../ports/IDiscordNotifier.js';
import { AuditRecorder } from '../../services/AuditRecorder.js';
import { resolveActingDiscordId } from '../../services/resolveActingDiscordId.js';
import { err, ok, type Result } from '../../../shared/result/Result.js';
import type { Deal } from '../../../domain/entities/Deal.js';
import type { DomainError } from '../../../domain/errors/DomainErrors.js';

/**
 * The buyer's submission of the address their refund should be sent to — the
 * mirror image of SubmitPayoutAddressUseCase, only reachable once the seller
 * has requested a refund. Re-callable to correct a mistaken address before the
 * buyer's final confirmation; no funds move here.
 */
export class SubmitRefundAddressUseCase {
  constructor(
    private readonly dealRepository: IDealRepository,
    private readonly blockchainServiceFactory: IBlockchainServiceFactory,
    private readonly discordNotifier: IDiscordNotifier,
    private readonly auditRecorder: AuditRecorder,
    private readonly dealBackupRepository: IDealBackupRepository,
  ) {}

  async execute(dealId: DealId, buyerDiscordId: string, address: string): Promise<Result<Deal, DomainError>> {
    const deal = await this.dealRepository.findById(dealId);
    if (!deal) {
      return err(new DealNotFoundError(dealId));
    }

    const blockchainService = this.blockchainServiceFactory.getService(deal.currency);
    if (!blockchainService.validateAddress(address)) {
      return err(new InvalidAddressError(address, deal.currency));
    }

    const acting = resolveActingDiscordId(
      deal,
      buyerDiscordId,
      await this.dealBackupRepository.findByDealId(dealId),
    );

    try {
      deal.submitRefundAddress(acting.effectiveDiscordId, address);
      await this.dealRepository.save(deal);
      await this.auditRecorder.record({
        dealId,
        actorId: buyerDiscordId,
        action: 'REFUND_ADDRESS_SUBMITTED',
        metadata: { address, ...(acting.viaBackup ? { viaBackupAccount: true } : {}) },
      });
      await this.discordNotifier.refundAddressSubmitted(dealId);
      return ok(deal);
    } catch (error) {
      return err(error as DomainError);
    }
  }
}
