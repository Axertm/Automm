import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } from 'discord.js';
import { encodeCustomId } from '../../interaction-router/CustomId.js';
import type { ModalHandler } from '../../interaction-router/HandlerRegistry.js';
import { asDealId } from '../../../../domain/value-objects/EntityId.js';

const ADDRESS_INPUT_ID = 'address';

export function buildPayoutAddressModal(dealId: string): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId(ADDRESS_INPUT_ID)
    .setLabel('Your payout address')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(4)
    .setMaxLength(120);

  return new ModalBuilder()
    .setCustomId(encodeCustomId('payout', 'submit_address', dealId))
    .setTitle('Submit payout address')
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

export const handlePayoutAddressModalSubmit: ModalHandler = async (interaction, decoded, deps) => {
  const address = interaction.fields.getTextInputValue(ADDRESS_INPUT_ID).trim();
  const result = await deps.submitPayoutAddress.execute(
    asDealId(decoded.dealId),
    interaction.user.id,
    address,
  );

  if (!result.ok) {
    await interaction.reply({
      content: `Could not submit payout address: ${result.error.message}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.reply({
    content: `Payout address recorded: \`${address}\`. Please review it in the status message and confirm.`,
    flags: MessageFlags.Ephemeral,
  });
};
