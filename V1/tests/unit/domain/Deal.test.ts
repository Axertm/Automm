import { describe, expect, it } from 'vitest';
import { Deal, type DealProps } from '../../../src/domain/entities/Deal.js';
import { Money } from '../../../src/domain/value-objects/Money.js';
import { asDealId } from '../../../src/domain/value-objects/EntityId.js';
import {
  InvalidTransitionError,
  PayoutConfirmationIncompleteError,
  UnauthorizedActorError,
} from '../../../src/domain/errors/DomainErrors.js';

const BUYER = 'buyer-1';
const SELLER = 'seller-1';
const ADMIN = 'admin-1';

function makeDeal(overrides: Partial<DealProps> = {}): Deal {
  const props: DealProps = {
    id: asDealId('deal-1'),
    guildId: 'guild-1',
    ticketChannelId: 'channel-1',
    currency: 'LTC',
    state: 'CREATED',
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
    fundedAt: null,
    completedAt: null,
    ...overrides,
  };
  return Deal.create(props);
}

function fundedDeal(): Deal {
  const deal = makeDeal({ state: 'AWAITING_DEPOSIT' });
  deal.recordDeposit(Money.fromDecimalString('LTC', '1'));
  return deal;
}

function awaitingPayoutConfirmationDeal(): Deal {
  const deal = fundedDeal();
  deal.requestRelease(BUYER, 'BUYER');
  deal.submitPayoutAddress(SELLER, 'ltc1qvee0vzxmw43yer44jse3u0qkylkftk7w5x8esm');
  deal.confirmPayoutAddressBySeller(SELLER);
  return deal;
}

