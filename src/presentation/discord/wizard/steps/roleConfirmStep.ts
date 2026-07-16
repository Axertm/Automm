import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
} from 'discord.js';
import { encodeCustomId } from '../../interaction-router/CustomId.js';
import { buildProgressEmbed } from '../progressEmbed.js';
import { buildSimpleEmbed } from '../../embeds/SimpleEmbed.js';
import type { DealWizardState } from '../DealWizardState.js';
import type { AppDependencies } from '../../AppDependencies.js';
import type { HandlerRegistry } from '../../interaction-router/HandlerRegistry.js';

export function buildRoleConfirmStepMessage(state: DealWizardState) {
  const embed = buildProgressEmbed(
    state,
    'Confirm Your Role',
    `<@${state.buyerId}>, press **I am the Buyer**.\n<@${state.sellerId}>, press **I am the Seller**.\n\nOnly the selected buyer/seller may press their button.` +
      (state.buyerRoleConfirmed ? '\n\n✅ Buyer confirmed.' : '') +
      (state.sellerRoleConfirmed ? '\n✅ Seller confirmed.' : ''),
  );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeCustomId('wizard', 'role_buyer', state.dealId))
      .setLabel(state.buyerRoleConfirmed ? '✅ I am the Buyer' : 'I am the Buyer')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(state.buyerRoleConfirmed),
    new ButtonBuilder()
      .setCustomId(encodeCustomId('wizard', 'role_seller', state.dealId))
      .setLabel(state.sellerRoleConfirmed ? '✅ I am the Seller' : 'I am the Seller')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(state.sellerRoleConfirmed),
  );

  return { embeds: [embed], components: [row] };
}

async function handleRoleButton(
  interaction: ButtonInteraction,
  deps: AppDependencies,
  role: 'buyer' | 'seller',
): Promise<void> {
  const state = deps.dealWizardStore.get(interaction.channelId);
  if (!state) {
    await interaction.reply({
      embeds: [buildSimpleEmbed('This wizard session has expired. Please create a new ticket.', 'error')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const expectedId = role === 'buyer' ? state.buyerId : state.sellerId;
  if (interaction.user.id !== expectedId) {
    await interaction.reply({
      embeds: [buildSimpleEmbed(`Only the selected ${role} may confirm this.`, 'error')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const patch = role === 'buyer' ? { buyerRoleConfirmed: true } : { sellerRoleConfirmed: true };
  const updated = deps.dealWizardStore.update(interaction.channelId, patch);
  if (!updated) return;

  if (updated.buyerRoleConfirmed && updated.sellerRoleConfirmed) {
    const advanced = deps.dealWizardStore.update(interaction.channelId, { step: 4 });
    if (!advanced) return;
    const { buildCurrencyStepMessage } = await import('./currencyStep.js');
    await interaction.update(buildCurrencyStepMessage(advanced));
  } else {
    await interaction.update(buildRoleConfirmStepMessage(updated));
  }
}

export function registerRoleConfirmStepHandlers(registry: HandlerRegistry): void {
  registry.registerButton('wizard:role_buyer', (interaction, _decoded, deps) =>
    handleRoleButton(interaction, deps, 'buyer'),
  );
  registry.registerButton('wizard:role_seller', (interaction, _decoded, deps) =>
    handleRoleButton(interaction, deps, 'seller'),
  );
}
