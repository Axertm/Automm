import { describe, expect, it } from 'vitest';
import { CreateDealUseCase } from '../../../../src/application/use-cases/deal/CreateDealUseCase.js';
import { AuditRecorder } from '../../../../src/application/services/AuditRecorder.js';
import {
  InMemoryDealRepository,
  InMemoryPartyRepository,
  InMemoryAuditLogRepository,
} from '../../../fakes/InMemoryRepositories.js';
import { FakeClock } from '../../../fakes/FakeClock.js';
import { asDealId } from '../../../../src/domain/value-objects/EntityId.js';

function makeUseCase() {
  const dealRepository = new InMemoryDealRepository();
  const partyRepository = new InMemoryPartyRepository();
  const auditLogRepository = new InMemoryAuditLogRepository();
  const clock = new FakeClock();
  const auditRecorder = new AuditRecorder(auditLogRepository, clock);
  const useCase = new CreateDealUseCase(dealRepository, partyRepository, auditRecorder, clock);
  return { useCase, dealRepository, partyRepository, auditLogRepository };
}

const validInput = {
  guildId: 'guild-1',
  ticketChannelId: 'channel-1',
  currency: 'LTC' as const,
  buyerDiscordId: 'buyer-1',
  sellerDiscordId: 'seller-1',
  expectedAmountDecimal: '1.5',
  feeBasisPoints: 250,
};

describe('CreateDealUseCase', () => {
  it('creates a deal in CREATED state with buyer/seller parties', async () => {
    const { useCase, partyRepository } = makeUseCase();
    const result = await useCase.execute(validInput);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.state).toBe('CREATED');
    expect(result.value.expectedAmount.toDecimalString()).toBe('1.5');

    const parties = await partyRepository.findByDealId(result.value.id);
    expect(parties.map((p) => p.role).sort()).toEqual(['BUYER', 'SELLER']);
  });

  it('records an audit entry for deal creation', async () => {
    const { useCase, auditLogRepository } = makeUseCase();
    const result = await useCase.execute(validInput);
    if (!result.ok) throw new Error('expected ok');

    const entries = await auditLogRepository.findByDealId(result.value.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.toProps().action).toBe('DEAL_CREATED');
  });

  it('rejects a buyer and seller being the same Discord user', async () => {
    const { useCase } = makeUseCase();
    const result = await useCase.execute({ ...validInput, sellerDiscordId: validInput.buyerDiscordId });
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed expected amount', async () => {
    const { useCase } = makeUseCase();
    const result = await useCase.execute({ ...validInput, expectedAmountDecimal: 'not-a-number' });
    expect(result.ok).toBe(false);
  });

  it('rejects a fee basis points value out of range', async () => {
    const { useCase } = makeUseCase();
    const result = await useCase.execute({ ...validInput, feeBasisPoints: 20_000 });
    expect(result.ok).toBe(false);
  });

  it('persists the deal under a pre-generated ID when one is supplied (ticket wizard flow)', async () => {
    const { useCase, dealRepository } = makeUseCase();
    const presetId = asDealId('482913');
    const result = await useCase.execute(validInput, presetId);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.id).toBe(presetId);

    const found = await dealRepository.findById(presetId);
    expect(found?.id).toBe(presetId);
  });
});
