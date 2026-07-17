import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { SlashCommandDefinition } from '../interaction-router/HandlerRegistry.js';
import { buildSimpleEmbed } from '../embeds/SimpleEmbed.js';

/**
 * Self-service: a user registers alternate Discord accounts they control.
 * Registering one here grants it nothing by itself — it only becomes usable
 * on a specific deal once an admin activates it there via /add-deal-backup,
 * which cross-checks against this list (see resolveActingDiscordId). This
 * two-step model means an admin can never unilaterally hand deal access to
 * an account the real party hasn't already vouched for.
 */
export const backupAccountCommand: SlashCommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('backup-account')
    .setDescription('Manage alternate Discord accounts that can stand in for you on a deal')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Register an alternate account you control')
        .addUserOption((opt) => opt.setName('user').setDescription('Your alternate account').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Un-register an alternate account')
        .addUserOption((opt) => opt.setName('user').setDescription('The account to remove').setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List your registered alternate accounts')),

  async execute(interaction, deps) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const backups = await deps.backupAccountRepository.findByOwner(interaction.user.id);
      await interaction.reply({
        embeds: [
          buildSimpleEmbed(
            backups.length === 0
              ? "You haven't registered any backup accounts. Use `/backup-account add` to register one."
              : `Your registered backup accounts:\n${backups.map((b) => `- <@${b.backupDiscordId}>`).join('\n')}`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const target = interaction.options.getUser('user', true);
    if (target.id === interaction.user.id) {
      await interaction.reply({
        embeds: [buildSimpleEmbed('You cannot register yourself as your own backup account.', 'error')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (target.bot) {
      await interaction.reply({
        embeds: [buildSimpleEmbed('A bot account cannot be registered as a backup account.', 'error')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'add') {
      await deps.backupAccountRepository.add(interaction.user.id, target.id);
      await interaction.reply({
        embeds: [
          buildSimpleEmbed(
            `Registered <@${target.id}> as a backup account. An admin can now activate it on a specific deal with \`/add-deal-backup\` if needed.`,
            'success',
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // sub === 'remove'
    await deps.backupAccountRepository.remove(interaction.user.id, target.id);
    await interaction.reply({
      embeds: [
        buildSimpleEmbed(
          `Removed <@${target.id}> from your backup accounts. Note: this does not revoke access already activated on a specific deal — ask an admin to run \`/remove-deal-backup\` for any deal where it's still active.`,
          'success',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};