describe('Deal', () => {
  it('moves through the full funding lifecycle on a single full deposit', () => {
    const deal = makeDeal();
    deal.markAwaitingDeposit();
    expect(deal.state).toBe('AWAITING_DEPOSIT');
    deal.recordDeposit(Money.fromDecimalString('LTC', '1'));
    expect(deal.state).toBe('FUNDED');
  });

  it('moves through PARTIALLY_FUNDED before FUNDED on incremental deposits', () => {
    const deal = makeDeal({ state: 'AWAITING_DEPOSIT' });
    deal.recordDeposit(Money.fromDecimalString('LTC', '0.4'));
    expect(deal.state).toBe('PARTIALLY_FUNDED');
    deal.recordDeposit(Money.fromDecimalString('LTC', '1'));
    expect(deal.state).toBe('FUNDED');
  });

  it('rejects release requests from anyone but the buyer or an admin', () => {
    const deal = fundedDeal();
    expect(() => deal.requestRelease(SELLER, 'SELLER' as never)).toThrow(UnauthorizedActorError);
  });

  it('allows an admin to force a release request', () => {
    const deal = fundedDeal();
    expect(() => deal.requestRelease(ADMIN, 'ADMIN')).not.toThrow();
    expect(deal.state).toBe('RELEASE_REQUESTED');
  });

  it('rejects the seller submitting a payout address before release is requested', () => {
    const deal = fundedDeal();
    expect(() => deal.submitPayoutAddress(SELLER, 'addr')).toThrow(InvalidTransitionError);
  });

  it('rejects the buyer submitting a payout address (only the seller may)', () => {
    const deal = fundedDeal();
    deal.requestRelease(BUYER, 'BUYER');
    expect(() => deal.submitPayoutAddress(BUYER, 'addr')).toThrow(UnauthorizedActorError);
  });

  it('requires both seller address confirmation and buyer release confirmation before payout starts', () => {
    const deal = awaitingPayoutConfirmationDeal();
    expect(() => deal.startPayout()).toThrow(PayoutConfirmationIncompleteError);
    deal.confirmReleaseByBuyer(BUYER);
    expect(() => deal.startPayout()).not.toThrow();
    expect(deal.state).toBe('PAYOUT_IN_PROGRESS');
  });

  it('rejects the seller confirming release (only the buyer may)', () => {
    const deal = awaitingPayoutConfirmationDeal();
    expect(() => deal.confirmReleaseByBuyer(SELLER)).toThrow(UnauthorizedActorError);
  });

  it('completes only once both fee and payout transactions are recorded', () => {
    const deal = awaitingPayoutConfirmationDeal();
    deal.confirmReleaseByBuyer(BUYER);
    deal.startPayout();
    expect(() => deal.markCompleted()).toThrow(PayoutConfirmationIncompleteError);
    deal.recordPayoutFeeTx('fee-tx');
    expect(() => deal.markCompleted()).toThrow(PayoutConfirmationIncompleteError);
    deal.recordPayoutMainTx('main-tx');
    expect(() => deal.markCompleted()).not.toThrow();
    expect(deal.state).toBe('COMPLETED');
  });

  describe('freeze / unfreeze', () => {
    it('freezes from a live state and restores it on unfreeze', () => {
      const deal = fundedDeal();
      deal.freeze(ADMIN, 'suspicious activity');
      expect(deal.state).toBe('FROZEN');
      expect(deal.frozenFromState).toBe('FUNDED');
      deal.unfreeze();
      expect(deal.state).toBe('FUNDED');
      expect(deal.frozenFromState).toBeNull();
    });

    it('refuses to freeze a deal already in PAYOUT_IN_PROGRESS', () => {
      const deal = awaitingPayoutConfirmationDeal();
      deal.confirmReleaseByBuyer(BUYER);
      deal.startPayout();
      expect(() => deal.freeze(ADMIN, 'reason')).toThrow(InvalidTransitionError);
    });
  });

  describe('refund', () => {
    it('refunds a funded deal directly', () => {
      const deal = fundedDeal();
      deal.refund(ADMIN, 'buyer requested refund', 'ltc1qrefundaddress');
      expect(deal.state).toBe('REFUNDED');
    });

    it('refunds a deal that was frozen while funded', () => {
      const deal = fundedDeal();
      deal.freeze(ADMIN, 'dispute');
      deal.refund(ADMIN, 'resolved in favor of buyer', 'ltc1qrefundaddress');
      expect(deal.state).toBe('REFUNDED');
    });

    it('refuses to refund an unfunded deal', () => {
      const deal = makeDeal({ state: 'AWAITING_DEPOSIT' });
      expect(() => deal.refund(ADMIN, 'reason', 'addr')).toThrow(InvalidTransitionError);
    });
  });

  describe('cancel', () => {
    it('cancels an unfunded deal', () => {
      const deal = makeDeal();
      deal.cancel('buyer changed their mind');
      expect(deal.state).toBe('CANCELLED');
    });

    it('refuses to cancel a funded deal', () => {
      const deal = fundedDeal();
      expect(() => deal.cancel('oops')).toThrow(InvalidTransitionError);
    });
  });

  describe('admin override of payout address', () => {
    it('substitutes for seller confirmation but still requires buyer confirmation before payout', () => {
      const deal = fundedDeal();
      deal.requestRelease(BUYER, 'BUYER');
      deal.overridePayoutAddressByAdmin(
        ADMIN,
        'ltc1qoverrideaddress000000000000000000',
        'seller wallet compromised, dispute resolved',
      );
      expect(deal.state).toBe('AWAITING_PAYOUT_CONFIRMATION');
      expect(deal.payoutAddressConfirmedBySeller).toBe(true);
      expect(() => deal.startPayout()).toThrow(PayoutConfirmationIncompleteError);
      deal.confirmReleaseByBuyer(BUYER);
      expect(() => deal.startPayout()).not.toThrow();
    });

    it('requires a non-empty reason', () => {
      const deal = fundedDeal();
      deal.requestRelease(BUYER, 'BUYER');
      expect(() => deal.overridePayoutAddressByAdmin(ADMIN, 'addr', '   ')).toThrow();
    });

    it('rejects override outside RELEASE_REQUESTED/AWAITING_PAYOUT_CONFIRMATION', () => {
      const deal = fundedDeal();
      expect(() => deal.overridePayoutAddressByAdmin(ADMIN, 'addr', 'reason')).toThrow(
        InvalidTransitionError,
      );
    });
  });
});
