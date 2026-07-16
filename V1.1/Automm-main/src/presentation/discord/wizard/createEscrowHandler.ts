import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { createInitialWizardState } from './DealWizardState.js';
import { buildParticipantStepMessage } from './steps/participantStep.js';
import { buildSimpleEmbed } from '../embeds/SimpleEmbed.js';
import type { AppDependencies } from '../AppDependencies.js';
import type { HandlerRegistry } from '../interaction-router/HandlerRegistry.js';

async function handleCreateEscrow(interaction: ButtonInteraction, deps: AppDependencies): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      embeds: [buildSimpleEmbed('This can only be used in a server.', 'error')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const dealId = await deps.shortDealIdGenerator.generate();
  const channel = await deps.ticketChannelService.createSetupTicket(
    interaction.guild,
    dealId,
    interaction.user.id,
  );

  const state = createInitialWizardState({
    dealId,
    guildId: interaction.guild.id,
    channelId: channel.id,
    initiatorId: interaction.user.id,
  });
  deps.dealWizardStore.create(state);

  const message = buildParticipantStepMessage(state);
  await channel.send(message);

  await interaction.editReply({
    embeds: [buildSimpleEmbed(`Your escrow ticket has been created: ${channel}`, 'success')],
  });
}

export function registerCreateEscrowHandler(registry: HandlerRegistry): void {
  registry.registerButton('panel:create_escrow', (interaction, _decoded, deps) =>
    handleCreateEscrow(interaction, deps),
  );
}
