import type { Party } from '../entities/Party.js';
import type { DealId } from '../value-objects/EntityId.js';

export interface IPartyRepository {
  save(party: Party): Promise<void>;
  findByDealId(dealId: DealId): Promise<Party[]>;
}
