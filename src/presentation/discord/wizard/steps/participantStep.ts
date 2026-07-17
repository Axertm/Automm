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

export function buildParticipantStepMessage(state: DealWizardState) {
  const embed = buildProgressEmbed(
    state,
    'Select the Other Participant',
    `Use the menu below to choose who else is involved in this deal. On the next step, you and they will each pick **I am the Buyer** / **I am the Seller** yourselves.`,
  );
  const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(encodeCustomId('wizard', 'select_participant', state.dealId))
      .setPlaceholder('Select the other participant...')
      .setMinValues(1)
      .setMaxValues(1),
  );
  return { embeds: [embed], components: [row] };
}

async function handleSelect(interaction: UserSelectMenuInteraction, deps: AppDependencies): Promise<void> {
  const state = deps.dealWizardStore.get(interaction.channelId);
  if (!state) {
    await interaction.reply({
      embeds: [buildSimpleEmbed('This wizard session has expired. Please create a new ticket.', 'error')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const selectedId = interaction.values[0]!;
  if (selectedId === state.initiatorId) {
    await interaction.reply({
      embeds: [buildSimpleEmbed('You cannot select yourself as the other participant.', 'error')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('Confirm Participant')
    .setDescription(`You selected <@${selectedId}> as the other participant in this deal. Is this correct?`)
    .setColor(0xf1c40f)
    .setFooter({ text: `Deal ID: ${state.dealId}` });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeConfirm('wizard', 'select_participant', state.dealId, selectedId))
      .setLabel('Confirm')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(encodeCancel('wizard', 'select_participant', state.dealId))
      .setLabel('Wrong Selection')
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.update({ embeds: [embed], components: [row] });
}

async function handleConfirm(
  interaction: ButtonInteraction,
  decoded: DecodedCustomId,
  deps: AppDependencies,
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

  const updated = deps.dealWizardStore.update(interaction.channelId, {
    participantId: selectedId,
    participantConfirmed: true,
    step: 2,
  });
  if (!updated) return;

  // Grant the selected participant access now, before step 2's role-claim
  // buttons render — otherwise they can't even see the channel to press them.
  if (interaction.channel?.isTextBased() && 'permissionOverwrites' in interaction.channel) {
    await deps.ticketChannelService
      .grantAccess(interaction.channel as import('discord.js').TextChannel, selectedId)
      .catch(() => undefined);
  }

  const { buildRoleClaimStepMessage } = await import('./roleClaimStep.js');
  await interaction.update(buildRoleClaimStepMessage(updated));
}

async function handleWrong(interaction: ButtonInteraction, deps: AppDependencies): Promise<void> {
  const state = deps.dealWizardStore.get(interaction.channelId);
  if (!state) return;
  const updated = deps.dealWizardStore.update(interaction.channelId, {
    participantId: null,
    participantConfirmed: false,
  });
  if (!updated) return;
  await interaction.update(buildParticipantStepMessage(updated));
}

export function registerParticipantStepHandlers(registry: HandlerRegistry): void {
  registry.registerSelectMenu('wizard:select_participant', (interaction, _decoded, deps) =>
    handleSelect(interaction as UserSelectMenuInteraction, deps),
  );
  registry.registerButton('wizard:confirm_select_participant', (interaction, decoded, deps) =>
    handleConfirm(interaction, decoded, deps),
  );
  registry.registerButton('wizard:cancel_select_participant', (interaction, _decoded, deps) =>
    handleWrong(interaction, deps),
  );
}
