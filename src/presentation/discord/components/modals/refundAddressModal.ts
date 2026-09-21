import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } from 'discord.js';
import { encodeCustomId } from '../../interaction-router/CustomId.js';
import type { ModalHandler } from '../../interaction-router/HandlerRegistry.js';
import { asDealId } from '../../../../domain/value-objects/EntityId.js';
import { buildSimpleEmbed } from '../../embeds/SimpleEmbed.js';

const ADDRESS_INPUT_ID = 'address';

export function buildRefundAddressModal(dealId: string): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId(ADDRESS_INPUT_ID)
    .setLabel('Your refund address')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(4)
    .setMaxLength(120);

  return new ModalBuilder()
    .setCustomId(encodeCustomId('refund', 'submit_address', dealId))
    .setTitle('Submit refund address')
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

export const handleRefundAddressModalSubmit: ModalHandler = async (interaction, decoded, deps) => {
  const address = interaction.fields.getTextInputValue(ADDRESS_INPUT_ID).trim();
  const result = await deps.submitRefundAddress.execute(
    asDealId(decoded.dealId),
    interaction.user.id,
    address,
  );

  if (!result.ok) {
    await interaction.reply({
      embeds: [buildSimpleEmbed(`Could not submit refund address: ${result.error.message}`, 'error')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.reply({
    embeds: [
      buildSimpleEmbed(
        `Refund address recorded: \`${address}\`. Please review it in the status message and confirm.`,
        'success',
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
};
