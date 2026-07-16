import { describe, expect, it } from 'vitest';
import { AdminFreezeUseCase } from '../../../../src/application/use-cases/admin/AdminFreezeUseCase.js';
import { AdminUnfreezeUseCase } from '../../../../src/application/use-cases/admin/AdminUnfreezeUseCase.js';
import { AdminCancelUseCase } from '../../../../src/application/use-cases/admin/AdminCancelUseCase.js';
import { AdminRefundUseCase } from '../../../../src/application/use-cases/admin/AdminRefundUseCase.js';
import { AdminOverridePayoutAddressUseCase } from '../../../../src/application/use-cases/admin/AdminOverridePayoutAddressUseCase.js';
import { AdminStatsUseCase } from '../../../../src/application/use-cases/admin/AdminStatsUseCase.js';
import { AdminRetryPayoutUseCase } from '../../../../src/application/use-cases/admin/AdminRetryPayoutUseCase.js';
import { AuditRecorder } from '../../../../src/application/services/AuditRecorder.js';
import { PayoutTrigger } from '../../../../src/application/services/PayoutTrigger.js';
import { ExecutePayoutUseCase } from '../../../../src/application/use-cases/release/ExecutePayoutUseCase.js';
import {
  InMemoryDealRepository,
  InMemoryWalletRepository,
  InMemoryTransactionRepository,
  InMemoryAuditLogRepository,
} from '../../../fakes/InMemoryRepositories.js';
import { FakeClock } from '../../../fakes/FakeClock.js';
import { FakeBlockchainService } from '../../../fakes/FakeBlockchainService.js';
import { FakeDiscordNotifier } from '../../../fakes/FakeDiscordNotifier.js';
import { makeDeal } from '../../../fakes/dealFixtures.js';
import { Transaction } from '../../../../src/domain/entities/Transaction.js';
import { Wallet } from '../../../../src/domain/entities/Wallet.js';
import { Money } from '../../../../src/domain/value-objects/Money.js';
import { asTransactionId, asTxId, asWalletId } from '../../../../src/domain/value-objects/EntityId.js';
import type { IBlockchainServiceFactory } from '../../../../src/application/ports/IBlockchainServiceFactory.js';
import type { IFeeWalletProvider } from '../../../../src/application/ports/IFeeWalletProvider.js';
import type { Currency } from '../../../../src/domain/value-objects/Currency.js';
import type { IBlockchainService } from '../../../../src/application/ports/IBlockchainService.js';

const ADMIN = 'admin-1';

class SingleCurrencyFactory implements IBlockchainServiceFactory {
  constructor(private readonly service: FakeBlockchainService) {}
  getService(_currency: Currency): IBlockchainService {
    return this.service;
  }
}

class StubFeeWalletProvider implements IFeeWalletProvider {
  getFeeWalletAddress(): string {
    return 'fake-ltc-fee-wallet-address';
  }
}

function harness() {
  const dealRepository = new InMemoryDealRepository();
  const walletRepository = new InMemoryWalletRepository();
  const transactionRepository = new InMemoryTransactionRepository();
  const auditLogRepository = new InMemoryAuditLogRepository();
  const clock = new FakeClock();
  const auditRecorder = new AuditRecorder(auditLogRepository, clock);
  const notifier = new FakeDiscordNotifier();
  const blockchainService = new FakeBlockchainService('LTC');
  const factory = new SingleCurrencyFactory(blockchainService);
  const executePayout = new ExecutePayoutUseCase(
    dealRepository,
    walletRepository,
    transactionRepository,
    factory,
    new StubFeeWalletProvider(),
    notifier,
    auditRecorder,
    clock,
  );
  const payoutTrigger = new PayoutTrigger(dealRepository, executePayout, auditRecorder);
  return {
    dealRepository,
    walletRepository,
    transactionRepository,
    auditLogRepository,
    notifier,
    blockchainService,
    factory,
    auditRecorder,
    executePayout,
    payoutTrigger,
  };
}

describe('AdminFreezeUseCase / AdminUnfreezeUseCase', () => {
  it('freezes a funded deal and unfreezes it back to FUNDED', async () => {
    const h = harness();
    const freeze = new AdminFreezeUseCase(h.dealRepository, h.notifier, h.auditRecorder);
    const unfreeze = new AdminUnfreezeUseCase(h.dealRepository, h.notifier, h.auditRecorder);
    const deal = makeDeal({ state: 'FUNDED' });
    await h.dealRepository.save(deal);

    const frozen = await freeze.execute(deal.id, ADMIN, 'suspicious chat activity');
    expect(frozen.ok).toBe(true);
    if (frozen.ok) expect(frozen.value.state).toBe('FROZEN');

    const restored = await unfreeze.execute(deal.id, ADMIN);
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.value.state).toBe('FUNDED');
  });

  it('freezes a deal stuck in PAYOUT_IN_PROGRESS and unfreezes it back, so a stalled payout can be retried', async () => {
    const h = harness();
    const freeze = new AdminFreezeUseCase(h.dealRepository, h.notifier, h.auditRecorder);
    const unfreeze = new AdminUnfreezeUseCase(h.dealRepository, h.notifier, h.auditRecorder);
    const deal = makeDeal({ state: 'PAYOUT_IN_PROGRESS' });
    await h.dealRepository.save(deal);

    const frozen = await freeze.execute(deal.id, ADMIN, 'payout broadcast stalled');
    expect(frozen.ok).toBe(true);
    if (frozen.ok) expect(frozen.value.state).toBe('FROZEN');

    const restored = await unfreeze.execute(deal.id, ADMIN);
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.value.state).toBe('PAYOUT_IN_PROGRESS');
  });
});

