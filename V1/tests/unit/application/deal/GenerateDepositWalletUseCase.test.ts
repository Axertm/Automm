import { describe, expect, it } from 'vitest';
import { GenerateDepositWalletUseCase } from '../../../../src/application/use-cases/deal/GenerateDepositWalletUseCase.js';
import { AuditRecorder } from '../../../../src/application/services/AuditRecorder.js';
import {
  InMemoryDealRepository,
  InMemoryWalletRepository,
  InMemoryAuditLogRepository,
} from '../../../fakes/InMemoryRepositories.js';
import { FakeClock } from '../../../fakes/FakeClock.js';
import { FakeBlockchainService } from '../../../fakes/FakeBlockchainService.js';
import { Deal } from '../../../../src/domain/entities/Deal.js';
import { Money } from '../../../../src/domain/value-objects/Money.js';
import { asDealId } from '../../../../src/domain/value-objects/EntityId.js';
import type { IBlockchainServiceFactory } from '../../../../src/application/ports/IBlockchainServiceFactory.js';
import type { Currency } from '../../../../src/domain/value-objects/Currency.js';
import type { IBlockchainService } from '../../../../src/application/ports/IBlockchainService.js';

class StubBlockchainServiceFactory implements IBlockchainServiceFactory {
  readonly ltc = new FakeBlockchainService('LTC');
  readonly sol = new FakeBlockchainService('SOL');

  getService(currency: Currency): IBlockchainService {
    return currency === 'LTC' ? this.ltc : this.sol;
  }
}

function makeUseCase() {
  const dealRepository = new InMemoryDealRepository();
  const walletRepository = new InMemoryWalletRepository();
  const auditLogRepository = new InMemoryAuditLogRepository();
  const clock = new FakeClock();
  const factory = new StubBlockchainServiceFactory();
  const auditRecorder = new AuditRecorder(auditLogRepository, clock);
  const useCase = new GenerateDepositWalletUseCase(
    dealRepository,
    walletRepository,
    factory,
    auditRecorder,
    clock,
  );
  return { useCase, dealRepository, walletRepository, auditLogRepository, factory };
}

async function seedDeal(dealRepository: InMemoryDealRepository) {
  const deal = Deal.create({
    id: asDealId('deal-1'),
    guildId: 'guild-1',
    ticketChannelId: 'channel-1',
    currency: 'LTC',
    state: 'CREATED',
    buyerDiscordId: 'buyer-1',
    sellerDiscordId: 'seller-1',
    expectedAmount: Money.fromDecimalString('LTC', '1'),
    feeBasisPointsSnapshot: 250,
    payoutAddress: null,
    payoutAddressConfirmedBySeller: false,
    buyerReleaseConfirmed: false,
    payoutAddressOverriddenByAdmin: false,
    payoutOverrideReason: null,
    payoutOverrideByDiscordId: null,
    frozenFromState: null,
    frozenReason: null,
    frozenByDiscordId: null,
    cancelReason: null,
    refundReason: null,
    refundAddress: null,
    payoutFeeTxId: null,
    payoutMainTxId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    fundedAt: null,
    completedAt: null,
  });
  await dealRepository.save(deal);
  return deal;
}

describe('GenerateDepositWalletUseCase', () => {
  it('generates a wallet via the currency-appropriate blockchain service and moves the deal to AWAITING_DEPOSIT', async () => {
    const { useCase, dealRepository, walletRepository, factory } = makeUseCase();
    const deal = await seedDeal(dealRepository);

    const result = await useCase.execute(deal.id);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.deal.state).toBe('AWAITING_DEPOSIT');
    expect(factory.ltc.generatedWallets).toHaveLength(1);

    const savedWallet = await walletRepository.findByDealId(deal.id);
    expect(savedWallet?.address).toBe(result.value.wallet.address);
  });

  it('returns an error when the deal does not exist', async () => {
    const { useCase } = makeUseCase();
    const result = await useCase.execute(asDealId('missing-deal'));
    expect(result.ok).toBe(false);
  });

  it('refuses to generate a second wallet for the same deal', async () => {
    const { useCase, dealRepository } = makeUseCase();
    const deal = await seedDeal(dealRepository);

    const first = await useCase.execute(deal.id);
    expect(first.ok).toBe(true);

    const second = await useCase.execute(deal.id);
    expect(second.ok).toBe(false);
  });
});
