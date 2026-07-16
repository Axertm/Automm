import type { DealId } from '../../../domain/value-objects/EntityId.js';
import { DealNotFoundError, InvalidAddressError } from '../../../domain/errors/DomainErrors.js';
import { Money } from '../../../domain/value-objects/Money.js';
import type { IDealRepository } from '../../../domain/repositories/IDealRepository.js';
import type { IWalletRepository } from '../../../domain/repositories/IWalletRepository.js';
import type { ITransactionRepository } from '../../../domain/repositories/ITransactionRepository.js';
import type { IBlockchainServiceFactory } from '../../ports/IBlockchainServiceFactory.js';
import type { IDiscordNotifier } from '../../ports/IDiscordNotifier.js';
import { AuditRecorder } from '../../services/AuditRecorder.js';
import { err, ok, type Result } from '../../../shared/result/Result.js';
import type { Deal } from '../../../domain/entities/Deal.js';
import type { DomainError } from '../../../domain/errors/DomainErrors.js';

/** Sends the deal's confirmed deposited balance back to a buyer-supplied refund address — no escrow fee is charged on a refund. */
export class AdminRefundUseCase {
  constructor(
    private readonly dealRepository: IDealRepository,
    private readonly walletRepository: IWalletRepository,
    private readonly transactionRepository: ITransactionRepository,
    private readonly blockchainServiceFactory: IBlockchainServiceFactory,
    private readonly discordNotifier: IDiscordNotifier,
    private readonly auditRecorder: AuditRecorder,
  ) {}

  async execute(
    dealId: DealId,
    adminDiscordId: string,
    reason: string,
    refundAddress: string,
  ): Promise<Result<Deal, DomainError | Error>> {
    const deal = await this.dealRepository.findById(dealId);
    if (!deal) {
      return err(new DealNotFoundError(dealId));
    }

    const blockchainService = this.blockchainServiceFactory.getService(deal.currency);
    if (!blockchainService.validateAddress(refundAddress)) {
      return err(new InvalidAddressError(refundAddress, deal.currency));
    }

    const wallet = await this.walletRepository.findByDealId(dealId);
    if (!wallet) {
      return err(new Error(`No deposit wallet found for deal ${dealId}`));
    }

    const deposits = await this.transactionRepository.findByDealId(dealId);
    const confirmedTotal = deposits
      .filter((tx) => tx.direction === 'DEPOSIT' && tx.isConfirmed())
      .reduce((sum, tx) => sum.add(tx.amount), Money.zero(deal.currency));

    if (confirmedTotal.isZero()) {
      return err(new Error('Cannot refund: no confirmed deposit found for this deal'));
    }

    try {
      deal.refund(adminDiscordId, reason, refundAddress);
    } catch (error) {
      return err(error as DomainError);
    }

    try {
      const result = await blockchainService.sendPayout({
        fromWallet: { address: wallet.address, encryptedPrivateKey: wallet.encryptedPrivateKey },
        outputs: [{ address: refundAddress, amount: confirmedTotal }],
      });
      await this.dealRepository.save(deal);
      await this.auditRecorder.record({
        dealId,
        actorId: adminDiscordId,
        action: 'ADMIN_REFUND',
        toState: deal.state,
        metadata: { reason, refundAddress, amount: confirmedTotal.toDecimalString(), txid: result.txid },
      });
      await this.discordNotifier.dealStateChanged(dealId);
      return ok(deal);
    } catch (error) {
      await this.auditRecorder.record({
        dealId,
        actorId: adminDiscordId,
        action: 'ADMIN_REFUND_BROADCAST_FAILED',
        metadata: { error: (error as Error).message },
      });
      return err(error as Error);
    }
  }
}
