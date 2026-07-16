import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import type { SlashCommandDefinition } from '../../interaction-router/HandlerRegistry.js';
import { requireAdmin } from './adminAuth.js';
import { assertCurrency } from '../../../../domain/value-objects/Currency.js';
import { buildSimpleEmbed } from '../../embeds/SimpleEmbed.js';

export const balanceCommand: SlashCommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('[Admin] Check the on-chain balance of any LTC/SOL address')
    .addStringOption((opt) =>
      opt
        .setName('currency')
        .setDescription('Which chain the address is on')
        .setRequired(true)
        .addChoices({ name: 'Litecoin (LTC)', value: 'LTC' }, { name: 'Solana (SOL)', value: 'SOL' }),
    )
    .addStringOption((opt) => opt.setName('address').setDescription('The address to check').setRequired(true)),

  async execute(interaction, deps) {
    if (!(await requireAdmin(interaction, deps))) return;

    const currency = assertCurrency(interaction.options.getString('currency', true));
    const address = interaction.options.getString('address', true).trim();

    const blockchainService = deps.blockchainServiceFactory.getService(currency);
    if (!blockchainService.validateAddress(address)) {
      await interaction.reply({
        embeds: [buildSimpleEmbed(`❌ \`${address}\` is not a valid ${currency} address.`, 'error')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const balance = await blockchainService.getBalance(address);
      const embed = new EmbedBuilder()
        .setTitle(`${currency} Balance`)
        .setColor(0x3498db)
        .addFields(
          { name: 'Address', value: `\`${address}\`` },
          { name: 'Balance', value: `${balance.toDecimalString()} ${currency}` },
        );
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({
        embeds: [buildSimpleEmbed(`❌ Could not fetch balance: ${(error as Error).message}`, 'error')],
      });
    }
  },
};