describe('AdminCancelUseCase', () => {
  it('cancels an unfunded deal', async () => {
    const h = harness();
    const cancel = new AdminCancelUseCase(h.dealRepository, h.notifier, h.auditRecorder);
    const deal = makeDeal({ state: 'AWAITING_DEPOSIT' });
    await h.dealRepository.save(deal);

    const result = await cancel.execute(deal.id, ADMIN, 'buyer backed out');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.state).toBe('CANCELLED');
  });

  it('rejects cancelling a funded deal — must use refund instead', async () => {
    const h = harness();
    const cancel = new AdminCancelUseCase(h.dealRepository, h.notifier, h.auditRecorder);
    const deal = makeDeal({ state: 'FUNDED' });
    await h.dealRepository.save(deal);

    const result = await cancel.execute(deal.id, ADMIN, 'oops');
    expect(result.ok).toBe(false);
  });
});

describe('AdminRefundUseCase', () => {
  it('refunds the confirmed deposited amount to the buyer-supplied address', async () => {
    const h = harness();
    const refund = new AdminRefundUseCase(
      h.dealRepository,
      h.walletRepository,
      h.transactionRepository,
      h.factory,
      h.notifier,
      h.auditRecorder,
    );
    const deal = makeDeal({ state: 'FUNDED' });
    await h.dealRepository.save(deal);
    await h.walletRepository.save(
      Wallet.create({
        id: asWalletId('wallet-1'),
        dealId: deal.id,
        currency: 'LTC',
        address: 'fake-ltc-deposit',
        encryptedPrivateKey: 'fake-private-key',
        derivationPath: null,
        createdAt: new Date(),
      }),
    );
    await h.transactionRepository.save(
      Transaction.create({
        id: asTransactionId('tx-1'),
        dealId: deal.id,
        txid: asTxId('deposit-tx'),
        direction: 'DEPOSIT',
        status: 'CONFIRMED',
        currency: 'LTC',
        amount: Money.fromDecimalString('LTC', '1'),
        confirmations: 3,
        detectedAt: new Date(),
        confirmedAt: new Date(),
      }),
    );

    const result = await refund.execute(deal.id, ADMIN, 'buyer requested refund', 'fake-ltc-refund-address');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.state).toBe('REFUNDED');
    expect(h.blockchainService.sentPayouts).toHaveLength(1);
    // FakeBlockchainService.estimateFee returns 0.0001 LTC — carved out of
    // the refund output before broadcasting (see AdminRefundUseCase).
    expect(h.blockchainService.sentPayouts[0]?.outputs[0]?.amount.toDecimalString()).toBe('0.9999');
  });

  it('refuses to refund an unfunded deal', async () => {
    const h = harness();
    const refund = new AdminRefundUseCase(
      h.dealRepository,
      h.walletRepository,
      h.transactionRepository,
      h.factory,
      h.notifier,
      h.auditRecorder,
    );
    const deal = makeDeal({ state: 'AWAITING_DEPOSIT' });
    await h.dealRepository.save(deal);
    await h.walletRepository.save(
      Wallet.create({
        id: asWalletId('wallet-2'),
        dealId: deal.id,
        currency: 'LTC',
        address: 'fake-ltc-deposit-2',
        encryptedPrivateKey: 'fake-private-key',
        derivationPath: null,
        createdAt: new Date(),
      }),
    );

    const result = await refund.execute(deal.id, ADMIN, 'reason', 'fake-ltc-refund-address');
    expect(result.ok).toBe(false);
  });
});

