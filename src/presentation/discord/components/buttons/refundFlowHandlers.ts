import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { asDealId } from '../../../../domain/value-objects/EntityId.js';
import { encodeCustomId } from '../../interaction-router/CustomId.js';
import type { ButtonHandler, HandlerRegistry } from '../../interaction-router/HandlerRegistry.js';
import { sendConfirmationPrompt, handleCancel } from './confirmation.js';
import { buildRefundAddressModal, handleRefundAddressModalSubmit } from '../modals/refundAddressModal.js';
import { buildSimpleEmbed } from '../../embeds/SimpleEmbed.js';

/** Shows enough of an address to recognize it without exposing the whole thing in a shared channel. */
function maskAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Seller-only in practice (enforced by the use case) — offers the escrowed funds back to the buyer. */
const refundRequestPrompt: ButtonHandler = async (interaction, decoded) => {
  await sendConfirmationPrompt(interaction, {
    namespace: 'deal',
    action: 'refund_request',
    dealId: decoded.dealId,
    title: 'Refund the funds to the buyer?',
    description:
      'This starts the refund process. The buyer will be asked to submit and confirm an address to receive their funds back — no funds move until they do.',
  });
};

const refundRequestConfirm: ButtonHandler = async (interaction, decoded, deps) => {
  const result = await deps.requestRefund.execute(asDealId(decoded.dealId), interaction.user.id, 'SELLER');
  await interaction.update({
    embeds: [
      result.ok
        ? buildSimpleEmbed(
            '✅ Refund requested. Waiting for the buyer to submit a refund address.',
            'success',
          )
        : buildSimpleEmbed(`❌ ${result.error.message}`, 'error'),
    ],
    components: [],
  });
};

const submitAddressPrompt: ButtonHandler = async (interaction, decoded, deps) => {
  const deal = await deps.dealRepository.findById(asDealId(decoded.dealId));
  const savedAddress = deal
    ? await deps.savedPayoutAddressRepository.find(interaction.user.id, deal.currency)
    : null;

  if (!savedAddress) {
    await interaction.showModal(buildRefundAddressModal(decoded.dealId));
    return;
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeCustomId('refund', 'use_saved_address', decoded.dealId))
      .setLabel('Use Saved Address')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(encodeCustomId('refund', 'enter_new_address', decoded.dealId))
      .setLabel('Enter a Different Address')
      .setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({
    embeds: [
      buildSimpleEmbed(
        `You have a saved address on file: \`${maskAddress(savedAddress)}\`. Use it to receive this refund?`,
      ),
    ],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
};

const useSavedAddress: ButtonHandler = async (interaction, decoded, deps) => {
  const deal = await deps.dealRepository.findById(asDealId(decoded.dealId));
  const savedAddress = deal
    ? await deps.savedPayoutAddressRepository.find(interaction.user.id, deal.currency)
    : null;
  if (!savedAddress) {
    await interaction.update({
      embeds: [
        buildSimpleEmbed('That saved address is no longer available — please enter one manually.', 'error'),
      ],
      components: [],
    });
    return;
  }

  const result = await deps.submitRefundAddress.execute(
    asDealId(decoded.dealId),
    interaction.user.id,
    savedAddress,
  );
  await interaction.update({
    embeds: [
      result.ok
        ? buildSimpleEmbed(
            `Refund address recorded: \`${maskAddress(savedAddress)}\`. Please review it in the status message and confirm.`,
            'success',
          )
        : buildSimpleEmbed(`Could not submit refund address: ${result.error.message}`, 'error'),
    ],
    components: [],
  });
};

const enterNewAddress: ButtonHandler = async (interaction, decoded) => {
  await interaction.showModal(buildRefundAddressModal(decoded.dealId));
};

/** The buyer's final, fund-moving confirmation of their own submitted refund address. */
const confirmRefundPrompt: ButtonHandler = async (interaction, decoded) => {
  await sendConfirmationPrompt(interaction, {
    namespace: 'refund',
    action: 'confirm_refund',
    dealId: decoded.dealId,
    title: 'Confirm your refund address?',
    description:
      'Double-check the address shown in the status message above is correct. This immediately broadcasts the refund transaction — this action is FINAL and cannot be reversed.',
    cancelLabel: 'Wrong Wallet',
    highRisk: true,
  });
};

/** "Wrong Wallet" — clears the previously submitted address and reopens the entry modal, rather than a plain cancel. */
const confirmRefundWrong: ButtonHandler = async (interaction, decoded) => {
  await interaction.showModal(buildRefundAddressModal(decoded.dealId));
};

const confirmRefundConfirm: ButtonHandler = async (interaction, decoded, deps) => {
  await interaction.update({ embeds: [buildSimpleEmbed('⏳ Broadcasting refund…')], components: [] });
  const result = await deps.confirmRefund.execute(asDealId(decoded.dealId), interaction.user.id);
  await interaction.editReply({
    embeds: [
      result.ok
        ? buildSimpleEmbed('✅ Refund broadcast. The funds are on their way back to the buyer.', 'success')
        : buildSimpleEmbed(`❌ ${result.error.message}`, 'error'),
    ],
  });
};

export function registerRefundFlowHandlers(registry: HandlerRegistry): void {
  registry.registerButton('deal:refund_request', refundRequestPrompt);
  registry.registerButton('deal:confirm_refund_request', refundRequestConfirm);
  registry.registerButton('deal:cancel_refund_request', handleCancel);

  registry.registerButton('refund:submit_address', submitAddressPrompt);
  registry.registerButton('refund:use_saved_address', useSavedAddress);
  registry.registerButton('refund:enter_new_address', enterNewAddress);

  registry.registerButton('refund:confirm_refund', confirmRefundPrompt);
  registry.registerButton('refund:confirm_confirm_refund', confirmRefundConfirm);
  registry.registerButton('refund:cancel_confirm_refund', confirmRefundWrong);

  registry.registerModal('refund:submit_address', handleRefundAddressModalSubmit);
}
