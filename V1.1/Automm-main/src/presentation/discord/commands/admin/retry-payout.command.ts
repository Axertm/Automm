import { SlashCommandBuilder } from 'discord.js';
import type { SlashCommandDefinition } from '../../interaction-router/HandlerRegistry.js';
import { requireAdmin } from './adminAuth.js';
import { resolveDealById } from '../resolveDealById.js';
import { sendConfirmationPrompt } from '../../components/buttons/confirmation.js';

export const retryPayoutCommand: SlashCommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('retry-payout')
    .setDescription('[Admin] Re-attempt broadcasting a payout stuck in PAYOUT_IN_PROGRESS')
    .addStringOption((opt) => opt.setName('deal_id').setDescription('The Deal ID').setRequired(true)),

  async execute(interaction, deps) {
    if (!(await requireAdmin(interaction, deps))) return;
    const deal = await resolveDealById(interaction, deps);
    if (!deal) return;

    await sendConfirmationPrompt(interaction, {
      namespace: 'admin',
      action: 'retry_payout',
      dealId: deal.id,
      title: 'Retry this payout?',
      description:
        'Re-attempts broadcasting the payout. If it already sent successfully, this safely fails with an insufficient-balance error rather than double-sending — the wallet only has funds left to retry with if the prior attempt never actually broadcast.',
      highRisk: true,
    });
  },
};
