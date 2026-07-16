import { describe, expect, it, vi } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';
import {
  resolveDealById,
  resolveDealOrWizardSession,
} from '../../../src/presentation/discord/commands/resolveDealById.js';
import { InMemoryDealRepository } from '../../fakes/InMemoryRepositories.js';
import { makeDeal } from '../../fakes/dealFixtures.js';
import {
  createInitialWizardState,
  DealWizardStore,
} from '../../../src/presentation/discord/wizard/DealWizardState.js';
import { asDealId } from '../../../src/domain/value-objects/EntityId.js';
import type { AppDependencies } from '../../../src/presentation/discord/AppDependencies.js';

function makeInteraction(dealIdOption: string, replyMock = vi.fn()): ChatInputCommandInteraction {
  return {
    options: { getString: () => dealIdOption },
    reply: replyMock,
  } as unknown as ChatInputCommandInteraction;
}

describe('resolveDealById — in-progress wizard awareness', () => {
  it('gives a distinct "still being set up" message when the ID matches an active wizard session, not a generic not-found', async () => {
    const dealRepository = new InMemoryDealRepository();
    const dealWizardStore = new DealWizardStore();
    dealWizardStore.create(
      createInitialWizardState({
        dealId: asDealId('799599'),
        guildId: 'g1',
        channelId: 'channel-1',
        initiatorId: 'user-1',
      }),
    );
    const deps = { dealRepository, dealWizardStore } as unknown as AppDependencies;
    const replyMock = vi.fn();

    const result = await resolveDealById(makeInteraction('799599', replyMock), deps);

    expect(result).toBeNull();
    const replyArg = replyMock.mock.calls[0]?.[0] as { embeds: [{ data: { description: string } }] };
    const description = replyArg.embeds[0].data.description;
    expect(description).toContain('still being set up');
    expect(description).not.toContain('No deal found');
  });

  it('still gives the generic not-found message for an ID matching neither a deal nor a wizard session', async () => {
    const dealRepository = new InMemoryDealRepository();
    const dealWizardStore = new DealWizardStore();
    const deps = { dealRepository, dealWizardStore } as unknown as AppDependencies;
    const replyMock = vi.fn();

    await resolveDealById(makeInteraction('000000', replyMock), deps);

    const replyArg = replyMock.mock.calls[0]?.[0] as { embeds: [{ data: { description: string } }] };
    expect(replyArg.embeds[0].data.description).toContain('No deal found');
  });
});

describe('resolveDealOrWizardSession', () => {
  it('resolves a finalized (persisted) deal', async () => {
    const dealRepository = new InMemoryDealRepository();
    const deal = makeDeal();
    await dealRepository.save(deal);
    const dealWizardStore = new DealWizardStore();
    const deps = { dealRepository, dealWizardStore } as unknown as AppDependencies;

    const result = await resolveDealOrWizardSession(makeInteraction(deal.id), deps);
    expect(result).toEqual({ kind: 'deal', deal });
  });

  it('resolves an in-progress wizard session when no persisted deal exists yet', async () => {
    const dealRepository = new InMemoryDealRepository();
    const dealWizardStore = new DealWizardStore();
    const state = createInitialWizardState({
      dealId: asDealId('799599'),
      guildId: 'g1',
      channelId: 'channel-1',
      initiatorId: 'user-1',
    });
    dealWizardStore.create(state);
    const deps = { dealRepository, dealWizardStore } as unknown as AppDependencies;

    const result = await resolveDealOrWizardSession(makeInteraction('799599'), deps);
    expect(result).toEqual({ kind: 'wizard', state });
  });

  it('replies and returns null when the ID matches neither', async () => {
    const dealRepository = new InMemoryDealRepository();
    const dealWizardStore = new DealWizardStore();
    const deps = { dealRepository, dealWizardStore } as unknown as AppDependencies;
    const replyMock = vi.fn();

    const result = await resolveDealOrWizardSession(makeInteraction('000000', replyMock), deps);
    expect(result).toBeNull();
    expect(replyMock).toHaveBeenCalledTimes(1);
  });
});
