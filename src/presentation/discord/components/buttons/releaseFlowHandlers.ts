import { asDealId } from '../../../../domain/value-objects/EntityId.js';
import type { ButtonHandler, HandlerRegistry } from '../../interaction-router/HandlerRegistry.js';
import { sendConfirmationPrompt, handleCancel } from './confirmation.js';
import { buildPayoutAddressModal, handlePayoutAddressModalSubmit } from '../modals/payoutAddressModal.js';
import { buildSimpleEmbed } from '../../embeds/SimpleEmbed.js';

const releaseRequestPrompt: ButtonHandler = async (interaction, decoded) => {
  await sendConfirmationPrompt(interaction, {
    namespace: 'deal',
    action: 'release_request',
    dealId: decoded.dealId,
    title: 'Release funds to seller?',
    description:
      'This starts the release process. You will be asked for a final confirmation next — only after that can the seller submit a payout address.',
  });
};

const releaseRequestConfirm: ButtonHandler = async (interaction, decoded, deps) => {
  const result = await deps.requestRelease.execute(asDealId(decoded.dealId), interaction.user.id, 'BUYER');
  await interaction.update({
    embeds: [
      result.ok
        ? buildSimpleEmbed('✅ Release requested. Please give your final confirmation next.', 'success')
        : buildSimpleEmbed(`❌ ${result.error.message}`, 'error'),
    ],
    components: [],
  });
};

const submitAddressPrompt: ButtonHandler = async (interaction, decoded) => {
  await interaction.showModal(buildPayoutAddressModal(decoded.dealId));
};

/** The seller's final, fund-moving confirmation of their own submitted address. */
const confirmWalletPrompt: ButtonHandler = async (interaction, decoded) => {
  await sendConfirmationPrompt(interaction, {
    namespace: 'payout',
    action: 'confirm_wallet',
    dealId: decoded.dealId,
    title: 'Confirm your payout address?',
    description:
      'Double-check the address shown in the status message above is correct. This immediately broadcasts the payout transaction — this action is FINAL and cannot be reversed.',
    cancelLabel: 'Wrong Wallet',
    highRisk: true,
  });
};

/** "Wrong Wallet" — clears the previously submitted address and reopens the entry modal, rather than a plain cancel. */
const confirmWalletWrong: ButtonHandler = async (interaction, decoded) => {
  await interaction.showModal(buildPayoutAddressModal(decoded.dealId));
};

const confirmWalletConfirm: ButtonHandler = async (interaction, decoded, deps) => {
  await interaction.update({ embeds: [buildSimpleEmbed('⏳ Broadcasting payout…')], components: [] });
  const result = await deps.confirmPayoutWallet.execute(asDealId(decoded.dealId), interaction.user.id);
  await interaction.editReply({
    embeds: [
      result.ok
        ? buildSimpleEmbed(
            '✅ Payout broadcast. It will be marked completed once confirmed on-chain.',
            'success',
          )
        : buildSimpleEmbed(`❌ ${result.error.message}`, 'error'),
    ],
  });
};

/** The buyer's own confirmation that funds should be released — required before the seller may submit a payout address. No funds move yet. */
const confirmReleasePrompt: ButtonHandler = async (interaction, decoded) => {
  await sendConfirmationPrompt(interaction, {
    namespace: 'payout',
    action: 'confirm_release',
    dealId: decoded.dealId,
    title: 'Confirm you want to release funds?',
    description:
      'This confirms your intent to release the funds. The seller will then be asked to submit and confirm a payout address — no funds move until they do.',
  });
};

const confirmReleaseConfirm: ButtonHandler = async (interaction, decoded, deps) => {
  const result = await deps.confirmRelease.execute(asDealId(decoded.dealId), interaction.user.id);
  await interaction.update({
    embeds: [
      result.ok
        ? buildSimpleEmbed(
            '✅ Release confirmed. Waiting for the seller to submit a payout address.',
            'success',
          )
        : buildSimpleEmbed(`❌ ${result.error.message}`, 'error'),
    ],
    components: [],
  });
};

export function registerReleaseFlowHandlers(registry: HandlerRegistry): void {
  registry.registerButton('deal:release_request', releaseRequestPrompt);
  registry.registerButton('deal:confirm_release_request', releaseRequestConfirm);
  registry.registerButton('deal:cancel_release_request', handleCancel);

  registry.registerButton('payout:confirm_release', confirmReleasePrompt);
  registry.registerButton('payout:confirm_confirm_release', confirmReleaseConfirm);
  registry.registerButton('payout:cancel_confirm_release', handleCancel);

  registry.registerButton('payout:submit_address', submitAddressPrompt);

  registry.registerButton('payout:confirm_wallet', confirmWalletPrompt);
  registry.registerButton('payout:confirm_confirm_wallet', confirmWalletConfirm);
  registry.registerButton('payout:cancel_confirm_wallet', confirmWalletWrong);

  registry.registerModal('payout:submit_address', handlePayoutAddressModalSubmit);
}
