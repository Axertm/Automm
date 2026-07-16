import { describe, expect, it } from 'vitest';
import { ConfirmPayoutTransactionsUseCase } from '../../../../src/application/use-cases/scanning/ConfirmPayoutTransactionsUseCase.js';
import { AuditRecorder } from '../../../../src/application/services/AuditRecorder.js';
import { InMemoryDealRepository, InMemoryAuditLogRepository } from '../../../fakes/InMemoryRepositories.js';
import { FakeClock } from '../../../fakes/FakeClock.js';
import { FakeBlockchainService } from '../../../fakes/FakeBlockchainService.js';
import { FakeDiscordNotifier } from '../../../fakes/FakeDiscordNotifier.js';
import { Deal, type DealProps } from '../../../../src/domain/entities/Deal.js';
import { Money } from '../../../../src/domain/value-objects/Money.js';
import { asDealId } from '../../../../src/domain/value-objects/EntityId.js';
import type { IBlockchainServiceFactory } from '../../../../src/application/ports/IBlockchainServiceFactory.js';
import type { Currency } from '../../../../src/domain/value-objects/Currency.js';
import type { IBlockchainService } from '../../../../src/application/ports/IBlockchainService.js';

class SingleCurrencyFactory implements IBlockchainServiceFactory {
  constructor(private readonly service: FakeBlockchainService) {}
  getService(_currency: Currency): IBlockchainService {
    return this.service;
  }
}

function baseProps(overrides: Partial<DealProps> = {}): DealProps {
  return {
    id: asDealId('deal-1'),
    guildId: 'guild-1',
    ticketChannelId: 'channel-1',
    currency: 'LTC',
    state: 'PAYOUT_IN_PROGRESS',
    buyerDiscordId: 'buyer-1',
    sellerDiscordId: 'seller-1',
    expectedAmount: Money.fromDecimalString('LTC', '1'),
    feeBasisPointsSnapshot: 250,
    payoutAddress: 'addr',
    payoutAddressConfirmedBySeller: true,
    buyerReleaseConfirmed: true,
    payoutAddressOverriddenByAdmin: false,
    payoutOverrideReason: null,
    payoutOverrideByDiscordId: null,
    frozenFromState: null,
    frozenReason: null,
    frozenByDiscordId: null,
    cancelReason: null,
    refundReason: null,
    refundAddress: null,
    payoutFeeTxId: 'fee-tx',
    payoutMainTxId: 'main-tx',
    createdAt: new Date(),
    updatedAt: new Date(),
    fundedAt: new Date(),
    completedAt: null,
    ...overrides,
  };
}

describe('ConfirmPayoutTransactionsUseCase', () => {
  it('completes the deal once both fee and payout transactions are confirmed', async () => {
    const dealRepository = new InMemoryDealRepository();
    const auditLogRepository = new InMemoryAuditLogRepository();
    const notifier = new FakeDiscordNotifier();
    const blockchainService = new FakeBlockchainService('LTC');
    const factory = new SingleCurrencyFactory(blockchainService);
    const clock = new FakeClock();
    const auditRecorder = new AuditRecorder(auditLogRepository, clock);
    const useCase = new ConfirmPayoutTransactionsUseCase(dealRepository, factory, notifier, auditRecorder);

    const deal = Deal.create(baseProps());
    await dealRepository.save(deal);

    const result = await useCase.execute(deal.id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.state).toBe('COMPLETED');
    expect(notifier.calls.some((c) => c.method === 'payoutCompleted')).toBe(true);
  });

  it('leaves the deal in PAYOUT_IN_PROGRESS if either tx is not yet confirmed', async () => {
    const dealRepository = new InMemoryDealRepository();
    const auditLogRepository = new InMemoryAuditLogRepository();
    const notifier = new FakeDiscordNotifier();
    const blockchainService = new FakeBlockchainService('LTC');
    blockchainService.getTransactionStatus = async () => ({ confirmations: 1, confirmed: false });
    const factory = new SingleCurrencyFactory(blockchainService);
    const clock = new FakeClock();
    const auditRecorder = new AuditRecorder(auditLogRepository, clock);
    const useCase = new ConfirmPayoutTransactionsUseCase(dealRepository, factory, notifier, auditRecorder);

    const deal = Deal.create(baseProps());
    await dealRepository.save(deal);

    const result = await useCase.execute(deal.id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.state).toBe('PAYOUT_IN_PROGRESS');
    expect(notifier.calls).toHaveLength(0);
  });

  it('is a no-op for a deal not in PAYOUT_IN_PROGRESS', async () => {
    const dealRepository = new InMemoryDealRepository();
    const auditLogRepository = new InMemoryAuditLogRepository();
    const notifier = new FakeDiscordNotifier();
    const factory = new SingleCurrencyFactory(new FakeBlockchainService('LTC'));
    const clock = new FakeClock();
    const auditRecorder = new AuditRecorder(auditLogRepository, clock);
    const useCase = new ConfirmPayoutTransactionsUseCase(dealRepository, factory, notifier, auditRecorder);

    const deal = Deal.create(baseProps({ state: 'FUNDED', payoutFeeTxId: null, payoutMainTxId: null }));
    await dealRepository.save(deal);

    const result = await useCase.execute(deal.id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.state).toBe('FUNDED');
  });
});
