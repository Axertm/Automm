import { ChannelType, type Client, type TextChannel } from 'discord.js';
import type { Logger } from 'pino';
import type { IDiscordNotifier } from '../../../application/ports/IDiscordNotifier.js';
import type { IDealRepository } from '../../../domain/repositories/IDealRepository.js';
import type { IWalletRepository } from '../../../domain/repositories/IWalletRepository.js';
import type { IPartyRepository } from '../../../domain/repositories/IPartyRepository.js';
import type { DealId } from '../../../domain/value-objects/EntityId.js';
import type { Env } from '../../../config/env.schema.js';
import { buildDealStatusEmbed, buildTxidExplorerLink } from '../embeds/DealEmbedBuilder.js';
import { buildDealActionRow } from '../components/buttons/dealActionRow.js';

/**
 * Implements IDiscordNotifier by editing the deal's pinned status message in
 * place (found via its footer "Deal ID: …" rather than a stored message id,
 * so no schema change was needed) and posting a scrolling event log for
 * individual notable events.
 */
export class DiscordNotifier implements IDiscordNotifier {
  constructor(
    private readonly client: Client,
    private readonly dealRepository: IDealRepository,
    private readonly walletRepository: IWalletRepository,
    private readonly partyRepository: IPartyRepository,
    private readonly env: Env,
    private readonly logger: Logger,
  ) {}

  private async getTicketChannel(dealId: DealId): Promise<TextChannel | null> {
    const deal = await this.dealRepository.findById(dealId);
    if (!deal) return null;
    const channel = await this.client.channels.fetch(deal.toProps().ticketChannelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) return null;
    return channel;
  }

  private async upsertStatusEmbed(dealId: DealId): Promise<void> {
    const [deal, wallet, channel] = await Promise.all([
      this.dealRepository.findById(dealId),
      this.walletRepository.findByDealId(dealId),
      this.getTicketChannel(dealId),
    ]);
    if (!deal || !channel) return;

    const embed = buildDealStatusEmbed(deal, wallet);
    const row = buildDealActionRow(deal);
    const components = row ? [row] : [];
    const pinned = await channel.messages.fetchPinned().catch(() => null);
    const existing = pinned?.find(
      (message) =>
        message.author.id === this.client.user?.id &&
        message.embeds[0]?.footer?.text === `Deal ID: ${dealId}`,
    );

    if (existing) {
      await existing
        .edit({ embeds: [embed], components })
        .catch((error: Error) =>
          this.logger.warn({ dealId, err: error.message }, 'status_embed_edit_failed'),
        );
    } else {
      const sent = await channel.send({ embeds: [embed], components }).catch(() => null);
      if (sent) await sent.pin().catch(() => undefined);
    }
  }

  async dealFunded(dealId: DealId): Promise<void> {
    await this.upsertStatusEmbed(dealId);
    const channel = await this.getTicketChannel(dealId);
    await channel
      ?.send('✅ Deal is fully funded and confirmed. The buyer may now `/release` when ready.')
      .catch(() => undefined);
  }

  async depositDetected(dealId: DealId, txid: string, confirmations: number): Promise<void> {
    const deal = await this.dealRepository.findById(dealId);
    const channel = await this.getTicketChannel(dealId);
    if (!deal || !channel) return;
    const link = buildTxidExplorerLink(deal.currency, txid);
    await channel
      .send(`💰 Deposit detected: ${link} (${confirmations} confirmation${confirmations === 1 ? '' : 's'})`)
      .catch(() => undefined);
  }

  async releaseRequested(dealId: DealId): Promise<void> {
    await this.upsertStatusEmbed(dealId);
    const channel = await this.getTicketChannel(dealId);
    await channel
      ?.send('🔓 Release requested. Seller, please submit your payout address.')
      .catch(() => undefined);
  }

  async payoutAddressSubmitted(dealId: DealId): Promise<void> {
    await this.upsertStatusEmbed(dealId);
    const channel = await this.getTicketChannel(dealId);
    await channel
      ?.send('📮 Seller submitted a payout address. Please confirm it is correct.')
      .catch(() => undefined);
  }

  async payoutConfirmedBySeller(dealId: DealId): Promise<void> {
    await this.upsertStatusEmbed(dealId);
    const channel = await this.getTicketChannel(dealId);
    await channel
      ?.send(
        '✅ Seller confirmed the payout address. Buyer, please give final confirmation to release funds.',
      )
      .catch(() => undefined);
  }

  async payoutCompleted(dealId: DealId): Promise<void> {
    await this.upsertStatusEmbed(dealId);
    const channel = await this.getTicketChannel(dealId);
    await channel?.send('🎉 Payout completed. This deal is now closed.').catch(() => undefined);
    await this.awardCompletionRoles(dealId);
  }

  /**
   * Marks each Party's completedFlag and, if BUYER_COMPLETED_ROLE_ID /
   * SELLER_COMPLETED_ROLE_ID are configured, assigns the corresponding
   * Discord role. Both are optional — if unset, this is a silent no-op
   * rather than a required setup step.
   */
  private async awardCompletionRoles(dealId: DealId): Promise<void> {
    const deal = await this.dealRepository.findById(dealId);
    if (!deal) return;

    const parties = await this.partyRepository.findByDealId(dealId);
    for (const party of parties) {
      if (party.role !== 'BUYER' && party.role !== 'SELLER') continue;
      party.markCompleted();
      await this.partyRepository.save(party);
    }

    const roleIdByRole: Record<'BUYER' | 'SELLER', string> = {
      BUYER: this.env.BUYER_COMPLETED_ROLE_ID,
      SELLER: this.env.SELLER_COMPLETED_ROLE_ID,
    };
    if (!roleIdByRole.BUYER && !roleIdByRole.SELLER) return;

    const guild = await this.client.guilds.fetch(deal.toProps().guildId).catch(() => null);
    if (!guild) return;

    for (const [role, discordUserId] of [
      ['BUYER', deal.buyerDiscordId],
      ['SELLER', deal.sellerDiscordId],
    ] as const) {
      const roleId = roleIdByRole[role];
      if (!roleId) continue;
      const member = await guild.members.fetch(discordUserId).catch(() => null);
      await member?.roles
        .add(roleId)
        .catch((error: Error) =>
          this.logger.warn(
            { dealId, discordUserId, roleId, err: error.message },
            'completion_role_assign_failed',
          ),
        );
    }
  }

  async dealStateChanged(dealId: DealId): Promise<void> {
    await this.upsertStatusEmbed(dealId);
  }
}
