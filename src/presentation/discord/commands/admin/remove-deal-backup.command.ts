import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { SlashCommandDefinition } from '../../interaction-router/HandlerRegistry.js';
import { requireAdmin } from './adminAuth.js';
import { resolveDealById } from '../resolveDealById.js';
import { buildSimpleEmbed } from '../../embeds/SimpleEmbed.js';

export const removeDealBackupCommand: SlashCommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('remove-deal-backup')
    .setDescription("[Admin] Revoke a role's activated backup account on this deal")
    .addStringOption((opt) => opt.setName('deal_id').setDescription('The Deal ID').setRequired(true))
    .addStringOption((opt) =>
      opt
        .setName('role')
        .setDescription('Which party to revoke the backup from')
        .setRequired(true)
        .addChoices({ name: 'Buyer', value: 'BUYER' }, { name: 'Seller', value: 'SELLER' }),
    ),

  async execute(interaction, deps) {
    if (!(await requireAdmin(interaction, deps))) return;
    const deal = await resolveDealById(interaction, deps);
    if (!deal) return;

    const role = interaction.options.getString('role', true) as 'BUYER' | 'SELLER';
    await deps.dealBackupRepository.remove(deal.id, role);

    await interaction.reply({
      embeds: [
        buildSimpleEmbed(`Revoked any activated backup account for the ${role.toLowerCase()} on deal \`${deal.id}\`.`, 'success'),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};
