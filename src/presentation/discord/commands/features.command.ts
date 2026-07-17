import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import type { SlashCommandDefinition } from '../interaction-router/HandlerRegistry.js';

/** Read-only, no side effects: a quick reference for what the bot can do. */
export const featuresCommand: SlashCommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('features')
    .setDescription('Show a quick list of what this bot can do'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('Escrow Bot — Feature List')
      .setColor(0x5865f2)
      .addFields(
        {
          name: '💱 Supported currencies',
          value: 'Litecoin (LTC), Solana (SOL), USDT (Polygon)',
        },
        {
          name: '🤝 Escrow deals',
          value:
            'Guided ticket-channel wizard, self-selected buyer/seller roles, two-party release gate (buyer confirms release → seller submits + confirms payout address) before any funds move.',
        },
        {
          name: '💾 Saved payout addresses',
          value:
            '`/set-payout-address` saves your default address per currency — future deals offer it as a one-click shortcut instead of retyping it.',
        },
        {
          name: '🔑 Backup accounts',
          value:
            '`/backup-account add/remove/list` lets you register alternate Discord accounts you control. An admin can activate one on a specific deal (`/add-deal-backup`) so it can act as you if you lose access — never granted without your own consent.',
        },
        {
          name: '🛡️ Admin tools',
          value:
            '`/freeze` `/unfreeze` `/release` `/refund` `/cancel` `/override-payout` `/retry-payout` — dispute resolution and stuck-payout recovery, all reason-logged and confirmation-gated.',
        },
        {
          name: '🔍 Transparency',
          value:
            '`/balance` checks any address on-chain directly. `/deal-info` and `/transcript` give a read-only view of any deal. Every state change is written to an audit trail.',
        },
      )
      .setFooter({ text: 'Run /escrow-panel in a channel to start a new deal.' });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
