import { describe, expect, it } from 'vitest';
import { ShortDealIdGenerator } from '../../../src/application/services/ShortDealIdGenerator.js';
import { InMemoryDealRepository } from '../../fakes/InMemoryRepositories.js';
import { makeDeal } from '../../fakes/dealFixtures.js';
import { asDealId } from '../../../src/domain/value-objects/EntityId.js';

describe('ShortDealIdGenerator', () => {
  it('generates a 6-digit numeric ID', async () => {
    const generator = new ShortDealIdGenerator(new InMemoryDealRepository());
    const id = await generator.generate();
    expect(id).toMatch(/^\d{6}$/);
  });

  it('never returns an ID that already exists', async () => {
    const dealRepository = new InMemoryDealRepository();
    const generator = new ShortDealIdGenerator(dealRepository);

    const first = await generator.generate();
    await dealRepository.save(makeDeal({ id: asDealId(first) }));

    for (let i = 0; i < 20; i += 1) {
      const next = await generator.generate();
      expect(next).not.toBe(first);
    }
  });

  it('generates distinct IDs across many calls', async () => {
    const dealRepository = new InMemoryDealRepository();
    const generator = new ShortDealIdGenerator(dealRepository);
    const seen = new Set<string>();

    for (let i = 0; i < 25; i += 1) {
      const id = await generator.generate();
      expect(seen.has(id)).toBe(false);
      seen.add(id);
      await dealRepository.save(makeDeal({ id: asDealId(id) }));
    }
  });
});
