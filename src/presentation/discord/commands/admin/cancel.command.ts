import { SlashCommandBuilder } from 'discord.js';
import type { SlashCommandDefinition } from '../../interaction-router/HandlerRegistry.js';
import { requireAdmin } from './adminAuth.js';
import { resolveDealById } from '../resolveDealById.js';
import { buildReasonModal } from '../../components/modals/adminReasonModals.js';

export const cancelCommand: SlashCommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('cancel')
    .setDescription('[Admin] Cancel a deal (only before any funds arrive)')
    .addStringOption((opt) => opt.setName('deal_id').setDescription('The Deal ID').setRequired(true)),

  async execute(interaction, deps) {
    if (!(await requireAdmin(interaction, deps))) return;
    const deal = await resolveDealById(interaction, deps);
    if (!deal) return;

    await interaction.showModal(buildReasonModal('admin', 'cancel', deal.id, 'Cancel deal'));
  },
};
