import type { DealId } from '../../../domain/value-objects/EntityId.js';
import { DealNotFoundError } from '../../../domain/errors/DomainErrors.js';
import type { IDealRepository } from '../../../domain/repositories/IDealRepository.js';
import { AuditRecorder } from '../../services/AuditRecorder.js';
import { err, type Result } from '../../../shared/result/Result.js';
import { KeyedMutex } from '../../../shared/concurrency/KeyedMutex.js';
import type { Deal } from '../../../domain/entities/Deal.js';
import type { DomainError } from '../../../domain/errors/DomainErrors.js';
import type { ExecutePayoutUseCase } from '../release/ExecutePayoutUseCase.js';

/**
 * Re-attempts broadcasting a deal stuck in PAYOUT_IN_PROGRESS with no
 * (or an unconfirmed/stalled) payout transaction — e.g. the original
 * broadcast failed (network error, provider outage) and nothing ever
 * retries that automatically, since ConfirmPayoutTransactionsUseCase only
 * polls for confirmation of an already-recorded txid. ExecutePayoutUseCase
 * itself is what's re-invoked here; it's naturally safe to retry because it
 * derives outputs from the wallet's actual on-chain balance at call time —
 * if a prior attempt already sent the funds, the wallet is empty (or has
 * only dust) and the retry fails with an insufficient-balance error rather
 * than double-sending. Shares a KeyedMutex instance with PayoutTrigger so a
 * retry can never race a payout that's concurrently in flight for the same
 * deal.
 */
export class AdminRetryPayoutUseCase {
  constructor(
    private readonly dealRepository: IDealRepository,
    private readonly executePayoutUseCase: ExecutePayoutUseCase,
    private readonly auditRecorder: AuditRecorder,
    private readonly mutex: KeyedMutex = new KeyedMutex(),
  ) {}

  async execute(dealId: DealId, adminDiscordId: string): Promise<Result<Deal, DomainError | Error>> {
    return this.mutex.runExclusive(dealId, async () => {
      const deal = await this.dealRepository.findById(dealId);
      if (!deal) {
        return err(new DealNotFoundError(dealId));
      }
      if (deal.state !== 'PAYOUT_IN_PROGRESS') {
        return err(
          new Error(`Cannot retry payout: deal is in state ${deal.state}, expected PAYOUT_IN_PROGRESS`),
        );
      }

      await this.auditRecorder.record({
        dealId,
        actorId: adminDiscordId,
        action: 'ADMIN_RETRY_PAYOUT',
      });

      return this.executePayoutUseCase.execute(dealId);
    });
  }
}
