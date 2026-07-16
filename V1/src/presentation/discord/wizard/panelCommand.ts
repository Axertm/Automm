import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommandDefinition } from '../interaction-router/HandlerRegistry.js';
import { requireAdmin } from '../commands/admin/adminAuth.js';
import { encodeCustomId } from '../interaction-router/CustomId.js';

export const escrowPanelCommand: SlashCommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('escrow-panel')
    .setDescription('[Admin] Post the public "Create Escrow" panel in this channel'),

  async execute(interaction, deps) {
    if (!(await requireAdmin(interaction, deps))) return;

    const embed = new EmbedBuilder()
      .setTitle('🤝 Start a New Escrow Deal')
      .setDescription(
        "Click **Create Escrow** below to open a private ticket. You'll be guided step by step through selecting the buyer, seller, currency, and amount before anything is finalized.",
      )
      .setColor(0x2ecc71);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId('panel', 'create_escrow', 'panel'))
        .setLabel('Create Escrow')
        .setEmoji('🤝')
        .setStyle(ButtonStyle.Success),
    );

    if (interaction.channel?.isSendable()) {
      await interaction.channel.send({ embeds: [embed], components: [row] });
    }
    await interaction.reply({ content: 'Panel posted.', flags: MessageFlags.Ephemeral });
  },
};
