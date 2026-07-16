import { SlashCommandBuilder } from 'discord.js';
import type { SlashCommandDefinition } from '../../interaction-router/HandlerRegistry.js';
import { requireAdmin } from './adminAuth.js';
import { resolveDealOrWizardSession } from '../resolveDealById.js';
import { sendConfirmationPrompt } from '../../components/buttons/confirmation.js';

const TERMINAL_STATES = new Set(['COMPLETED', 'REFUNDED', 'CANCELLED']);

export const closeCommand: SlashCommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('close')
    .setDescription('[Admin] Close (delete) a deal’s ticket channel')
    .addStringOption((opt) => opt.setName('deal_id').setDescription('The Deal ID').setRequired(true)),

  async execute(interaction, deps) {
    if (!(await requireAdmin(interaction, deps))) return;
    const resolved = await resolveDealOrWizardSession(interaction, deps);
    if (!resolved) return;

    if (resolved.kind === 'wizard') {
      await sendConfirmationPrompt(interaction, {
        namespace: 'admin',
        action: 'close',
        dealId: resolved.state.dealId,
        title: 'Close this ticket channel?',
        description: `This deal is still being set up and has not been finalized — no funds are at risk. The ticket channel will be permanently deleted. This cannot be undone.`,
      });
      return;
    }

    const isTerminal = TERMINAL_STATES.has(resolved.deal.state);
    await sendConfirmationPrompt(interaction, {
      namespace: 'admin',
      action: 'close',
      dealId: resolved.deal.id,
      title: 'Close this ticket channel?',
      description: isTerminal
        ? `This deal is ${resolved.deal.state}. The ticket channel will be permanently deleted. This cannot be undone.`
        : `⚠️ This deal is still **${resolved.deal.state}** (not completed/refunded/cancelled). Closing now only deletes the channel — the deal record and any escrowed funds are unaffected. Use \`/refund\` or \`/cancel\` first if you intend to actually resolve the deal.`,
      highRisk: !isTerminal,
    });
  },
};
