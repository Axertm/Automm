import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type TextChannel,
} from 'discord.js';
import { encodeCustomId } from '../../interaction-router/CustomId.js';
import { buildProgressEmbed } from '../progressEmbed.js';
import { buildDealStatusEmbed } from '../../embeds/DealEmbedBuilder.js';
import { buildDepositWalletEmbed } from '../../embeds/WalletEmbedBuilder.js';
import { buildSimpleEmbed } from '../../embeds/SimpleEmbed.js';
import type { DealWizardState } from '../DealWizardState.js';
import type { AppDependencies } from '../../AppDependencies.js';
import type { HandlerRegistry } from '../../interaction-router/HandlerRegistry.js';

export function buildFinalSummaryMessage(state: DealWizardState, deps: AppDependencies) {
  const feeBps = deps.env.FEE_BASIS_POINTS;
  const embed = buildProgressEmbed(
    state,
    'Final Confirmation',
    'Both buyer and seller must click **Confirm Deal** below. Nothing is created until both confirm.',
  );
  embed.addFields(
    { name: 'Deal ID', value: state.dealId, inline: true },
    { name: 'Buyer', value: `<@${state.buyerId}>`, inline: true },
    { name: 'Seller', value: `<@${state.sellerId}>`, inline: true },
    { name: 'Coin', value: state.currency ?? '—', inline: true },
    {
      name: 'Amount',
      value: `$${state.usdAmountDecimal} → ${state.amountDecimal} ${state.currency}`,
      inline: true,
    },
    { name: 'Escrow Fee', value: `${(feeBps / 100).toFixed(2)}%`, inline: true },
    {
      name: 'Required Confirmations',
      value: state.currency === 'LTC' ? String(deps.env.LTC_REQUIRED_CONFIRMATIONS) : 'Finalized (Solana)',
      inline: true,
    },
    {
      name: 'Confirmations so far',
      value: `${state.buyerFinalConfirmed ? '✅' : '⬜'} Buyer   ${state.sellerFinalConfirmed ? '✅' : '⬜'} Seller`,
    },
  );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeCustomId('wizard', 'final_confirm', state.dealId))
      .setLabel('Confirm Deal')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(encodeCustomId('wizard', 'final_cancel', state.dealId))
      .setLabel('Cancel Deal')
      .setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row] };
}

async function finalizeDeal(
  interaction: ButtonInteraction,
  state: DealWizardState,
  deps: AppDependencies,
): Promise<void> {
  if (!state.currency || !state.buyerId || !state.sellerId || !state.amountDecimal) return;

  const dealResult = await deps.createDeal.execute(
    {
      guildId: state.guildId,
      ticketChannelId: state.channelId,
      currency: state.currency,
      buyerDiscordId: state.buyerId,
      sellerDiscordId: state.sellerId,
      expectedAmountDecimal: state.amountDecimal,
      feeBasisPoints: deps.env.FEE_BASIS_POINTS,
    },
    state.dealId,
  );

  if (!dealResult.ok) {
    await interaction.followUp({
      embeds: [buildSimpleEmbed(`Could not finalize the deal: ${dealResult.error.message}`, 'error')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const walletResult = await deps.generateDepositWallet.execute(dealResult.value.id);
  if (!walletResult.ok) {
    await interaction.followUp({
      embeds: [
        buildSimpleEmbed(
          `Deal was created but wallet generation failed: ${walletResult.error.message}. An admin will need to investigate.`,
          'error',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  deps.dealWizardStore.delete(state.channelId);

  const channel = interaction.channel as TextChannel;
  const statusEmbed = buildDealStatusEmbed(walletResult.value.deal, walletResult.value.wallet);
  const { embed: walletEmbed, files } = await buildDepositWalletEmbed(walletResult.value.wallet);

  const statusMessage = await channel.send({ embeds: [statusEmbed] });
  await statusMessage.pin().catch(() => undefined);
  await channel.send({ embeds: [walletEmbed], files });
  await channel.send({
    embeds: [
      buildSimpleEmbed(
        '✅ Deal finalized. Deposit monitoring has begun — the wallet above is scanned automatically every 2 minutes.',
        'success',
      ),
    ],
  });
}

async function handleConfirm(interaction: ButtonInteraction, deps: AppDependencies): Promise<void> {
  const state = deps.dealWizardStore.get(interaction.channelId);
  if (!state) {
    await interaction.reply({
      embeds: [buildSimpleEmbed('This wizard session has expired. Please create a new ticket.', 'error')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.user.id !== state.buyerId && interaction.user.id !== state.sellerId) {
    await interaction.reply({
      embeds: [buildSimpleEmbed('Only the buyer or seller of this deal may confirm it.', 'error')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const patch =
    interaction.user.id === state.buyerId ? { buyerFinalConfirmed: true } : { sellerFinalConfirmed: true };
  const updated = deps.dealWizardStore.update(interaction.channelId, patch);
  if (!updated) return;

  if (updated.buyerFinalConfirmed && updated.sellerFinalConfirmed) {
    await interaction.update({
      embeds: [new EmbedBuilder().setTitle('⏳ Finalizing deal…').setColor(0x5865f2)],
      components: [],
    });
    await finalizeDeal(interaction, updated, deps);
  } else {
    await interaction.update(buildFinalSummaryMessage(updated, deps));
  }
}

async function handleCancel(interaction: ButtonInteraction, deps: AppDependencies): Promise<void> {
  const state = deps.dealWizardStore.get(interaction.channelId);
  if (!state) return;

  if (interaction.user.id !== state.buyerId && interaction.user.id !== state.sellerId) {
    await interaction.reply({
      embeds: [buildSimpleEmbed('Only the buyer or seller of this deal may cancel it.', 'error')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  deps.dealWizardStore.delete(interaction.channelId);
  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle('🚫 Deal setup cancelled')
        .setDescription(
          `Cancelled by <@${interaction.user.id}>. No deal was created — nothing was ever at risk. An admin can close this ticket with \`/close\`.`,
        )
        .setColor(0x7f8c8d),
    ],
    components: [],
  });
}

export function registerFinalStepHandlers(registry: HandlerRegistry): void {
  registry.registerButton('wizard:final_confirm', (interaction, _decoded, deps) =>
    handleConfirm(interaction, deps),
  );
  registry.registerButton('wizard:final_cancel', (interaction, _decoded, deps) =>
    handleCancel(interaction, deps),
  );
}
