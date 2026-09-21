import { describe, expect, it } from 'vitest';
import { RequestRefundUseCase } from '../../../../src/application/use-cases/refund/RequestRefundUseCase.js';
import { SubmitRefundAddressUseCase } from '../../../../src/application/use-cases/refund/SubmitRefundAddressUseCase.js';
import { ConfirmRefundUseCase } from '../../../../src/application/use-cases/refund/ConfirmRefundUseCase.js';
import { AuditRecorder } from '../../../../src/application/services/AuditRecorder.js';
import {
  InMemoryDealRepository,
  InMemoryWalletRepository,
  InMemoryTransactionRepository,
  InMemoryAuditLogRepository,
  InMemoryDealBackupRepository,
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
import type { Currency } from '../../../../src/domain/value-objects/Currency.js';
import type { IBlockchainService } from '../../../../src/application/ports/IBlockchainService.js';
import type { Deal } from '../../../../src/domain/entities/Deal.js';

const BUYER = 'buyer-1';
const SELLER = 'seller-1';
const REFUND_ADDRESS = 'fake-ltc-refund-address';

class SingleCurrencyFactory implements IBlockchainServiceFactory {
  constructor(private readonly service: FakeBlockchainService) {}
  getService(_currency: Currency): IBlockchainService {
    return this.service;
  }
}

function harness() {
  const dealRepository = new InMemoryDealRepository();
  const walletRepository = new InMemoryWalletRepository();
  const transactionRepository = new InMemoryTransactionRepository();
  const auditLogRepository = new InMemoryAuditLogRepository();
  const dealBackupRepository = new InMemoryDealBackupRepository();
  const clock = new FakeClock();
  const auditRecorder = new AuditRecorder(auditLogRepository, clock);
  const notifier = new FakeDiscordNotifier();
  const blockchainService = new FakeBlockchainService('LTC');
  const factory = new SingleCurrencyFactory(blockchainService);

  const requestRefund = new RequestRefundUseCase(
    dealRepository,
    notifier,
    auditRecorder,
    dealBackupRepository,
  );
  const submitRefundAddress = new SubmitRefundAddressUseCase(
    dealRepository,
    factory,
    notifier,
    auditRecorder,
    dealBackupRepository,
  );
  const confirmRefund = new ConfirmRefundUseCase(
    dealRepository,
    walletRepository,
    transactionRepository,
    factory,
    notifier,
    auditRecorder,
    dealBackupRepository,
  );

  return {
    dealRepository,
    walletRepository,
    transactionRepository,
    auditLogRepository,
    notifier,
    blockchainService,
    factory,
    auditRecorder,
    requestRefund,
    submitRefundAddress,
    confirmRefund,
  };
}

async function seedFundedDeal(h: ReturnType<typeof harness>): Promise<Deal> {
  const deal = makeDeal({ state: 'FUNDED', buyerDiscordId: BUYER, sellerDiscordId: SELLER });
  await h.dealRepository.save(deal);
  await h.walletRepository.save(
    Wallet.create({
      id: asWalletId('wallet-refund'),
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
      id: asTransactionId('tx-refund'),
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
  return deal;
}

describe('seller-initiated refund flow', () => {
  it('runs end to end: seller requests, buyer submits + confirms, funds go back to the buyer', async () => {
    const h = harness();
    const deal = await seedFundedDeal(h);

    const requested = await h.requestRefund.execute(deal.id, SELLER, 'SELLER');
    expect(requested.ok).toBe(true);
    if (requested.ok) expect(requested.value.state).toBe('REFUND_REQUESTED');

    const submitted = await h.submitRefundAddress.execute(deal.id, BUYER, REFUND_ADDRESS);
    expect(submitted.ok).toBe(true);
    if (submitted.ok) expect(submitted.value.refundAddress).toBe(REFUND_ADDRESS);

    const confirmed = await h.confirmRefund.execute(deal.id, BUYER);
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) expect(confirmed.value.state).toBe('REFUNDED');

    expect(h.blockchainService.sentPayouts).toHaveLength(1);
    // 1 LTC deposited minus the 0.0001 LTC network fee, sent to the buyer.
    expect(h.blockchainService.sentPayouts[0]?.outputs[0]?.address).toBe(REFUND_ADDRESS);
    expect(h.blockchainService.sentPayouts[0]?.outputs[0]?.amount.toDecimalString()).toBe('0.9999');
    expect(h.notifier.calls.map((c) => c.method)).toContain('refundCompleted');
  });

  it('rejects a refund request from the buyer', async () => {
    const h = harness();
    const deal = await seedFundedDeal(h);
    const result = await h.requestRefund.execute(deal.id, BUYER, 'SELLER');
    expect(result.ok).toBe(false);
  });

  it('rejects a refund address submitted by the seller', async () => {
    const h = harness();
    const deal = await seedFundedDeal(h);
    await h.requestRefund.execute(deal.id, SELLER, 'SELLER');
    const result = await h.submitRefundAddress.execute(deal.id, SELLER, REFUND_ADDRESS);
    expect(result.ok).toBe(false);
  });

  it('refuses to confirm a refund before an address has been submitted', async () => {
    const h = harness();
    const deal = await seedFundedDeal(h);
    await h.requestRefund.execute(deal.id, SELLER, 'SELLER');
    const result = await h.confirmRefund.execute(deal.id, BUYER);
    expect(result.ok).toBe(false);
    expect(h.blockchainService.sentPayouts).toHaveLength(0);
  });

  it('refuses to confirm a refund on behalf of anyone but the buyer', async () => {
    const h = harness();
    const deal = await seedFundedDeal(h);
    await h.requestRefund.execute(deal.id, SELLER, 'SELLER');
    await h.submitRefundAddress.execute(deal.id, BUYER, REFUND_ADDRESS);
    const result = await h.confirmRefund.execute(deal.id, SELLER);
    expect(result.ok).toBe(false);
    expect(h.blockchainService.sentPayouts).toHaveLength(0);
  });

  it('reverts to REFUND_REQUESTED (not stuck on REFUNDED) if the broadcast fails, so it stays retryable', async () => {
    const h = harness();
    const deal = await seedFundedDeal(h);
    await h.requestRefund.execute(deal.id, SELLER, 'SELLER');
    await h.submitRefundAddress.execute(deal.id, BUYER, REFUND_ADDRESS);

    h.blockchainService.failNextSend = true;
    const failed = await h.confirmRefund.execute(deal.id, BUYER);
    expect(failed.ok).toBe(false);
    const reloaded = await h.dealRepository.findById(deal.id);
    expect(reloaded?.state).toBe('REFUND_REQUESTED');

    // A retry now succeeds and moves the deal to REFUNDED.
    const retried = await h.confirmRefund.execute(deal.id, BUYER);
    expect(retried.ok).toBe(true);
    if (retried.ok) expect(retried.value.state).toBe('REFUNDED');
    expect(h.blockchainService.sentPayouts).toHaveLength(1);
  });
});
