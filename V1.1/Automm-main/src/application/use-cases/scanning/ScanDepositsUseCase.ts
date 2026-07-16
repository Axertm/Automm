import { randomUUID } from 'node:crypto';
import { Transaction } from '../../../domain/entities/Transaction.js';
import { Money } from '../../../domain/value-objects/Money.js';
import { asTransactionId, asTxId, type DealId } from '../../../domain/value-objects/EntityId.js';
import { DealNotFoundError } from '../../../domain/errors/DomainErrors.js';
import type { IDealRepository } from '../../../domain/repositories/IDealRepository.js';
import type { IWalletRepository } from '../../../domain/repositories/IWalletRepository.js';
import type { ITransactionRepository } from '../../../domain/repositories/ITransactionRepository.js';
import type { IBlockchainServiceFactory } from '../../ports/IBlockchainServiceFactory.js';
import type { IDiscordNotifier } from '../../ports/IDiscordNotifier.js';
import type { ConfirmationRequirement } from '../../ports/IBlockchainService.js';
import { AuditRecorder, SYSTEM_ACTOR } from '../../services/AuditRecorder.js';
import type { IClock } from '../../ports/IClock.js';
import { err, ok, type Result } from '../../../shared/result/Result.js';
import type { Deal } from '../../../domain/entities/Deal.js';
import type { DomainError } from '../../../domain/errors/DomainErrors.js';

export function requiredConfirmationCount(requirement: ConfirmationRequirement): number {
  if (requirement.kind === 'blocks') return requirement.count;
  return requirement.level === 'finalized' ? Number.MAX_SAFE_INTEGER : 1;
}

const SCANNABLE_STATES = ['AWAITING_DEPOSIT', 'PARTIALLY_FUNDED'] as const;

export interface ScanDepositsOutput {
  deal: Deal;
  newTransactionsObserved: number;
}

export class ScanDepositsUseCase {
  constructor(
    private readonly dealRepository: IDealRepository,
    private readonly walletRepository: IWalletRepository,
    private readonly transactionRepository: ITransactionRepository,
    private readonly blockchainServiceFactory: IBlockchainServiceFactory,
    private readonly discordNotifier: IDiscordNotifier,
    private readonly auditRecorder: AuditRecorder,
    private readonly clock: IClock,
  ) {}

  async execute(dealId: DealId): Promise<Result<ScanDepositsOutput, DomainError>> {
    const deal = await this.dealRepository.findById(dealId);
    if (!deal) {
      return err(new DealNotFoundError(dealId));
    }
    if (!(SCANNABLE_STATES as readonly string[]).includes(deal.state)) {
      return ok({ deal, newTransactionsObserved: 0 });
    }

    const wallet = await this.walletRepository.findByDealId(dealId);
    if (!wallet) {
      return ok({ deal, newTransactionsObserved: 0 });
    }

    const blockchainService = this.blockchainServiceFactory.getService(deal.currency);
    const requiredConfirmations = requiredConfirmationCount(blockchainService.getRequiredConfirmations());
    const observed = await blockchainService.getIncomingTransactions(wallet.address);

    let newTransactionsObserved = 0;
    for (const obs of observed) {
      const txId = asTxId(obs.txid);
      const existing = await this.transactionRepository.findByDealAndTxid(dealId, txId, 'DEPOSIT');
      if (existing) {
        existing.updateConfirmations(obs.confirmations, requiredConfirmations);
        await this.transactionRepository.save(existing);
      } else {
        const transaction = Transaction.create({
          id: asTransactionId(randomUUID()),
          dealId,
          txid: txId,
          direction: 'DEPOSIT',
          status: obs.confirmations >= requiredConfirmations ? 'CONFIRMED' : 'PENDING',
          currency: deal.currency,
          amount: obs.amount,
          confirmations: obs.confirmations,
          detectedAt: this.clock.now(),
          confirmedAt: obs.confirmations >= requiredConfirmations ? this.clock.now() : null,
        });
        await this.transactionRepository.save(transaction);
        newTransactionsObserved += 1;
        await this.discordNotifier.depositDetected(dealId, obs.txid, obs.confirmations);
      }
    }

    const allDeposits = await this.transactionRepository.findByDealId(dealId);
    const confirmedTotal = allDeposits
      .filter((tx) => tx.direction === 'DEPOSIT' && tx.isConfirmed())
      .reduce((sum, tx) => sum.add(tx.amount), Money.zero(deal.currency));

    const fromState = deal.state;
    deal.recordDeposit(confirmedTotal);
    if (deal.state !== fromState) {
      await this.dealRepository.save(deal);
      await this.auditRecorder.record({
        dealId,
        actorId: SYSTEM_ACTOR,
        action: 'DEPOSIT_SCAN_STATE_CHANGE',
        fromState,
        toState: deal.state,
        metadata: { confirmedTotal: confirmedTotal.toDecimalString() },
      });
      if (deal.state === 'FUNDED') {
        await this.discordNotifier.dealFunded(dealId);
      } else {
        await this.discordNotifier.dealStateChanged(dealId);
      }
    }

    return ok({ deal, newTransactionsObserved });
  }
}
