import { SlashCommandBuilder } from 'discord.js';
import type { SlashCommandDefinition } from '../../interaction-router/HandlerRegistry.js';
import { requireAdmin } from './adminAuth.js';
import { resolveDealById } from '../resolveDealById.js';
import { buildReasonWithAddressModal } from '../../components/modals/adminReasonModals.js';

export const overridePayoutCommand: SlashCommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('override-payout')
    .setDescription(
      '[Admin] Redirect payout to an address the seller did not confirm — highest-risk admin action',
    )
    .addStringOption((opt) => opt.setName('deal_id').setDescription('The Deal ID').setRequired(true)),

  async execute(interaction, deps) {
    if (!(await requireAdmin(interaction, deps))) return;
    const deal = await resolveDealById(interaction, deps);
    if (!deal) return;

    await interaction.showModal(
      buildReasonWithAddressModal('admin', 'override', deal.id, 'Override payout address'),
    );
  },
};
