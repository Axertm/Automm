import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { getPrismaClient, disconnectPrisma } from '../../../src/infrastructure/persistence/PrismaClient.js';
import { PrismaDealRepository } from '../../../src/infrastructure/persistence/PrismaDealRepository.js';
import { PrismaWalletRepository } from '../../../src/infrastructure/persistence/PrismaWalletRepository.js';
import { PrismaTransactionRepository } from '../../../src/infrastructure/persistence/PrismaTransactionRepository.js';
import { PrismaAuditLogRepository } from '../../../src/infrastructure/persistence/PrismaAuditLogRepository.js';
import { Deal, type DealProps } from '../../../src/domain/entities/Deal.js';
import { Wallet } from '../../../src/domain/entities/Wallet.js';
import { Transaction } from '../../../src/domain/entities/Transaction.js';
import { AuditEntry } from '../../../src/domain/entities/AuditEntry.js';
import { Money } from '../../../src/domain/value-objects/Money.js';
import { asDealId, asWalletId, asTransactionId, asTxId } from '../../../src/domain/value-objects/EntityId.js';

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
    expectedAmount: Money.fromDecimalString('LTC', '2.5'),
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

beforeAll(() => {
  prisma = getPrismaClient();
});

afterEach(async () => {
  await prisma.transaction.deleteMany();
  await prisma.auditEntry.deleteMany();
  await prisma.party.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.deal.deleteMany();
});

afterAll(async () => {
  await disconnectPrisma();
});

describe('PrismaDealRepository', () => {
  it('round-trips a deal including decimal Money and nullable fields', async () => {
    const repo = new PrismaDealRepository(prisma);
    const deal = Deal.create(makeDealProps());
    await repo.save(deal);

    const found = await repo.findById(deal.id);
    expect(found).not.toBeNull();
    expect(found?.state).toBe('AWAITING_DEPOSIT');
    expect(found?.expectedAmount.toDecimalString()).toBe('2.5');
  });

  it('finds a deal by its ticket channel id', async () => {
    const repo = new PrismaDealRepository(prisma);
    const deal = Deal.create(makeDealProps({ ticketChannelId: 'unique-channel-xyz' }));
    await repo.save(deal);

    const found = await repo.findByTicketChannelId('unique-channel-xyz');
    expect(found?.id).toBe(deal.id);
  });

  it('persists state transitions on update', async () => {
    const repo = new PrismaDealRepository(prisma);
    const deal = Deal.create(makeDealProps());
    await repo.save(deal);

    deal.recordDeposit(Money.fromDecimalString('LTC', '2.5'));
    await repo.save(deal);

    const found = await repo.findById(deal.id);
    expect(found?.state).toBe('FUNDED');
  });

  it('filters deals by state', async () => {
    const repo = new PrismaDealRepository(prisma);
    const awaiting = Deal.create(makeDealProps({ state: 'AWAITING_DEPOSIT' }));
    const funded = Deal.create(makeDealProps({ state: 'FUNDED' }));
    await repo.save(awaiting);
    await repo.save(funded);

    const results = await repo.findByStates(['FUNDED']);
    expect(results.map((d) => d.id)).toEqual([funded.id]);
  });

  it('counts deals by state for a guild', async () => {
    const repo = new PrismaDealRepository(prisma);
    await repo.save(Deal.create(makeDealProps({ guildId: 'guild-count', state: 'AWAITING_DEPOSIT' })));
    await repo.save(Deal.create(makeDealProps({ guildId: 'guild-count', state: 'AWAITING_DEPOSIT' })));
    await repo.save(Deal.create(makeDealProps({ guildId: 'guild-count', state: 'FUNDED' })));

    const counts = await repo.countByState('guild-count');
    expect(counts.AWAITING_DEPOSIT).toBe(2);
    expect(counts.FUNDED).toBe(1);
    expect(counts.COMPLETED).toBe(0);
  });
});

describe('PrismaWalletRepository', () => {
  it('round-trips a wallet including the opaque encrypted blob', async () => {
    const dealRepo = new PrismaDealRepository(prisma);
    const walletRepo = new PrismaWalletRepository(prisma);
    const deal = Deal.create(makeDealProps());
    await dealRepo.save(deal);

    const wallet = Wallet.create({
      id: asWalletId('wallet-1'),
      dealId: deal.id,
      currency: 'LTC',
      address: 'ltc1qvee0vzxmw43yer44jse3u0qkylkftk7w5x8esm',
      encryptedPrivateKey: 'aabbcc',
      derivationPath: null,
      createdAt: new Date(),
    });
    await walletRepo.save(wallet);

    const found = await walletRepo.findByDealId(deal.id);
    expect(found?.address).toBe('ltc1qvee0vzxmw43yer44jse3u0qkylkftk7w5x8esm');
    expect(found?.encryptedPrivateKey).toEqual('aabbcc');
  });
});

