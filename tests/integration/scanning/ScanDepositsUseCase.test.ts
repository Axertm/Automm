import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { getPrismaClient, disconnectPrisma } from '../../../src/infrastructure/persistence/PrismaClient.js';
import { PrismaDealRepository } from '../../../src/infrastructure/persistence/PrismaDealRepository.js';
import { PrismaWalletRepository } from '../../../src/infrastructure/persistence/PrismaWalletRepository.js';
import { PrismaTransactionRepository } from '../../../src/infrastructure/persistence/PrismaTransactionRepository.js';
import { PrismaAuditLogRepository } from '../../../src/infrastructure/persistence/PrismaAuditLogRepository.js';
import { ScanDepositsUseCase } from '../../../src/application/use-cases/scanning/ScanDepositsUseCase.js';
import { AuditRecorder } from '../../../src/application/services/AuditRecorder.js';
import { Deal, type DealProps } from '../../../src/domain/entities/Deal.js';
import { Wallet } from '../../../src/domain/entities/Wallet.js';
import { Money } from '../../../src/domain/value-objects/Money.js';
import { asDealId, asWalletId } from '../../../src/domain/value-objects/EntityId.js';
import { FakeClock } from '../../fakes/FakeClock.js';
import { FakeBlockchainService } from '../../fakes/FakeBlockchainService.js';
import { FakeDiscordNotifier } from '../../fakes/FakeDiscordNotifier.js';
import type { IBlockchainServiceFactory } from '../../../src/application/ports/IBlockchainServiceFactory.js';
import type { Currency } from '../../../src/domain/value-objects/Currency.js';
import type { IBlockchainService } from '../../../src/application/ports/IBlockchainService.js';

let prisma: PrismaClient;

function makeDealProps(overrides: Partial<DealProps> = {}): DealProps {
  return {
    id: asDealId(`deal-${Math.random().toString(36).slice(2)}`),
    guildId: 'guild-1',
    ticketChannelId: `channel-${Math.random().toString(36).slice(2)}`,
    currency: 'LTC',
    state: 'AWAITING_DEPOSIT',
    buyerDiscordId: 'buyer-1',
    sellerDiscordId: 'seller-1',
    expectedAmount: Money.fromDecimalString('LTC', '2'),
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
    ...overrides,
  };
}

class SingleCurrencyFactory implements IBlockchainServiceFactory {
  constructor(private readonly service: FakeBlockchainService) {}
  getService(_currency: Currency): IBlockchainService {
    return this.service;
  }
}

beforeAll(() => {
  prisma = getPrismaClient();
});

afterEach(async () => {
  await prisma.transaction.deleteMany();
  await prisma.auditEntry.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.deal.deleteMany();
});

afterAll(async () => {
  await disconnectPrisma();
});

async function seedDealWithWallet(
  dealRepo: PrismaDealRepository,
  walletRepo: PrismaWalletRepository,
  overrides: Partial<DealProps> = {},
) {
  const deal = Deal.create(makeDealProps(overrides));
  await dealRepo.save(deal);
  const wallet = Wallet.create({
    id: asWalletId(`wallet-${deal.id}`),
    dealId: deal.id,
    currency: deal.currency,
    address: `fake-ltc-${deal.id}`,
    encryptedPrivateKey: { iv: 'iv', authTag: 'tag', ciphertext: 'cipher', keyVersion: 1 },
    derivationPath: null,
    createdAt: new Date(),
  });
  await walletRepo.save(wallet);
  return { deal, wallet };
}

describe('ScanDepositsUseCase (integration, real SQLite)', () => {
  it('moves a deal through PARTIALLY_FUNDED then FUNDED across two scan cycles as confirmations accrue', async () => {
    const dealRepo = new PrismaDealRepository(prisma);
    const walletRepo = new PrismaWalletRepository(prisma);
    const txRepo = new PrismaTransactionRepository(prisma);
    const auditRepo = new PrismaAuditLogRepository(prisma);
    const clock = new FakeClock();
    const auditRecorder = new AuditRecorder(auditRepo, clock);
    const notifier = new FakeDiscordNotifier();
    const blockchainService = new FakeBlockchainService('LTC');
    blockchainService.requiredConfirmations = { kind: 'blocks', count: 3 };
    const factory = new SingleCurrencyFactory(blockchainService);

    const useCase = new ScanDepositsUseCase(
      dealRepo,
      walletRepo,
      txRepo,
      factory,
      notifier,
      auditRecorder,
      clock,
    );
    const { deal } = await seedDealWithWallet(dealRepo, walletRepo);

    // Cycle 1: a deposit arrives but is not yet confirmed enough.
    blockchainService.scanQueue = [
      [{ txid: 'tx-1', amount: Money.fromDecimalString('LTC', '2'), confirmations: 1, blockTime: null }],
    ];
    const first = await useCase.execute(deal.id);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('expected ok');
    expect(first.value.deal.state).toBe('AWAITING_DEPOSIT'); // unconfirmed, so not counted toward FUNDED/PARTIALLY_FUNDED yet
    expect(notifier.calls.some((c) => c.method === 'depositDetected')).toBe(true);

    // Cycle 2: the same transaction now has enough confirmations.
    blockchainService.scanQueue = [
      [{ txid: 'tx-1', amount: Money.fromDecimalString('LTC', '2'), confirmations: 3, blockTime: null }],
    ];
    const second = await useCase.execute(deal.id);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('expected ok');
    expect(second.value.deal.state).toBe('FUNDED');
    expect(notifier.calls.some((c) => c.method === 'dealFunded')).toBe(true);

    const auditEntries = await auditRepo.findByDealId(deal.id);
    expect(auditEntries.some((e) => e.toProps().toState === 'FUNDED')).toBe(true);
  });

  it('is a no-op for a deal outside the scannable states', async () => {
    const dealRepo = new PrismaDealRepository(prisma);
    const walletRepo = new PrismaWalletRepository(prisma);
    const txRepo = new PrismaTransactionRepository(prisma);
    const auditRepo = new PrismaAuditLogRepository(prisma);
    const clock = new FakeClock();
    const auditRecorder = new AuditRecorder(auditRepo, clock);
    const notifier = new FakeDiscordNotifier();
    const blockchainService = new FakeBlockchainService('LTC');
    const factory = new SingleCurrencyFactory(blockchainService);

    const useCase = new ScanDepositsUseCase(
      dealRepo,
      walletRepo,
      txRepo,
      factory,
      notifier,
      auditRecorder,
      clock,
    );
    const { deal } = await seedDealWithWallet(dealRepo, walletRepo, { state: 'COMPLETED' });

    const result = await useCase.execute(deal.id);
    expect(result.ok).toBe(true);
    expect(notifier.calls).toHaveLength(0);
  });
});
