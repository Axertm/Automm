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

export function buildRoleClaimStepMessage(state: DealWizardState) {
  const embed = buildProgressEmbed(
    state,
    'Claim Your Role',
    `<@${state.initiatorId}> and <@${state.participantId}>, each press the button matching your role in this deal.\n\nOnly one of you may claim each role — you cannot claim both.` +
      (state.buyerId ? `\n\n✅ Buyer: <@${state.buyerId}>` : '') +
      (state.sellerId ? `\n✅ Seller: <@${state.sellerId}>` : ''),
  );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeCustomId('wizard', 'claim_buyer', state.dealId))
      .setLabel(state.buyerId ? '✅ I am the Buyer' : 'I am the Buyer')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(state.buyerId !== null),
    new ButtonBuilder()
      .setCustomId(encodeCustomId('wizard', 'claim_seller', state.dealId))
      .setLabel(state.sellerId ? '✅ I am the Seller' : 'I am the Seller')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(state.sellerId !== null),
  );

  return { embeds: [embed], components: [row] };
}

async function handleClaim(
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

  const userId = interaction.user.id;
  if (userId !== state.initiatorId && userId !== state.participantId) {
    await interaction.reply({
      embeds: [buildSimpleEmbed('Only the two participants of this deal may claim a role.', 'error')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const alreadyClaimedBy = role === 'buyer' ? state.buyerId : state.sellerId;
  if (alreadyClaimedBy) {
    await interaction.reply({
      embeds: [buildSimpleEmbed(`The ${role} role has already been claimed.`, 'error')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const otherRoleClaimedBy = role === 'buyer' ? state.sellerId : state.buyerId;
  if (otherRoleClaimedBy === userId) {
    await interaction.reply({
      embeds: [
        buildSimpleEmbed('You already claimed the other role — you cannot be both buyer and seller.', 'error'),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const patch = role === 'buyer' ? { buyerId: userId } : { sellerId: userId };
  const updated = deps.dealWizardStore.update(interaction.channelId, patch);
  if (!updated) return;

  if (updated.buyerId && updated.sellerId) {
    const advanced = deps.dealWizardStore.update(interaction.channelId, { step: 3 });
    if (!advanced) return;
    const { buildCurrencyStepMessage } = await import('./currencyStep.js');
    await interaction.update(buildCurrencyStepMessage(advanced));
  } else {
    await interaction.update(buildRoleClaimStepMessage(updated));
  }
}

export function registerRoleClaimStepHandlers(registry: HandlerRegistry): void {
  registry.registerButton('wizard:claim_buyer', (interaction, _decoded, deps) =>
    handleClaim(interaction, deps, 'buyer'),
  );
  registry.registerButton('wizard:claim_seller', (interaction, _decoded, deps) =>
    handleClaim(interaction, deps, 'seller'),
  );
}
