import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { SlashCommandDefinition } from '../interaction-router/HandlerRegistry.js';
import type { Currency } from '../../../domain/value-objects/Currency.js';
import { buildSimpleEmbed } from '../embeds/SimpleEmbed.js';

/**
 * Self-service: explicitly sets the user's saved default payout address for
 * a given currency. Deliberately NOT auto-populated from a deal's
 * payout-address submission — the user must set it here on purpose, so a
 * one-off address used for a single deal never silently becomes their
 * standing default. Once set, the payout-address step on any future deal in
 * that currency offers it as a one-click "Use Saved Address" shortcut (see
 * releaseFlowHandlers.ts).
 */
export const setPayoutAddressCommand: SlashCommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('set-payout-address')
    .setDescription('Set or view your saved default payout address for a currency')
    .addStringOption((opt) =>
      opt
        .setName('currency')
        .setDescription('Which currency this address is for')
        .setRequired(true)
        .addChoices(
          { name: 'Litecoin (LTC)', value: 'LTC' },
          { name: 'Solana (SOL)', value: 'SOL' },
          { name: 'USDT (Polygon)', value: 'USDT' },
        ),
    )
    .addStringOption((opt) =>
      opt
        .setName('address')
        .setDescription('Your address — omit to just view what is currently saved')
        .setRequired(false),
    ),

  async execute(interaction, deps) {
    const currency = interaction.options.getString('currency', true) as Currency;
    const address = interaction.options.getString('address')?.trim();

    if (!address) {
      const saved = await deps.savedPayoutAddressRepository.find(interaction.user.id, currency);
      await interaction.reply({
        embeds: [
          buildSimpleEmbed(
            saved
              ? `Your saved ${currency} payout address is: \`${saved}\``
              : `You don't have a saved ${currency} payout address yet. Set one with \`/set-payout-address currency:${currency} address:<your address>\`.`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const blockchainService = deps.blockchainServiceFactory.getService(currency);
    if (!blockchainService.validateAddress(address)) {
      await interaction.reply({
        embeds: [buildSimpleEmbed(`\`${address}\` is not a valid ${currency} address.`, 'error')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await deps.savedPayoutAddressRepository.save(interaction.user.id, currency, address);
    await interaction.reply({
      embeds: [
        buildSimpleEmbed(
          `Saved \`${address}\` as your default ${currency} payout address. It'll be offered as a shortcut the next time a deal asks you for one.`,
          'success',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};
