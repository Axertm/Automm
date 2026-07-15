import cron, { type ScheduledTask } from 'node-cron';
import type { Logger } from 'pino';
import type { IDealRepository } from '../../domain/repositories/IDealRepository.js';
import type { ScanDepositsUseCase } from '../../application/use-cases/scanning/ScanDepositsUseCase.js';
import type { ConfirmPayoutTransactionsUseCase } from '../../application/use-cases/scanning/ConfirmPayoutTransactionsUseCase.js';
import { SCAN_CONCURRENCY_PER_CHAIN } from '../../config/constants.js';
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
 * Drives ScanDepositsUseCase / ConfirmPayoutTransactionsUseCase every 2
 * minutes (configurable). Guards against overlapping ticks, batches deals
 * by currency into independently concurrency-limited queues so one chain's
 * slowness never blocks the other, and isolates per-deal failures so one
 * bad deal doesn't abort the whole tick.
 */
export class DepositScanScheduler {
  private task: ScheduledTask | null = null;
  private isRunning = false;

  constructor(
    private readonly dealRepository: IDealRepository,
    private readonly scanDepositsUseCase: ScanDepositsUseCase,
    private readonly confirmPayoutTransactionsUseCase: ConfirmPayoutTransactionsUseCase,
    private readonly logger: Logger,
    private readonly cronExpression: string,
  ) {}

  start(): void {
    this.task = cron.schedule(this.cronExpression, () => {
      void this.tick();
    });
    this.logger.info({ cronExpression: this.cronExpression }, 'deposit_scan_scheduler_started');
  }

  stop(): void {
    this.task?.stop();
    this.task = null;
  }

  async tick(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('scan_cycle_skipped_overlap');
      return;
    }
    this.isRunning = true;
    try {
      const [depositCandidates, payoutCandidates] = await Promise.all([
        this.dealRepository.findByStates(['AWAITING_DEPOSIT', 'PARTIALLY_FUNDED']),
        this.dealRepository.findByStates(['PAYOUT_IN_PROGRESS']),
      ]);

      await this.scanByCurrency(
        depositCandidates.map((d) => ({ id: d.id, currency: d.currency })),
        (dealId) => this.scanDepositsUseCase.execute(dealId).then(() => undefined),
      );
      await this.scanByCurrency(
        payoutCandidates.map((d) => ({ id: d.id, currency: d.currency })),
        (dealId) => this.confirmPayoutTransactionsUseCase.execute(dealId).then(() => undefined),
      );
    } catch (error) {
      this.logger.error({ err: (error as Error).message }, 'scan_cycle_failed');
    } finally {
      this.isRunning = false;
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
