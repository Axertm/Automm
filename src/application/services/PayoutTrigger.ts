import type { IDealRepository } from '../../domain/repositories/IDealRepository.js';
import type { Deal } from '../../domain/entities/Deal.js';
import type { DomainError } from '../../domain/errors/DomainErrors.js';
import { err, ok, type Result } from '../../shared/result/Result.js';
import { KeyedMutex } from '../../shared/concurrency/KeyedMutex.js';
import { AuditRecorder } from './AuditRecorder.js';
import type { ExecutePayoutUseCase } from '../use-cases/release/ExecutePayoutUseCase.js';

/**
 * Whichever action completes the deal's two-party release gate — the
 * seller's own confirmPayoutAddressBySeller(), or an admin override that
 * substitutes for it — calls this to attempt startPayout() and, if it
 * succeeds, immediately broadcast via ExecutePayoutUseCase. The buyer's own
 * confirmation always happens earlier (confirmReleaseByBuyer moves
 * RELEASE_REQUESTED -> AWAITING_PAYOUT_CONFIRMATION) and never reaches this
 * class — see ConfirmReleaseUseCase.
 *
 * Guarded two ways against broadcasting a duplicate payout: a per-deal
 * in-process mutex (catches a double-clicked confirmation before any work
 * starts) plus an atomic compare-and-swap save of the
 * AWAITING_PAYOUT_CONFIRMATION -> PAYOUT_IN_PROGRESS transition (catches a
 * second bot instance, or two racing confirmations, from another process).
 */
export class PayoutTrigger {
  constructor(
    private readonly dealRepository: IDealRepository,
    private readonly executePayoutUseCase: ExecutePayoutUseCase,
    private readonly auditRecorder: AuditRecorder,
    private readonly mutex: KeyedMutex = new KeyedMutex(),
  ) {}

  /**
   * `deal` must already carry the in-memory mutation (seller confirmation or
   * admin override) that's meant to complete the gate — not yet persisted.
   * That mutation and the PAYOUT_IN_PROGRESS transition are saved together,
   * atomically, in one compare-and-swap write.
   */
  async execute(deal: Deal, actorId: string, action: string): Promise<Result<Deal, DomainError | Error>> {
    return this.mutex.runExclusive(deal.id, async () => {
      const fromState = deal.state;
      try {
        deal.startPayout();
      } catch (error) {
        return err(error as DomainError);
      }

      const claimed = await this.dealRepository.saveIfCurrentStateIs(deal, fromState);
      if (!claimed) {
        return err(
          new Error('This deal was already confirmed and is being processed — not submitting again.'),
        );
      }

      await this.auditRecorder.record({
        dealId: deal.id,
        actorId,
        action,
        fromState,
        toState: 'PAYOUT_IN_PROGRESS',
      });

      const payoutResult = await this.executePayoutUseCase.execute(deal.id);
      if (!payoutResult.ok) {
        return err(payoutResult.error);
      }
      return ok(payoutResult.value);
    });
  }
}
