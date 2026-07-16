import type { Deal } from '../entities/Deal.js';
import type { DealId } from '../value-objects/EntityId.js';
import type { DealState } from '../state-machine/DealState.js';

export interface IDealRepository {
  save(deal: Deal): Promise<void>;
  findById(id: DealId): Promise<Deal | null>;
  findByTicketChannelId(channelId: string): Promise<Deal | null>;
  findByStates(states: readonly DealState[]): Promise<Deal[]>;
  countByState(guildId: string): Promise<Record<DealState, number>>;
}
