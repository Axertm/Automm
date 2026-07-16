import type { DealId } from '../../../domain/value-objects/EntityId.js';
import { DealNotFoundError, InvalidAddressError } from '../../../domain/errors/DomainErrors.js';
import type { IDealRepository } from '../../../domain/repositories/IDealRepository.js';
import type { IBlockchainServiceFactory } from '../../ports/IBlockchainServiceFactory.js';
import type { IDiscordNotifier } from '../../ports/IDiscordNotifier.js';
import { AuditRecorder } from '../../services/AuditRecorder.js';
import { err, ok, type Result } from '../../../shared/result/Result.js';
import type { Deal } from '../../../domain/entities/Deal.js';
import type { DomainError } from '../../../domain/errors/DomainErrors.js';

export class SubmitPayoutAddressUseCase {
  constructor(
    private readonly dealRepository: IDealRepository,
    private readonly blockchainServiceFactory: IBlockchainServiceFactory,
    private readonly discordNotifier: IDiscordNotifier,
    private readonly auditRecorder: AuditRecorder,
  ) {}

  async execute(
    dealId: DealId,
    sellerDiscordId: string,
    address: string,
  ): Promise<Result<Deal, DomainError>> {
    const deal = await this.dealRepository.findById(dealId);
    if (!deal) {
      return err(new DealNotFoundError(dealId));
    }

    const blockchainService = this.blockchainServiceFactory.getService(deal.currency);
    if (!blockchainService.validateAddress(address)) {
      return err(new InvalidAddressError(address, deal.currency));
    }

    try {
      deal.submitPayoutAddress(sellerDiscordId, address);
      await this.dealRepository.save(deal);
      await this.auditRecorder.record({
        dealId,
        actorId: sellerDiscordId,
        action: 'PAYOUT_ADDRESS_SUBMITTED',
        metadata: { address },
      });
      await this.discordNotifier.payoutAddressSubmitted(dealId);
      return ok(deal);
    } catch (error) {
      return err(error as DomainError);
    }
  }
}
