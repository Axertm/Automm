import { ChannelType, type Client, type TextChannel } from 'discord.js';
import type { Logger } from 'pino';
import type { IDiscordNotifier } from '../../../application/ports/IDiscordNotifier.js';
import type { IDealRepository } from '../../../domain/repositories/IDealRepository.js';
import type { IWalletRepository } from '../../../domain/repositories/IWalletRepository.js';
import type { IPartyRepository } from '../../../domain/repositories/IPartyRepository.js';
import type { DealId } from '../../../domain/value-objects/EntityId.js';
import type { Env } from '../../../config/env.schema.js';
import { buildDealStatusEmbed, buildTxidExplorerLink } from '../embeds/DealEmbedBuilder.js';
import { buildSimpleEmbed } from '../embeds/SimpleEmbed.js';
import { buildDealActionRow } from '../components/buttons/dealActionRow.js';

/**
 * Implements IDiscordNotifier. Most transitions edit the deal's pinned
 * status message in place (found via its footer "Deal ID: …" rather than a
 * stored message id, so no schema change was needed). A "full step" — one
 * where a two-party gate just closed (both sides have now acted, not just
 * one) — instead posts a brand-new status embed and re-pins it, so that
 * milestone stands out as its own message in the channel history rather
 * than silently overwriting the previous one. Every message this class
 * sends is an embed, never a bare content string.
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

  private async findPinnedStatusMessage(channel: TextChannel, dealId: DealId) {
    const pinned = await channel.messages.fetchPinned().catch(() => null);
    return pinned?.find(
      (message) =>
        message.author.id === this.client.user?.id &&
        message.embeds[0]?.footer?.text === `Deal ID: ${dealId}`,
    );
  }

  /** Edits the pinned status message in place — used for partial/single-sided progress (only one party has acted so far). */
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
    const existing = await this.findPinnedStatusMessage(channel, dealId);

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

  /**
   * Always posts a fresh status embed and pins it, unpinning whatever
   * status message was pinned before — used when a two-party gate just
   * closed (e.g. the seller's confirmation lands on top of the buyer's
   * already-recorded confirmation) so that milestone gets its own visible
   * message instead of quietly replacing the previous one. An optional
   * `content` string rides alongside the embed in the same message — used
   * to @-mention both parties, since Discord only notifies on mentions in
   * message content, never on mentions inside an embed.
   */
  private async postNewStatusEmbed(dealId: DealId, content?: string): Promise<void> {
    const [deal, wallet, channel] = await Promise.all([
      this.dealRepository.findById(dealId),
      this.walletRepository.findByDealId(dealId),
      this.getTicketChannel(dealId),
    ]);
    if (!deal || !channel) return;

    const embed = buildDealStatusEmbed(deal, wallet);
    const row = buildDealActionRow(deal);
    const components = row ? [row] : [];

    const previous = await this.findPinnedStatusMessage(channel, dealId);
    const sent = await channel.send({ content, embeds: [embed], components }).catch(() => null);
    if (!sent) return;
    if (previous) await previous.unpin().catch(() => undefined);
    await sent.pin().catch(() => undefined);
  }

  private async sendEvent(dealId: DealId, description: string, tone: Parameters<typeof buildSimpleEmbed>[1] = 'info'): Promise<void> {
    const channel = await this.getTicketChannel(dealId);
    await channel?.send({ embeds: [buildSimpleEmbed(description, tone)] }).catch(() => undefined);
  }

  async dealFunded(dealId: DealId): Promise<void> {
    // Both "sides" of funding (deposit arriving + confirmation threshold met)
    // just closed — a real milestone, so it gets a fresh pinned message, with
    // both parties @-mentioned and the "Release Funds" button (via
    // buildDealActionRow) all in that single message.
    const deal = await this.dealRepository.findById(dealId);
    if (!deal) return;
    await this.postNewStatusEmbed(
      dealId,
      `<@${deal.buyerDiscordId}> <@${deal.sellerDiscordId}> ✅ Deal is fully funded and confirmed. The buyer may release funds whenever ready.`,
    );
  }

  async depositDetected(dealId: DealId, txid: string, confirmations: number): Promise<void> {
    const deal = await this.dealRepository.findById(dealId);
    if (!deal) return;
    const link = buildTxidExplorerLink(deal.currency, txid);
    await this.sendEvent(
      dealId,
      `💰 Deposit detected: ${link} (${confirmations} confirmation${confirmations === 1 ? '' : 's'})`,
    );
  }

  async releaseRequested(dealId: DealId): Promise<void> {
    // Only the buyer/admin has acted so far — waiting on the buyer's own
    // final confirmation next, so this edits the existing message in place.
    await this.upsertStatusEmbed(dealId);
    await this.sendEvent(dealId, '🔓 Release requested. Buyer, please give your final confirmation to proceed.');
  }

  async releaseConfirmedByBuyer(dealId: DealId): Promise<void> {
    // Only the buyer's side of the gate is done — still waiting on the
    // seller, so this is still a partial step (edit in place).
    await this.upsertStatusEmbed(dealId);
    await this.sendEvent(dealId, '✅ Buyer confirmed the release. Seller, please submit your payout address.', 'success');
  }

  async payoutAddressSubmitted(dealId: DealId): Promise<void> {
    // The seller has submitted an address but not yet confirmed it — still partial.
    await this.upsertStatusEmbed(dealId);
    await this.sendEvent(dealId, '📮 Seller submitted a payout address. Please review and confirm it — this is final.');
  }

  async payoutConfirmedBySeller(dealId: DealId): Promise<void> {
    // This is the moment BOTH sides of the release gate are now satisfied
    // (buyer already confirmed earlier, seller's confirmation just landed)
    // — a full step, so it gets its own fresh pinned message.
    await this.postNewStatusEmbed(dealId);
    await this.sendEvent(dealId, '✅ Seller confirmed the payout address. Broadcasting payout…', 'success');
  }

  async payoutCompleted(dealId: DealId): Promise<void> {
    await this.postNewStatusEmbed(dealId);
    await this.sendEvent(dealId, '🎉 Payout completed. This deal is now closed.', 'success');
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

  async refundRequested(dealId: DealId): Promise<void> {
    // Only the seller/admin has acted so far — waiting on the buyer to submit
    // an address next, so this edits the existing message in place.
    await this.upsertStatusEmbed(dealId);
    await this.sendEvent(
      dealId,
      '↩️ Seller offered a refund. Buyer, please submit the address to receive your funds back.',
    );
  }

  async refundAddressSubmitted(dealId: DealId): Promise<void> {
    // The buyer has submitted an address but not yet confirmed it — still partial.
    await this.upsertStatusEmbed(dealId);
    await this.sendEvent(dealId, '📮 Buyer submitted a refund address. Please review and confirm it — this is final.');
  }

  async refundCompleted(dealId: DealId): Promise<void> {
    // Both sides of the refund gate are now satisfied (seller requested, buyer
    // confirmed the address) and the funds have been broadcast — a full step,
    // so it gets its own fresh pinned message.
    await this.postNewStatusEmbed(dealId);
    await this.sendEvent(dealId, '↩️ Refund sent back to the buyer. This deal is now closed.', 'success');
  }

  async dealStateChanged(dealId: DealId): Promise<void> {
    await this.upsertStatusEmbed(dealId);
  }
}
