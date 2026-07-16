import type { PrismaClient, Deal as PrismaDeal } from '@prisma/client';
import { Deal, type DealProps } from '../../domain/entities/Deal.js';
import { Money } from '../../domain/value-objects/Money.js';
import { assertCurrency } from '../../domain/value-objects/Currency.js';
import { assertDealState, type DealState, DEAL_STATES } from '../../domain/state-machine/DealState.js';
import { asDealId, type DealId } from '../../domain/value-objects/EntityId.js';
import type { IDealRepository } from '../../domain/repositories/IDealRepository.js';

function toDomain(row: PrismaDeal): Deal {
  const currency = assertCurrency(row.currency);
  const props: DealProps = {
    id: asDealId(row.id),
    guildId: row.guildId,
    ticketChannelId: row.ticketChannelId,
    currency,
    state: assertDealState(row.state),
    buyerDiscordId: row.buyerDiscordId,
    sellerDiscordId: row.sellerDiscordId,
    expectedAmount: Money.fromDecimalString(currency, row.expectedAmount),
    feeBasisPointsSnapshot: row.feeBasisPointsSnapshot,
    payoutAddress: row.payoutAddress,
    payoutAddressConfirmedBySeller: row.payoutAddressConfirmedBySeller,
    buyerReleaseConfirmed: row.buyerReleaseConfirmed,
    payoutAddressOverriddenByAdmin: row.payoutAddressOverriddenByAdmin,
    payoutOverrideReason: row.payoutOverrideReason,
    payoutOverrideByDiscordId: row.payoutOverrideByDiscordId,
    frozenFromState: row.frozenFromState ? assertDealState(row.frozenFromState) : null,
    frozenReason: row.frozenReason,
    frozenByDiscordId: row.frozenByDiscordId,
    cancelReason: row.cancelReason,
    refundReason: row.refundReason,
    refundAddress: row.refundAddress,
    payoutFeeTxId: row.payoutFeeTxId,
    payoutMainTxId: row.payoutMainTxId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    fundedAt: row.fundedAt,
    completedAt: row.completedAt,
  };
  return Deal.create(props);
}

function toPersistence(deal: Deal) {
  const props = deal.toProps();
  return {
    id: props.id,
    guildId: props.guildId,
    ticketChannelId: props.ticketChannelId,
    currency: props.currency,
    state: props.state,
    buyerDiscordId: props.buyerDiscordId,
    sellerDiscordId: props.sellerDiscordId,
    expectedAmount: props.expectedAmount.toDecimalString(),
    feeBasisPointsSnapshot: props.feeBasisPointsSnapshot,
    payoutAddress: props.payoutAddress,
    payoutAddressConfirmedBySeller: props.payoutAddressConfirmedBySeller,
    buyerReleaseConfirmed: props.buyerReleaseConfirmed,
    payoutAddressOverriddenByAdmin: props.payoutAddressOverriddenByAdmin,
    payoutOverrideReason: props.payoutOverrideReason,
    payoutOverrideByDiscordId: props.payoutOverrideByDiscordId,
    frozenFromState: props.frozenFromState,
    frozenReason: props.frozenReason,
    frozenByDiscordId: props.frozenByDiscordId,
    cancelReason: props.cancelReason,
    refundReason: props.refundReason,
    refundAddress: props.refundAddress,
    payoutFeeTxId: props.payoutFeeTxId,
    payoutMainTxId: props.payoutMainTxId,
    fundedAt: props.fundedAt,
    completedAt: props.completedAt,
  };
}

export class PrismaDealRepository implements IDealRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(deal: Deal): Promise<void> {
    const data = toPersistence(deal);
    await this.prisma.deal.upsert({
      where: { id: data.id },
      create: { ...data, createdAt: deal.toProps().createdAt },
      update: data,
    });
  }

  async saveIfCurrentStateIs(deal: Deal, expectedState: DealState): Promise<boolean> {
    const data = toPersistence(deal);
    const { count } = await this.prisma.deal.updateMany({
      where: { id: data.id, state: expectedState },
      data,
    });
    return count === 1;
  }

  async findById(id: DealId): Promise<Deal | null> {
    const row = await this.prisma.deal.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByTicketChannelId(channelId: string): Promise<Deal | null> {
    const row = await this.prisma.deal.findUnique({ where: { ticketChannelId: channelId } });
    return row ? toDomain(row) : null;
  }

  async findByStates(states: readonly DealState[]): Promise<Deal[]> {
    const rows = await this.prisma.deal.findMany({ where: { state: { in: [...states] } } });
    return rows.map(toDomain);
  }

  async countByState(guildId: string): Promise<Record<DealState, number>> {
    const grouped = await this.prisma.deal.groupBy({
      by: ['state'],
      where: { guildId },
      _count: { _all: true },
    });
    const result = Object.fromEntries(DEAL_STATES.map((state) => [state, 0])) as Record<DealState, number>;
    for (const group of grouped) {
      result[assertDealState(group.state)] = group._count._all;
    }
    return result;
  }
}
