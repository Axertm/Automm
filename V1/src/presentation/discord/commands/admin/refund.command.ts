import { SlashCommandBuilder } from 'discord.js';
import type { SlashCommandDefinition } from '../../interaction-router/HandlerRegistry.js';
import { requireAdmin } from './adminAuth.js';
import { resolveDealById } from '../resolveDealById.js';
import { buildReasonWithAddressModal } from '../../components/modals/adminReasonModals.js';

export const refundCommand: SlashCommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('refund')
    .setDescription('[Admin] Refund the buyer’s confirmed deposit')
    .addStringOption((opt) => opt.setName('deal_id').setDescription('The Deal ID').setRequired(true)),

  async execute(interaction, deps) {
    if (!(await requireAdmin(interaction, deps))) return;
    const deal = await resolveDealById(interaction, deps);
    if (!deal) return;

    await interaction.showModal(buildReasonWithAddressModal('admin', 'refund', deal.id, 'Refund buyer'));
  },
};
