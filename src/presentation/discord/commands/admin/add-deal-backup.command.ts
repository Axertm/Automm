import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { SlashCommandDefinition } from '../../interaction-router/HandlerRegistry.js';
import { requireAdmin } from './adminAuth.js';
import { resolveDealById } from '../resolveDealById.js';
import { buildSimpleEmbed } from '../../embeds/SimpleEmbed.js';

export const addDealBackupCommand: SlashCommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('add-deal-backup')
    .setDescription("[Admin] Activate a party's registered backup account for this specific deal")
    .addStringOption((opt) => opt.setName('deal_id').setDescription('The Deal ID').setRequired(true))
    .addStringOption((opt) =>
      opt
        .setName('role')
        .setDescription('Which party this backup stands in for')
        .setRequired(true)
        .addChoices({ name: 'Buyer', value: 'BUYER' }, { name: 'Seller', value: 'SELLER' }),
    )
    .addUserOption((opt) =>
      opt.setName('user').setDescription("The backup account (must already be registered by that party)").setRequired(true),
    ),

  async execute(interaction, deps) {
    if (!(await requireAdmin(interaction, deps))) return;
    const deal = await resolveDealById(interaction, deps);
    if (!deal) return;

    const role = interaction.options.getString('role', true) as 'BUYER' | 'SELLER';
    const backupUser = interaction.options.getUser('user', true);
    const ownerDiscordId = role === 'BUYER' ? deal.buyerDiscordId : deal.sellerDiscordId;

    // Deliberately does not let an admin unilaterally grant deal access —
    // the real party must have already registered this account themselves
    // via /backup-account add. This just cross-checks that consent exists.
    const ownerBackups = await deps.backupAccountRepository.findByOwner(ownerDiscordId);
    const isRegistered = ownerBackups.some((b) => b.backupDiscordId === backupUser.id);
    if (!isRegistered) {
      await interaction.reply({
        embeds: [
          buildSimpleEmbed(
            `<@${backupUser.id}> is not a registered backup account for <@${ownerDiscordId}> (the ${role.toLowerCase()}). They must run \`/backup-account add\` first.`,
            'error',
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await deps.dealBackupRepository.upsert({
      dealId: deal.id,
      role,
      backupDiscordId: backupUser.id,
      addedByAdminId: interaction.user.id,
    });

    await interaction.reply({
      embeds: [
        buildSimpleEmbed(
          `<@${backupUser.id}> can now act as the ${role.toLowerCase()} on deal \`${deal.id}\`.`,
          'success',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};
