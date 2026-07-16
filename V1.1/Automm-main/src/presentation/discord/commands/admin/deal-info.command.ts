import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { SlashCommandDefinition } from '../../interaction-router/HandlerRegistry.js';
import { requireAdmin } from './adminAuth.js';
import { resolveDealOrWizardSession } from '../resolveDealById.js';
import { buildDealStatusEmbed } from '../../embeds/DealEmbedBuilder.js';
import { buildProgressEmbed } from '../../wizard/progressEmbed.js';

export const dealInfoCommand: SlashCommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('deal-info')
    .setDescription('[Admin] Show a deal’s current status by Deal ID')
    .addStringOption((opt) => opt.setName('deal_id').setDescription('The Deal ID').setRequired(true)),

  async execute(interaction, deps) {
    if (!(await requireAdmin(interaction, deps))) return;
    const resolved = await resolveDealOrWizardSession(interaction, deps);
    if (!resolved) return;

    if (resolved.kind === 'wizard') {
      const embed = buildProgressEmbed(
        resolved.state,
        'Still in setup',
        `This deal has not been finalized yet — it's still being configured in <#${resolved.state.channelId}>.\n\n` +
          `Buyer: ${resolved.state.buyerId ? `<@${resolved.state.buyerId}>` : '—'}\n` +
          `Seller: ${resolved.state.sellerId ? `<@${resolved.state.sellerId}>` : '—'}\n` +
          `Currency: ${resolved.state.currency ?? '—'}\n` +
          `Amount: ${resolved.state.amountDecimal ?? '—'}`,
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const wallet = await deps.walletRepository.findByDealId(resolved.deal.id);
    const embed = buildDealStatusEmbed(resolved.deal, wallet);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
