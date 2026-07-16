import { randomInt } from 'node:crypto';
import { asDealId, type DealId } from '../../domain/value-objects/EntityId.js';
import type { IDealRepository } from '../../domain/repositories/IDealRepository.js';

const MIN = 100_000;
const MAX = 999_999;
const MAX_ATTEMPTS = 20;

/**
 * Generates a short, human-friendly 6-digit deal ID (e.g. "482913") used as
 * both the Deal's actual primary key and the ticket channel name
 * ("escrow-482913") — rather than a long cuid, which the ticket-based
 * wizard needs to display prominently from the moment the ticket is
 * created, well before the rest of the deal's fields are known.
 */
export class ShortDealIdGenerator {
  constructor(private readonly dealRepository: IDealRepository) {}

  async generate(): Promise<DealId> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const candidate = asDealId(String(randomInt(MIN, MAX + 1)));
      const existing = await this.dealRepository.findById(candidate);
      if (!existing) return candidate;
    }
    throw new Error('Could not generate a unique deal ID after multiple attempts');
  }
}
