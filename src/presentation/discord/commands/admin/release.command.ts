import { SlashCommandBuilder } from 'discord.js';
import type { SlashCommandDefinition } from '../../interaction-router/HandlerRegistry.js';
import { requireAdmin } from './adminAuth.js';
import { resolveDealById } from '../resolveDealById.js';
import { sendConfirmationPrompt } from '../../components/buttons/confirmation.js';

export const releaseCommand: SlashCommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('release')
    .setDescription('[Admin] Force a release request on the buyer’s behalf')
    .addStringOption((opt) => opt.setName('deal_id').setDescription('The Deal ID').setRequired(true)),

  async execute(interaction, deps) {
    if (!(await requireAdmin(interaction, deps))) return;
    const deal = await resolveDealById(interaction, deps);
    if (!deal) return;

    await sendConfirmationPrompt(interaction, {
      namespace: 'admin',
      action: 'force_release',
      dealId: deal.id,
      title: 'Force release request?',
      description:
        'This starts the release process on the buyer’s behalf. The buyer must still give a final confirmation before the seller may submit a payout address, and the seller must still confirm it before any funds move.',
      highRisk: true,
    });
  },
};
