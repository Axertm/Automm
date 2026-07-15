import { asDealId } from '../../../../domain/value-objects/EntityId.js';
import type { ButtonHandler, HandlerRegistry } from '../../interaction-router/HandlerRegistry.js';
import { sendConfirmationPrompt, handleCancel } from './confirmation.js';
import { buildPayoutAddressModal, handlePayoutAddressModalSubmit } from '../modals/payoutAddressModal.js';

const releaseRequestPrompt: ButtonHandler = async (interaction, decoded) => {
  await sendConfirmationPrompt(interaction, {
    namespace: 'deal',
    action: 'release_request',
    dealId: decoded.dealId,
    title: 'Release funds to seller?',
    description:
      'This starts the release process. The seller will be asked to submit a payout address, and you will give a final confirmation before any funds move.',
  });
};

const releaseRequestConfirm: ButtonHandler = async (interaction, decoded, deps) => {
  const result = await deps.requestRelease.execute(asDealId(decoded.dealId), interaction.user.id, 'BUYER');
  await interaction.update({
    content: result.ok
      ? '✅ Release requested. Waiting for the seller to submit a payout address.'
      : `❌ ${result.error.message}`,
    embeds: [],
    components: [],
  });
};

const submitAddressPrompt: ButtonHandler = async (interaction, decoded) => {
  await interaction.showModal(buildPayoutAddressModal(decoded.dealId));
};

const confirmWalletPrompt: ButtonHandler = async (interaction, decoded) => {
  await sendConfirmationPrompt(interaction, {
    namespace: 'payout',
    action: 'confirm_wallet',
    dealId: decoded.dealId,
    title: 'Confirm your payout address?',
    description:
      'Double-check the address shown in the status message above is correct. This cannot be undone once funds are sent.',
    cancelLabel: 'Wrong Wallet',
  });
};

/** "Wrong Wallet" — clears the previously submitted address and reopens the entry modal, rather than a plain cancel. */
const confirmWalletWrong: ButtonHandler = async (interaction, decoded) => {
  await interaction.showModal(buildPayoutAddressModal(decoded.dealId));
};

const confirmWalletConfirm: ButtonHandler = async (interaction, decoded, deps) => {
  const result = await deps.confirmPayoutWallet.execute(asDealId(decoded.dealId), interaction.user.id);
  await interaction.update({
    content: result.ok
      ? '✅ Payout address confirmed. Waiting for the buyer to give final release confirmation.'
      : `❌ ${result.error.message}`,
    embeds: [],
    components: [],
  });
};

const confirmReleasePrompt: ButtonHandler = async (interaction, decoded) => {
  await sendConfirmationPrompt(interaction, {
    namespace: 'payout',
    action: 'confirm_release',
    dealId: decoded.dealId,
    title: 'Release funds now?',
    description:
      'This immediately broadcasts the payout transaction. This action is FINAL and cannot be reversed.',
    highRisk: true,
  });
};

const confirmReleaseConfirm: ButtonHandler = async (interaction, decoded, deps) => {
  await interaction.update({ content: '⏳ Broadcasting payout…', embeds: [], components: [] });
  const result = await deps.confirmRelease.execute(asDealId(decoded.dealId), interaction.user.id);
  await interaction.editReply({
    content: result.ok
      ? '✅ Payout broadcast. It will be marked completed once confirmed on-chain.'
      : `❌ ${result.error.message}`,
  });
};

export function registerReleaseFlowHandlers(registry: HandlerRegistry): void {
  registry.registerButton('deal:release_request', releaseRequestPrompt);
  registry.registerButton('deal:confirm_release_request', releaseRequestConfirm);
  registry.registerButton('deal:cancel_release_request', handleCancel);

  registry.registerButton('payout:submit_address', submitAddressPrompt);

  registry.registerButton('payout:confirm_wallet', confirmWalletPrompt);
  registry.registerButton('payout:confirm_confirm_wallet', confirmWalletConfirm);
  registry.registerButton('payout:cancel_confirm_wallet', confirmWalletWrong);

  registry.registerButton('payout:confirm_release', confirmReleasePrompt);
  registry.registerButton('payout:confirm_confirm_release', confirmReleaseConfirm);
  registry.registerButton('payout:cancel_confirm_release', handleCancel);

  registry.registerModal('payout:submit_address', handlePayoutAddressModalSubmit);
}
