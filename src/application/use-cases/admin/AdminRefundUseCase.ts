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
import { Deal } from '../../../domain/entities/Deal.js';
import type { DomainError } from '../../../domain/errors/DomainErrors.js';
import { KeyedMutex } from '../../../shared/concurrency/KeyedMutex.js';

/**
 * Sends the deal's confirmed deposited balance back to a buyer-supplied
 * refund address — no escrow fee is charged on a refund.
 *
 * Guarded two ways against broadcasting a duplicate refund: a per-deal
 * in-process mutex (catches a double-clicked confirmation before any work
 * starts) plus an atomic compare-and-swap save that claims REFUNDED before
 * the broadcast (catches a second bot instance, or two admins, racing the
 * same deal). If the broadcast then fails, the claim is reverted back to the
 * pre-refund state so the deal stays retryable instead of being stuck
 * showing REFUNDED with no funds actually sent.
 */
export class AdminRefundUseCase {
  constructor(
    private readonly dealRepository: IDealRepository,
    private readonly walletRepository: IWalletRepository,
    private readonly transactionRepository: ITransactionRepository,
    private readonly blockchainServiceFactory: IBlockchainServiceFactory,
    private readonly discordNotifier: IDiscordNotifier,
    private readonly auditRecorder: AuditRecorder,
    private readonly mutex: KeyedMutex = new KeyedMutex(),
  ) {}

  async execute(
    dealId: DealId,
    adminDiscordId: string,
    reason: string,
    refundAddress: string,
  ): Promise<Result<Deal, DomainError | Error>> {
    return this.mutex.runExclusive(dealId, () =>
      this.executeLocked(dealId, adminDiscordId, reason, refundAddress),
    );
  }

  private async executeLocked(
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

    // The wallet only ever holds exactly what was deposited — the chain's
    // own broadcast fee is not part of that pot. Without carving it out of
    // the refund output first, sendPayout would always fail with an
    // insufficient-balance error (see the identical fix in
    // ExecutePayoutUseCase for the standard release path).
    const networkFee = await blockchainService.estimateFee({
      fromAddress: wallet.address,
      outputs: [{ address: refundAddress, amount: confirmedTotal }],
    });
    if (networkFee.smallestUnits >= confirmedTotal.smallestUnits) {
      return err(
        new Error(
          `Cannot refund: deposited amount (${confirmedTotal.toDecimalString()} ${deal.currency}) is too small to cover the network fee (${networkFee.toDecimalString()} ${deal.currency})`,
        ),
      );
    }
    const refundAmount = Money.fromSmallestUnits(
      deal.currency,
      confirmedTotal.smallestUnits - networkFee.smallestUnits,
    );

    const fromState = deal.state;
    try {
      deal.refund(adminDiscordId, reason, refundAddress);
    } catch (error) {
      return err(error as DomainError);
    }

    const claimed = await this.dealRepository.saveIfCurrentStateIs(deal, fromState);
    if (!claimed) {
      return err(
        new Error('This deal was already modified by another action — refund aborted to avoid a duplicate payout.'),
      );
    }

    try {
      const result = await blockchainService.sendPayout({
        fromWallet: { address: wallet.address, encryptedPrivateKey: wallet.encryptedPrivateKey },
        outputs: [{ address: refundAddress, amount: refundAmount }],
      });
      await this.auditRecorder.record({
        dealId,
        actorId: adminDiscordId,
        action: 'ADMIN_REFUND',
        toState: deal.state,
        metadata: {
          reason,
          refundAddress,
          amount: refundAmount.toDecimalString(),
          networkFee: networkFee.toDecimalString(),
          txid: result.txid,
        },
      });
      await this.discordNotifier.dealStateChanged(dealId);
      return ok(deal);
    } catch (error) {
      // We already exclusively claimed REFUNDED above (the CAS above means
      // no other writer can be racing us), so it's safe to revert with a
      // plain save: the deal goes back to fromState instead of being stuck
      // showing REFUNDED with no transaction ever broadcast.
      const reverted = Deal.create({ ...deal.toProps(), state: fromState, updatedAt: new Date() });
      await this.dealRepository.save(reverted);
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
