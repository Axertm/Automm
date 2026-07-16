import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';
import {
  encodeCancel,
  encodeConfirm,
  encodeCustomId,
  type DecodedCustomId,
} from '../../interaction-router/CustomId.js';
import { buildProgressEmbed } from '../progressEmbed.js';
import { buildSimpleEmbed } from '../../embeds/SimpleEmbed.js';
import type { DealWizardState } from '../DealWizardState.js';
import type { AppDependencies } from '../../AppDependencies.js';
import type { HandlerRegistry } from '../../interaction-router/HandlerRegistry.js';

type Role = 'buyer' | 'seller';

export function buildSelectStepMessage(state: DealWizardState, role: Role) {
  const embed = buildProgressEmbed(
    state,
    role === 'buyer' ? 'Select the Buyer' : 'Select the Seller',
    `Use the menu below to choose the ${role} for this deal.`,
  );
  const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(encodeCustomId('wizard', `select_${role}`, state.dealId))
      .setPlaceholder(`Select the ${role}...`)
      .setMinValues(1)
      .setMaxValues(1),
  );
  return { embeds: [embed], components: [row] };
}

async function handleSelect(
  interaction: UserSelectMenuInteraction,
  deps: AppDependencies,
  role: Role,
): Promise<void> {
  const state = deps.dealWizardStore.get(interaction.channelId);
  if (!state) {
    await interaction.reply({
      embeds: [buildSimpleEmbed('This wizard session has expired. Please create a new ticket.', 'error')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const selectedId = interaction.values[0]!;
  if (role === 'buyer' && selectedId === state.sellerId) {
    await interaction.reply({
      embeds: [buildSimpleEmbed('The buyer cannot be the same person as the seller.', 'error')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (role === 'seller' && selectedId === state.buyerId) {
    await interaction.reply({
      embeds: [buildSimpleEmbed('The seller cannot be the same person as the buyer.', 'error')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`Confirm ${role === 'buyer' ? 'Buyer' : 'Seller'}`)
    .setDescription(`You selected <@${selectedId}> as the ${role}. Is this correct?`)
    .setColor(0xf1c40f)
    .setFooter({ text: `Deal ID: ${state.dealId}` });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeConfirm('wizard', `select_${role}`, state.dealId, selectedId))
      .setLabel('Confirm')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(encodeCancel('wizard', `select_${role}`, state.dealId))
      .setLabel('Wrong Selection')
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.update({ embeds: [embed], components: [row] });
}

async function handleConfirm(
  interaction: ButtonInteraction,
  decoded: DecodedCustomId,
  deps: AppDependencies,
  role: Role,
): Promise<void> {
  const state = deps.dealWizardStore.get(interaction.channelId);
  if (!state) return;

  const selectedId = decoded.extra;
  if (!selectedId) {
    await interaction.reply({
      embeds: [buildSimpleEmbed('Selection expired — please pick again.', 'error')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const patch =
    role === 'buyer'
      ? { buyerId: selectedId, buyerConfirmed: true, step: 2 as const }
      : { sellerId: selectedId, sellerConfirmed: true, step: 3 as const };
  const updated = deps.dealWizardStore.update(interaction.channelId, patch);
  if (!updated) return;

  // Grant the selected buyer/seller access now, before step 3's role-confirm
  // buttons render — otherwise they can't even see the channel to press them.
  if (interaction.channel?.isTextBased() && 'permissionOverwrites' in interaction.channel) {
    await deps.ticketChannelService
      .grantAccess(interaction.channel as import('discord.js').TextChannel, selectedId)
      .catch(() => undefined);
  }

  if (role === 'buyer') {
    await interaction.update(buildSelectStepMessage(updated, 'seller'));
  } else {
    const { buildRoleConfirmStepMessage } = await import('./roleConfirmStep.js');
    await interaction.update(buildRoleConfirmStepMessage(updated));
  }
}

async function handleWrong(interaction: ButtonInteraction, deps: AppDependencies, role: Role): Promise<void> {
  const state = deps.dealWizardStore.get(interaction.channelId);
  if (!state) return;
  const patch =
    role === 'buyer' ? { buyerId: null, buyerConfirmed: false } : { sellerId: null, sellerConfirmed: false };
  const updated = deps.dealWizardStore.update(interaction.channelId, patch);
  if (!updated) return;
  await interaction.update(buildSelectStepMessage(updated, role));
}

export function registerBuyerSellerStepHandlers(registry: HandlerRegistry): void {
  registry.registerSelectMenu('wizard:select_buyer', (interaction, _decoded, deps) =>
    handleSelect(interaction as UserSelectMenuInteraction, deps, 'buyer'),
  );
  registry.registerButton('wizard:confirm_select_buyer', (interaction, decoded, deps) =>
    handleConfirm(interaction, decoded, deps, 'buyer'),
  );
  registry.registerButton('wizard:cancel_select_buyer', (interaction, _decoded, deps) =>
    handleWrong(interaction, deps, 'buyer'),
  );

  registry.registerSelectMenu('wizard:select_seller', (interaction, _decoded, deps) =>
    handleSelect(interaction as UserSelectMenuInteraction, deps, 'seller'),
  );
  registry.registerButton('wizard:confirm_select_seller', (interaction, decoded, deps) =>
    handleConfirm(interaction, decoded, deps, 'seller'),
  );
  registry.registerButton('wizard:cancel_select_seller', (interaction, _decoded, deps) =>
    handleWrong(interaction, deps, 'seller'),
  );
}