describe('PrismaTransactionRepository', () => {
  it('round-trips a transaction and finds it by deal+txid+direction', async () => {
    const dealRepo = new PrismaDealRepository(prisma);
    const txRepo = new PrismaTransactionRepository(prisma);
    const deal = Deal.create(makeDealProps());
    await dealRepo.save(deal);

    const tx = Transaction.create({
      id: asTransactionId('tx-1'),
      dealId: deal.id,
      txid: asTxId('abcd1234'),
      direction: 'DEPOSIT',
      status: 'PENDING',
      currency: 'LTC',
      amount: Money.fromDecimalString('LTC', '1.23456789'),
      confirmations: 0,
      detectedAt: new Date(),
      confirmedAt: null,
    });
    await txRepo.save(tx);

    const found = await txRepo.findByDealAndTxid(deal.id, asTxId('abcd1234'), 'DEPOSIT');
    expect(found?.amount.toDecimalString()).toBe('1.23456789');
    expect(found?.status).toBe('PENDING');
  });

  it('upserts on (dealId, txid, direction), not on its own synthetic id — regression test for a payout retry that deterministically re-signs the same UTXO and produces the same txid as a prior attempt', async () => {
    const dealRepo = new PrismaDealRepository(prisma);
    const txRepo = new PrismaTransactionRepository(prisma);
    const deal = Deal.create(makeDealProps());
    await dealRepo.save(deal);

    // Two DIFFERENT domain Transaction objects (fresh randomUUID ids, as
    // ExecutePayoutUseCase generates on every call including retries) that
    // share the same (dealId, txid, direction) — this must upsert to one
    // row, not throw a unique-constraint violation on the second save().
    const first = Transaction.create({
      id: asTransactionId('tx-attempt-1'),
      dealId: deal.id,
      txid: asTxId('same-txid'),
      direction: 'PAYOUT',
      status: 'PENDING',
      currency: 'LTC',
      amount: Money.fromDecimalString('LTC', '1'),
      confirmations: 0,
      detectedAt: new Date(),
      confirmedAt: null,
    });
    await txRepo.save(first);

    const second = Transaction.create({
      id: asTransactionId('tx-attempt-2'),
      dealId: deal.id,
      txid: asTxId('same-txid'),
      direction: 'PAYOUT',
      status: 'CONFIRMED',
      currency: 'LTC',
      amount: Money.fromDecimalString('LTC', '1'),
      confirmations: 3,
      detectedAt: new Date(),
      confirmedAt: new Date(),
    });
    await expect(txRepo.save(second)).resolves.toBeUndefined();

    const rows = await prisma.transaction.findMany({ where: { dealId: deal.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('CONFIRMED');
  });
});

describe('PrismaAuditLogRepository', () => {
  it('appends and lists audit entries in chronological order', async () => {
    const dealRepo = new PrismaDealRepository(prisma);
    const auditRepo = new PrismaAuditLogRepository(prisma);
    const deal = Deal.create(makeDealProps());
    await dealRepo.save(deal);

    await auditRepo.append(
      AuditEntry.create({
        id: 'audit-1',
        dealId: deal.id,
        actorId: 'SYSTEM',
        action: 'DEAL_CREATED',
        fromState: null,
        toState: 'CREATED',
        metadata: null,
        createdAt: new Date(),
      }),
    );
    await auditRepo.append(
      AuditEntry.create({
        id: 'audit-2',
        dealId: deal.id,
        actorId: 'SYSTEM',
        action: 'WALLET_GENERATED',
        fromState: 'CREATED',
        toState: 'AWAITING_DEPOSIT',
        metadata: { currency: 'LTC' },
        createdAt: new Date(),
      }),
    );

    const entries = await auditRepo.findByDealId(deal.id);
    expect(entries.map((e) => e.toProps().action)).toEqual(['DEAL_CREATED', 'WALLET_GENERATED']);
    expect(entries[1]?.toProps().metadata).toEqual({ currency: 'LTC' });
  });
});
