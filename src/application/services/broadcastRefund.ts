import type { DealId } from '../../domain/value-objects/EntityId.js';
import { InvalidAddressError } from '../../domain/errors/DomainErrors.js';
import { Money } from '../../domain/value-objects/Money.js';
import type { IDealRepository } from '../../domain/repositories/IDealRepository.js';
import type { IWalletRepository } from '../../domain/repositories/IWalletRepository.js';
import type { ITransactionRepository } from '../../domain/repositories/ITransactionRepository.js';
import type { IBlockchainServiceFactory } from '../ports/IBlockchainServiceFactory.js';
import type { AuditRecorder } from './AuditRecorder.js';
import { err, ok, type Result } from '../../shared/result/Result.js';
import { Deal } from '../../domain/entities/Deal.js';
import type { DomainError } from '../../domain/errors/DomainErrors.js';

export interface BroadcastRefundDeps {
  dealRepository: IDealRepository;
  walletRepository: IWalletRepository;
  transactionRepository: ITransactionRepository;
  blockchainServiceFactory: IBlockchainServiceFactory;
  auditRecorder: AuditRecorder;
}

export interface BroadcastRefundParams {
  deal: Deal;
  /** Whoever authorised the money movement — an admin, or the buyer confirming their refund address. */
  actorDiscordId: string;
  reason: string;
  refundAddress: string;
  /** Audit action recorded on a successful broadcast, e.g. 'ADMIN_REFUND' / 'REFUND_COMPLETED'. */
  successAction: string;
  /** Audit action recorded if the broadcast throws, e.g. 'ADMIN_REFUND_BROADCAST_FAILED'. */
  failureAction: string;
  /** Extra key/values merged into the success audit metadata (e.g. { viaBackupAccount: true }). */
  extraAuditMetadata?: Record<string, unknown>;
  /** Side-effect run once the refund has been broadcast and audited (usually a Discord notification). */
  onBroadcast?: (dealId: DealId) => Promise<void>;
}

/**
 * The money-moving core of the seller-initiated refund flow
 * (ConfirmRefundUseCase). It mirrors AdminRefundUseCase's own broadcast logic:
 * it sends the deal's confirmed deposited balance (minus the network fee) back
 * to `refundAddress`; no escrow fee is charged on a refund.
 *
 * The CALLER is responsible for holding the per-deal mutex before calling this
 * — that catches a double-clicked confirmation. On top of that, this claims
 * REFUNDED with an atomic compare-and-swap before broadcasting (catching a
 * second bot instance, or two actors, racing the same deal), and if the
 * broadcast then fails it reverts the claim back to the pre-refund state so the
 * deal stays retryable instead of being stuck showing REFUNDED with no funds
 * actually sent.
 */
export async function broadcastRefund(
  deps: BroadcastRefundDeps,
  params: BroadcastRefundParams,
): Promise<Result<Deal, DomainError | Error>> {
  const { deal, actorDiscordId, reason, refundAddress } = params;
  const dealId = deal.id;

  const blockchainService = deps.blockchainServiceFactory.getService(deal.currency);
  if (!blockchainService.validateAddress(refundAddress)) {
    return err(new InvalidAddressError(refundAddress, deal.currency));
  }

  const wallet = await deps.walletRepository.findByDealId(dealId);
  if (!wallet) {
    return err(new Error(`No deposit wallet found for deal ${dealId}`));
  }

  const deposits = await deps.transactionRepository.findByDealId(dealId);
  const confirmedTotal = deposits
    .filter((tx) => tx.direction === 'DEPOSIT' && tx.isConfirmed())
    .reduce((sum, tx) => sum.add(tx.amount), Money.zero(deal.currency));

  if (confirmedTotal.isZero()) {
    return err(new Error('Cannot refund: no confirmed deposit found for this deal'));
  }

  // The wallet only ever holds exactly what was deposited — the chain's own
  // broadcast fee is not part of that pot. Without carving it out of the
  // refund output first, sendPayout would always fail with an
  // insufficient-balance error (see the identical fix in ExecutePayoutUseCase
  // for the standard release path).
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
    deal.refund(actorDiscordId, reason, refundAddress);
  } catch (error) {
    return err(error as DomainError);
  }

  const claimed = await deps.dealRepository.saveIfCurrentStateIs(deal, fromState);
  if (!claimed) {
    return err(
      new Error(
        'This deal was already modified by another action — refund aborted to avoid a duplicate payout.',
      ),
    );
  }

  try {
    const result = await blockchainService.sendPayout({
      fromWallet: { address: wallet.address, encryptedPrivateKey: wallet.encryptedPrivateKey },
      outputs: [{ address: refundAddress, amount: refundAmount }],
    });
    await deps.auditRecorder.record({
      dealId,
      actorId: actorDiscordId,
      action: params.successAction,
      toState: deal.state,
      metadata: {
        reason,
        refundAddress,
        amount: refundAmount.toDecimalString(),
        networkFee: networkFee.toDecimalString(),
        txid: result.txid,
        ...params.extraAuditMetadata,
      },
    });
    await params.onBroadcast?.(dealId);
    return ok(deal);
  } catch (error) {
    // We already exclusively claimed REFUNDED above (the CAS means no other
    // writer can be racing us), so it's safe to revert with a plain save: the
    // deal goes back to fromState instead of being stuck showing REFUNDED with
    // no transaction ever broadcast.
    const reverted = Deal.create({ ...deal.toProps(), state: fromState, updatedAt: new Date() });
    await deps.dealRepository.save(reverted);
    await deps.auditRecorder.record({
      dealId,
      actorId: actorDiscordId,
      action: params.failureAction,
      metadata: { error: (error as Error).message },
    });
    return err(error as Error);
  }
}
