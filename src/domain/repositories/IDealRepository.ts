import type { Deal } from '../entities/Deal.js';
import type { DealId } from '../value-objects/EntityId.js';
import type { DealState } from '../state-machine/DealState.js';

export interface IDealRepository {
  save(deal: Deal): Promise<void>;
  /**
   * Atomically persists `deal` only if the row currently stored under its id
   * still has state `expectedState` — a compare-and-swap that closes the gap
   * an in-process lock (see KeyedMutex) can't: two bot instances, or a
   * scheduler tick racing a Discord interaction, both reading the same deal
   * before either writes. Returns false (writing nothing) if another writer
   * already moved the deal out of `expectedState` first.
   */
  saveIfCurrentStateIs(deal: Deal, expectedState: DealState): Promise<boolean>;
  findById(id: DealId): Promise<Deal | null>;
  findByTicketChannelId(channelId: string): Promise<Deal | null>;
  findByStates(states: readonly DealState[]): Promise<Deal[]>;
  countByState(guildId: string): Promise<Record<DealState, number>>;
}
