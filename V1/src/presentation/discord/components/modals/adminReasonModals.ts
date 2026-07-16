import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { encodeCustomId } from '../../interaction-router/CustomId.js';

const REASON_INPUT_ID = 'reason';
const ADDRESS_INPUT_ID = 'address';

export function buildReasonModal(
  namespace: string,
  action: string,
  dealId: string,
  title: string,
): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId(REASON_INPUT_ID)
    .setLabel('Reason')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(500);

  return new ModalBuilder()
    .setCustomId(encodeCustomId(namespace, action, dealId))
    .setTitle(title)
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

export function buildReasonWithAddressModal(
  namespace: string,
  action: string,
  dealId: string,
  title: string,
): ModalBuilder {
  const reasonInput = new TextInputBuilder()
    .setCustomId(REASON_INPUT_ID)
    .setLabel('Reason')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(300);
  const addressInput = new TextInputBuilder()
    .setCustomId(ADDRESS_INPUT_ID)
    .setLabel('Destination address')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(4)
    .setMaxLength(120);

  return new ModalBuilder()
    .setCustomId(encodeCustomId(namespace, action, dealId))
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(addressInput),
    );
}

export function readReason(interaction: { fields: { getTextInputValue: (id: string) => string } }): string {
  return interaction.fields.getTextInputValue(REASON_INPUT_ID).trim();
}

export function readAddress(interaction: { fields: { getTextInputValue: (id: string) => string } }): string {
  return interaction.fields.getTextInputValue(ADDRESS_INPUT_ID).trim();
}
