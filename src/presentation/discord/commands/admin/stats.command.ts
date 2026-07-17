import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import type { SlashCommandDefinition } from '../../interaction-router/HandlerRegistry.js';
import { requireAdmin } from './adminAuth.js';

export const statsCommand: SlashCommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('[Admin] Show escrow deal statistics for this server'),

  async execute(interaction, deps) {
    if (!(await requireAdmin(interaction, deps))) return;
    if (!interaction.inGuild()) return;

    const stats = await deps.adminStats.execute(interaction.guildId!);

    const embed = new EmbedBuilder()
      .setTitle('Escrow statistics')
      .setColor(0x3498db)
      .addFields(
        { name: 'Total deals', value: String(stats.totalDeals), inline: true },
        { name: 'Active deals', value: String(stats.activeDeals), inline: true },
        ...Object.entries(stats.countsByState)
          .filter(([, count]) => count > 0)
          .map(([state, count]) => ({ name: state, value: String(count), inline: true })),
      );

    // Read-only — deliberately exempt from the confirmation-step pattern,
    // per AdminStatsUseCase's documented rationale.
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
