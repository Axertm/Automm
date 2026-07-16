import { describe, expect, it } from 'vitest';
import { RequestReleaseUseCase } from '../../../src/application/use-cases/release/RequestReleaseUseCase.js';
import { SubmitPayoutAddressUseCase } from '../../../src/application/use-cases/release/SubmitPayoutAddressUseCase.js';
import { ConfirmPayoutWalletUseCase } from '../../../src/application/use-cases/release/ConfirmPayoutWalletUseCase.js';
import { ConfirmReleaseUseCase } from '../../../src/application/use-cases/release/ConfirmReleaseUseCase.js';
import { ExecutePayoutUseCase } from '../../../src/application/use-cases/release/ExecutePayoutUseCase.js';
import { AuditRecorder } from '../../../src/application/services/AuditRecorder.js';
import {
  InMemoryDealRepository,
  InMemoryWalletRepository,
  InMemoryTransactionRepository,
  InMemoryAuditLogRepository,
} from '../../fakes/InMemoryRepositories.js';
import { FakeClock } from '../../fakes/FakeClock.js';
import { FakeBlockchainService } from '../../fakes/FakeBlockchainService.js';
import { FakeDiscordNotifier } from '../../fakes/FakeDiscordNotifier.js';
import { Deal, type DealProps } from '../../../src/domain/entities/Deal.js';
import { Wallet } from '../../../src/domain/entities/Wallet.js';
import { Money } from '../../../src/domain/value-objects/Money.js';
import { asDealId, asWalletId } from '../../../src/domain/value-objects/EntityId.js';
import type { IBlockchainServiceFactory } from '../../../src/application/ports/IBlockchainServiceFactory.js';
import type { IFeeWalletProvider } from '../../../src/application/ports/IFeeWalletProvider.js';
import type { Currency } from '../../../src/domain/value-objects/Currency.js';
import type { IBlockchainService } from '../../../src/application/ports/IBlockchainService.js';

const BUYER = 'buyer-1';
const SELLER = 'seller-1';
const SELLER_PAYOUT_ADDRESS = 'fake-ltc-seller-payout-address';

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

function buildHarness() {
  const dealRepository = new InMemoryDealRepository();
  const walletRepository = new InMemoryWalletRepository();
  const transactionRepository = new InMemoryTransactionRepository();
  const auditLogRepository = new InMemoryAuditLogRepository();
  const clock = new FakeClock();
  const auditRecorder = new AuditRecorder(auditLogRepository, clock);
  const notifier = new FakeDiscordNotifier();
  const blockchainService = new FakeBlockchainService('LTC');
  const factory = new SingleCurrencyFactory(blockchainService);
  const feeWalletProvider = new StubFeeWalletProvider();

  const requestRelease = new RequestReleaseUseCase(dealRepository, notifier, auditRecorder);
  const submitPayoutAddress = new SubmitPayoutAddressUseCase(
    dealRepository,
    factory,
    notifier,
    auditRecorder,
  );
  const confirmPayoutWallet = new ConfirmPayoutWalletUseCase(dealRepository, notifier, auditRecorder);
  const executePayout = new ExecutePayoutUseCase(
    dealRepository,
    walletRepository,
    transactionRepository,
    factory,
    feeWalletProvider,
    notifier,
    auditRecorder,
    clock,
  );
  const confirmRelease = new ConfirmReleaseUseCase(dealRepository, executePayout, auditRecorder);

  return {
    dealRepository,
    walletRepository,
    transactionRepository,
    notifier,
    blockchainService,
    requestRelease,
    submitPayoutAddress,
    confirmPayoutWallet,
    confirmRelease,
  };
}

async function seedFundedDeal(
  dealRepository: InMemoryDealRepository,
  walletRepository: InMemoryWalletRepository,
) {
  const props: DealProps = {
    id: asDealId('deal-1'),
    guildId: 'guild-1',
    ticketChannelId: 'channel-1',
    currency: 'LTC',
    state: 'FUNDED',
    buyerDiscordId: BUYER,
    sellerDiscordId: SELLER,
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
    fundedAt: new Date(),
    completedAt: null,
  };
  const deal = Deal.create(props);
  await dealRepository.save(deal);

  const wallet = Wallet.create({
    id: asWalletId('wallet-1'),
    dealId: deal.id,
    currency: 'LTC',
    address: 'fake-ltc-deposit-address',
    encryptedPrivateKey: { iv: 'iv', authTag: 'tag', ciphertext: 'cipher', keyVersion: 1 },
    derivationPath: null,
    createdAt: new Date(),
  });
  await walletRepository.save(wallet);

  return deal;
}

