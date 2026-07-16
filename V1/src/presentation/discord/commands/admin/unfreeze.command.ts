import { SlashCommandBuilder } from 'discord.js';
import type { SlashCommandDefinition } from '../../interaction-router/HandlerRegistry.js';
import { requireAdmin } from './adminAuth.js';
import { resolveDealById } from '../resolveDealById.js';
import { sendConfirmationPrompt } from '../../components/buttons/confirmation.js';

export const unfreezeCommand: SlashCommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('unfreeze')
    .setDescription('[Admin] Unfreeze a deal, restoring its prior state')
    .addStringOption((opt) => opt.setName('deal_id').setDescription('The Deal ID').setRequired(true)),

  async execute(interaction, deps) {
    if (!(await requireAdmin(interaction, deps))) return;
    const deal = await resolveDealById(interaction, deps);
    if (!deal) return;

    await sendConfirmationPrompt(interaction, {
      namespace: 'admin',
      action: 'unfreeze',
      dealId: deal.id,
      title: 'Unfreeze this deal?',
      description: 'The deal will resume from the state it was frozen in.',
    });
  },
};
