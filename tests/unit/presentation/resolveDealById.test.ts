import { describe, expect, it, vi } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';
import { resolveDealById } from '../../../src/presentation/discord/commands/resolveDealById.js';
import { InMemoryDealRepository } from '../../fakes/InMemoryRepositories.js';
import { makeDeal } from '../../fakes/dealFixtures.js';
import { DealWizardStore } from '../../../src/presentation/discord/wizard/DealWizardState.js';
import type { AppDependencies } from '../../../src/presentation/discord/AppDependencies.js';

function makeInteraction(dealIdOption: string, replyMock = vi.fn()): ChatInputCommandInteraction {
  return {
    options: { getString: () => dealIdOption },
    reply: replyMock,
  } as unknown as ChatInputCommandInteraction;
}

function makeDeps(dealRepository: InMemoryDealRepository): AppDependencies {
  return { dealRepository, dealWizardStore: new DealWizardStore() } as unknown as AppDependencies;
}

describe('resolveDealById', () => {
  it('returns the deal when the ID exists', async () => {
    const dealRepository = new InMemoryDealRepository();
    const deal = makeDeal();
    await dealRepository.save(deal);

    const result = await resolveDealById(makeInteraction(deal.id), makeDeps(dealRepository));
    expect(result?.id).toBe(deal.id);
  });

  it('replies with a clear error and returns null for an unknown Deal ID', async () => {
    const dealRepository = new InMemoryDealRepository();
    const replyMock = vi.fn();

    const result = await resolveDealById(makeInteraction('999999', replyMock), makeDeps(dealRepository));

    expect(result).toBeNull();
    expect(replyMock).toHaveBeenCalledTimes(1);
    const replyArg = replyMock.mock.calls[0]?.[0] as { embeds: [{ data: { description: string } }] };
    const description = replyArg.embeds[0].data.description;
    expect(description).toContain('999999');
    expect(description.toLowerCase()).toContain('no deal found');
  });

  it('trims whitespace from the supplied Deal ID', async () => {
    const dealRepository = new InMemoryDealRepository();
    const deal = makeDeal();
    await dealRepository.save(deal);

    const result = await resolveDealById(makeInteraction(`  ${deal.id}  `), makeDeps(dealRepository));
    expect(result?.id).toBe(deal.id);
  });
});
