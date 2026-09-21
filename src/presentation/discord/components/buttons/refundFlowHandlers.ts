import { asDealId } from '../../../../domain/value-objects/EntityId.js';
import type { ButtonHandler, HandlerRegistry } from '../../interaction-router/HandlerRegistry.js';
import { sendConfirmationPrompt, handleCancel } from './confirmation.js';
import { buildRefundAddressModal, handleRefundAddressModalSubmit } from '../modals/refundAddressModal.js';
import { buildSimpleEmbed } from '../../embeds/SimpleEmbed.js';

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

/** The buyer submits the address they want their refund sent to. */
const submitAddressPrompt: ButtonHandler = async (interaction, decoded) => {
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

  registry.registerButton('refund:confirm_refund', confirmRefundPrompt);
  registry.registerButton('refund:confirm_confirm_refund', confirmRefundConfirm);
  registry.registerButton('refund:cancel_confirm_refund', confirmRefundWrong);

  registry.registerModal('refund:submit_address', handleRefundAddressModalSubmit);
}