describe('Release flow (RequestRelease -> SubmitPayoutAddress -> ConfirmPayoutWallet -> ConfirmRelease -> ExecutePayout)', () => {
  it('runs the full happy path and reaches PAYOUT_IN_PROGRESS with a broadcast payout tx', async () => {
    const h = buildHarness();
    const deal = await seedFundedDeal(h.dealRepository, h.walletRepository);

    const requestResult = await h.requestRelease.execute(deal.id, BUYER, 'BUYER');
    expect(requestResult.ok).toBe(true);

    const submitResult = await h.submitPayoutAddress.execute(deal.id, SELLER, SELLER_PAYOUT_ADDRESS);
    expect(submitResult.ok).toBe(true);

    const confirmWalletResult = await h.confirmPayoutWallet.execute(deal.id, SELLER);
    expect(confirmWalletResult.ok).toBe(true);
    if (confirmWalletResult.ok) {
      expect(confirmWalletResult.value.state).toBe('AWAITING_PAYOUT_CONFIRMATION');
    }

    const confirmReleaseResult = await h.confirmRelease.execute(deal.id, BUYER);
    expect(confirmReleaseResult.ok).toBe(true);
    if (confirmReleaseResult.ok) {
      expect(confirmReleaseResult.value.state).toBe('PAYOUT_IN_PROGRESS');
      expect(confirmReleaseResult.value.payoutFeeTxId).not.toBeNull();
      expect(confirmReleaseResult.value.payoutMainTxId).not.toBeNull();
    }

    expect(h.blockchainService.sentPayouts).toHaveLength(1);
    const payout = h.blockchainService.sentPayouts[0]!;
    expect(payout.outputs).toHaveLength(2);
    const [feeOutput, sellerOutput] = payout.outputs;
    expect(feeOutput!.amount.add(sellerOutput!.amount).toDecimalString()).toBe('1');

    const transactions = await h.transactionRepository.findByDealId(deal.id);
    expect(transactions.map((t) => t.direction).sort()).toEqual(['FEE', 'PAYOUT']);
  });

  it('rejects payout execution before both parties confirm (two-party gate)', async () => {
    const h = buildHarness();
    const deal = await seedFundedDeal(h.dealRepository, h.walletRepository);

    await h.requestRelease.execute(deal.id, BUYER, 'BUYER');
    await h.submitPayoutAddress.execute(deal.id, SELLER, SELLER_PAYOUT_ADDRESS);
    // Seller has NOT yet confirmed the address — buyer tries to confirm release early.
    const earlyConfirm = await h.confirmRelease.execute(deal.id, BUYER);
    expect(earlyConfirm.ok).toBe(false);
    expect(h.blockchainService.sentPayouts).toHaveLength(0);
  });

  it('rejects the seller submitting a payout address (only the buyer can request release)', async () => {
    const h = buildHarness();
    const deal = await seedFundedDeal(h.dealRepository, h.walletRepository);
    const result = await h.requestRelease.execute(deal.id, SELLER, 'BUYER');
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid seller-submitted payout address', async () => {
    const h = buildHarness();
    const deal = await seedFundedDeal(h.dealRepository, h.walletRepository);
    await h.requestRelease.execute(deal.id, BUYER, 'BUYER');

    h.blockchainService.validateAddress = () => false;
    const result = await h.submitPayoutAddress.execute(deal.id, SELLER, 'not-a-real-address');
    expect(result.ok).toBe(false);
  });

  it('leaves the deal recoverable in PAYOUT_IN_PROGRESS if the broadcast fails', async () => {
    const h = buildHarness();
    const deal = await seedFundedDeal(h.dealRepository, h.walletRepository);

    await h.requestRelease.execute(deal.id, BUYER, 'BUYER');
    await h.submitPayoutAddress.execute(deal.id, SELLER, SELLER_PAYOUT_ADDRESS);
    await h.confirmPayoutWallet.execute(deal.id, SELLER);

    h.blockchainService.failNextSend = true;
    const result = await h.confirmRelease.execute(deal.id, BUYER);
    expect(result.ok).toBe(false);

    const persisted = await h.dealRepository.findById(deal.id);
    expect(persisted?.state).toBe('PAYOUT_IN_PROGRESS');
    expect(persisted?.payoutFeeTxId).toBeNull();
  });
});
