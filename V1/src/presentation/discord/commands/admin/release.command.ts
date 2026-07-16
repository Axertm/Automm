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
        'This starts the release process on the buyer’s behalf. The seller must still submit and confirm a payout address, and the buyer must still give final confirmation before funds move.',
      highRisk: true,
    });
  },
};
