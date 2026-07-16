import cron, { type ScheduledTask } from 'node-cron';
import type { Logger } from 'pino';
import type { IDealRepository } from '../../domain/repositories/IDealRepository.js';
import type { ScanDepositsUseCase } from '../../application/use-cases/scanning/ScanDepositsUseCase.js';
import type { ConfirmPayoutTransactionsUseCase } from '../../application/use-cases/scanning/ConfirmPayoutTransactionsUseCase.js';
import { PAYOUT_CONFIRM_INTERVAL_MS, SCAN_CONCURRENCY_PER_CHAIN } from '../../config/constants.js';
import type { DealId } from '../../domain/value-objects/EntityId.js';
import type { Currency } from '../../domain/value-objects/Currency.js';

async function runWithConcurrencyLimit<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  async function next(): Promise<void> {
    const current = index;
    index += 1;
    if (current >= items.length) return;
    await worker(items[current]!);
    await next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
}

/**
 * Drives ScanDepositsUseCase on the configurable DEPOSIT_SCAN_CRON schedule
 * (default every 2 minutes) and ConfirmPayoutTransactionsUseCase on its own
 * much shorter fixed interval (PAYOUT_CONFIRM_INTERVAL_MS) — once a payout
 * is broadcast someone is actively watching for it to finish, so it's worth
 * polling that read-only confirmation status far more often than incoming
 * deposits need to be scanned for. Each loop guards against overlapping runs
 * independently, batches deals by currency into independently
 * concurrency-limited queues so one chain's slowness never blocks the other,
 * and isolates per-deal failures so one bad deal doesn't abort the whole tick.
 */
export class DepositScanScheduler {
  private depositTask: ScheduledTask | null = null;
  private payoutConfirmTimer: ReturnType<typeof setInterval> | null = null;
  private isDepositScanRunning = false;
  private isPayoutConfirmRunning = false;

  constructor(
    private readonly dealRepository: IDealRepository,
    private readonly scanDepositsUseCase: ScanDepositsUseCase,
    private readonly confirmPayoutTransactionsUseCase: ConfirmPayoutTransactionsUseCase,
    private readonly logger: Logger,
    private readonly cronExpression: string,
  ) {}

  start(): void {
    this.depositTask = cron.schedule(this.cronExpression, () => {
      void this.depositTick();
    });
    this.logger.info({ cronExpression: this.cronExpression }, 'deposit_scan_scheduler_started');

    this.payoutConfirmTimer = setInterval(() => {
      void this.payoutConfirmTick();
    }, PAYOUT_CONFIRM_INTERVAL_MS);
    this.logger.info(
      { intervalMs: PAYOUT_CONFIRM_INTERVAL_MS },
      'payout_confirm_scheduler_started',
    );
  }

  stop(): void {
    this.depositTask?.stop();
    this.depositTask = null;
    if (this.payoutConfirmTimer) clearInterval(this.payoutConfirmTimer);
    this.payoutConfirmTimer = null;
  }

  async depositTick(): Promise<void> {
    if (this.isDepositScanRunning) {
      this.logger.warn('scan_cycle_skipped_overlap');
      return;
    }
    this.isDepositScanRunning = true;
    try {
      const depositCandidates = await this.dealRepository.findByStates([
        'AWAITING_DEPOSIT',
        'PARTIALLY_FUNDED',
      ]);
      await this.scanByCurrency(
        depositCandidates.map((d) => ({ id: d.id, currency: d.currency })),
        (dealId) => this.scanDepositsUseCase.execute(dealId).then(() => undefined),
      );
    } catch (error) {
      this.logger.error({ err: (error as Error).message }, 'scan_cycle_failed');
    } finally {
      this.isDepositScanRunning = false;
    }
  }

  async payoutConfirmTick(): Promise<void> {
    if (this.isPayoutConfirmRunning) {
      this.logger.warn('payout_confirm_cycle_skipped_overlap');
      return;
    }
    this.isPayoutConfirmRunning = true;
    try {
      const payoutCandidates = await this.dealRepository.findByStates(['PAYOUT_IN_PROGRESS']);
      await this.scanByCurrency(
        payoutCandidates.map((d) => ({ id: d.id, currency: d.currency })),
        (dealId) => this.confirmPayoutTransactionsUseCase.execute(dealId).then(() => undefined),
      );
    } catch (error) {
      this.logger.error({ err: (error as Error).message }, 'payout_confirm_cycle_failed');
    } finally {
      this.isPayoutConfirmRunning = false;
    }
  }

  private async scanByCurrency(
    deals: Array<{ id: DealId; currency: Currency }>,
    run: (dealId: DealId) => Promise<void>,
  ): Promise<void> {
    const byCurrency = new Map<Currency, DealId[]>();
    for (const deal of deals) {
      const list = byCurrency.get(deal.currency) ?? [];
      list.push(deal.id);
      byCurrency.set(deal.currency, list);
    }

    await Promise.all(
      [...byCurrency.entries()].map(([, dealIds]) =>
        runWithConcurrencyLimit(dealIds, SCAN_CONCURRENCY_PER_CHAIN, async (dealId) => {
          try {
            await run(dealId);
          } catch (error) {
            this.logger.error({ dealId, err: (error as Error).message }, 'deal_scan_failed');
          }
        }),
      ),
    );
  }
}