describe('AdminOverridePayoutAddressUseCase', () => {
  it('bypasses both seller and buyer confirmations, straight from FUNDED, and immediately triggers payout', async () => {
    const h = harness();
    const override = new AdminOverridePayoutAddressUseCase(
      h.dealRepository,
      h.factory,
      h.notifier,
      h.auditRecorder,
      h.payoutTrigger,
    );
    const deal = makeDeal({ state: 'FUNDED' });
    await h.dealRepository.save(deal);
    await h.walletRepository.save(
      Wallet.create({
        id: asWalletId('wallet-override'),
        dealId: deal.id,
        currency: 'LTC',
        address: 'fake-ltc-deposit',
        encryptedPrivateKey: 'fake-private-key',
        derivationPath: null,
        createdAt: new Date(),
      }),
    );

    const result = await override.execute(
      deal.id,
      ADMIN,
      'fake-ltc-override-address',
      'seller wallet compromised',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.state).toBe('PAYOUT_IN_PROGRESS');
      expect(result.value.payoutAddressConfirmedBySeller).toBe(true);
      expect(result.value.buyerReleaseConfirmed).toBe(true);
    }
    expect(h.blockchainService.sentPayouts).toHaveLength(1);

    const entries = await h.auditLogRepository.findByDealId(deal.id);
    expect(entries.some((e) => e.toProps().action === 'ADMIN_OVERRIDE_PAYOUT_ADDRESS')).toBe(true);
  });

  it('rejects an invalid override address', async () => {
    const h = harness();
    h.blockchainService.validateAddress = () => false;
    const override = new AdminOverridePayoutAddressUseCase(
      h.dealRepository,
      h.factory,
      h.notifier,
      h.auditRecorder,
      h.payoutTrigger,
    );
    const deal = makeDeal({ state: 'FUNDED' });
    await h.dealRepository.save(deal);

    const result = await override.execute(deal.id, ADMIN, 'garbage', 'reason');
    expect(result.ok).toBe(false);
  });

  it('rejects override before any funds have arrived', async () => {
    const h = harness();
    const override = new AdminOverridePayoutAddressUseCase(
      h.dealRepository,
      h.factory,
      h.notifier,
      h.auditRecorder,
      h.payoutTrigger,
    );
    const deal = makeDeal({ state: 'AWAITING_DEPOSIT' });
    await h.dealRepository.save(deal);

    const result = await override.execute(deal.id, ADMIN, 'fake-ltc-override-address', 'reason');
    expect(result.ok).toBe(false);
  });
});

describe('AdminStatsUseCase', () => {
  it('aggregates deal counts by state and active-vs-terminal totals', async () => {
    const h = harness();
    await h.dealRepository.save(makeDeal({ guildId: 'g1', state: 'AWAITING_DEPOSIT' }));
    await h.dealRepository.save(makeDeal({ guildId: 'g1', state: 'FUNDED' }));
    await h.dealRepository.save(makeDeal({ guildId: 'g1', state: 'COMPLETED' }));
    await h.dealRepository.save(makeDeal({ guildId: 'other-guild', state: 'FUNDED' }));

    const stats = new AdminStatsUseCase(h.dealRepository);
    const result = await stats.execute('g1');

    expect(result.totalDeals).toBe(3);
    expect(result.activeDeals).toBe(2);
    expect(result.countsByState.COMPLETED).toBe(1);
  });
});

describe('AdminRetryPayoutUseCase', () => {
  async function setUpStuckPayout(h: ReturnType<typeof harness>) {
    const deal = makeDeal({
      state: 'PAYOUT_IN_PROGRESS',
      payoutAddress: 'fake-ltc-payout-address',
      payoutAddressConfirmedBySeller: true,
      buyerReleaseConfirmed: true,
    });
    await h.dealRepository.save(deal);
    await h.walletRepository.save(
      Wallet.create({
        id: asWalletId('wallet-retry'),
        dealId: deal.id,
        currency: 'LTC',
        address: 'fake-ltc-deposit-retry',
        encryptedPrivateKey: 'fake-private-key',
        derivationPath: null,
        createdAt: new Date(),
      }),
    );
    await h.transactionRepository.save(
      Transaction.create({
        id: asTransactionId('tx-retry'),
        dealId: deal.id,
        txid: asTxId('deposit-tx-retry'),
        direction: 'DEPOSIT',
        status: 'CONFIRMED',
        currency: 'LTC',
        amount: Money.fromDecimalString('LTC', '1'),
        confirmations: 3,
        detectedAt: new Date(),
        confirmedAt: new Date(),
      }),
    );
    return deal;
  }

  it('re-broadcasts a payout stuck with no txid recorded yet', async () => {
    const h = harness();
    const deal = await setUpStuckPayout(h);
    const retry = new AdminRetryPayoutUseCase(h.dealRepository, h.executePayout, h.auditRecorder);

    const result = await retry.execute(deal.id, ADMIN);

    expect(result.ok).toBe(true);
    expect(h.blockchainService.sentPayouts).toHaveLength(1);
  });

  it('refuses to retry a deal that is not in PAYOUT_IN_PROGRESS', async () => {
    const h = harness();
    const deal = makeDeal({ state: 'FUNDED' });
    await h.dealRepository.save(deal);
    const retry = new AdminRetryPayoutUseCase(h.dealRepository, h.executePayout, h.auditRecorder);

    const result = await retry.execute(deal.id, ADMIN);

    expect(result.ok).toBe(false);
  });
});
