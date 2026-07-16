import { Deal, type DealProps } from '../../src/domain/entities/Deal.js';
import { Money } from '../../src/domain/value-objects/Money.js';
import { asDealId } from '../../src/domain/value-objects/EntityId.js';

let counter = 0;

export function makeDealProps(overrides: Partial<DealProps> = {}): DealProps {
  counter += 1;
  return {
    id: asDealId(`deal-${counter}`),
    guildId: 'guild-1',
    ticketChannelId: `channel-${counter}`,
    currency: 'LTC',
    state: 'FUNDED',
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
    ...overrides,
  };
}

export function makeDeal(overrides: Partial<DealProps> = {}): Deal {
  return Deal.create(makeDealProps(overrides));
}
