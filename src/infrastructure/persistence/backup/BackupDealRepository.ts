import type { Deal } from '../../../domain/entities/Deal.js';
import type { DealId } from '../../../domain/value-objects/EntityId.js';
import type { DealState } from '../../../domain/state-machine/DealState.js';
import type { IDealRepository } from '../../../domain/repositories/IDealRepository.js';
import type { JsonBackupStore } from './JsonBackupStore.js';

/**
 * Wraps the real IDealRepository and mirrors every successful write to
 * JsonBackupStore — a second, independent on-disk copy of the deal. Reads
 * always go straight to the underlying repository; the JSON files are
 * write-only from the application's perspective (only the restore script
 * reads them back).
 */
export class BackupDealRepository implements IDealRepository {
  constructor(
    private readonly inner: IDealRepository,
    private readonly backupStore: JsonBackupStore,
  ) {}

  async save(deal: Deal): Promise<void> {
    await this.inner.save(deal);
    this.backupStore.saveDeal(deal);
  }

  async saveIfCurrentStateIs(deal: Deal, expectedState: DealState): Promise<boolean> {
    const claimed = await this.inner.saveIfCurrentStateIs(deal, expectedState);
    if (claimed) {
      this.backupStore.saveDeal(deal);
    }
    return claimed;
  }

  findById(id: DealId): Promise<Deal | null> {
    return this.inner.findById(id);
  }

  findByTicketChannelId(channelId: string): Promise<Deal | null> {
    return this.inner.findByTicketChannelId(channelId);
  }

  findByStates(states: readonly DealState[]): Promise<Deal[]> {
    return this.inner.findByStates(states);
  }

  countByState(guildId: string): Promise<Record<DealState, number>> {
    return this.inner.countByState(guildId);
  }
}
