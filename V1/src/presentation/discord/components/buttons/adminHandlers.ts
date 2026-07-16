import { asDealId } from '../../../../domain/value-objects/EntityId.js';
import type {
  ButtonHandler,
  HandlerRegistry,
  ModalHandler,
} from '../../interaction-router/HandlerRegistry.js';
import { sendConfirmationPrompt, handleCancel } from './confirmation.js';
import { readAddress, readReason } from '../modals/adminReasonModals.js';

const freezeModalSubmit: ModalHandler = async (interaction, decoded, deps) => {
  const reason = readReason(interaction);
  const token = deps.pendingActionCache.put({ reason });
  await sendConfirmationPrompt(interaction, {
    namespace: 'admin',
    action: 'freeze',
    dealId: decoded.dealId,
    extra: token,
    title: 'Freeze this deal?',
    description: `Reason: ${reason}\n\nNo further state changes or payouts can happen until an admin unfreezes it.`,
  });
};

const freezeConfirm: ButtonHandler = async (interaction, decoded, deps) => {
  const payload = deps.pendingActionCache.take(decoded.extra ?? '');
  const reason = payload?.reason ?? 'No reason recorded';
  const result = await deps.adminFreeze.execute(asDealId(decoded.dealId), interaction.user.id, reason);
  await interaction.update({
    content: result.ok ? '🧊 Deal frozen.' : `❌ ${result.error.message}`,
    embeds: [],
    components: [],
  });
};

const unfreezePrompt: ButtonHandler = async (interaction, decoded) => {
  await sendConfirmationPrompt(interaction, {
    namespace: 'admin',
    action: 'unfreeze',
    dealId: decoded.dealId,
    title: 'Unfreeze this deal?',
    description: 'The deal will resume from the state it was frozen in.',
  });
};

const unfreezeConfirm: ButtonHandler = async (interaction, decoded, deps) => {
  const result = await deps.adminUnfreeze.execute(asDealId(decoded.dealId), interaction.user.id);
  await interaction.update({
    content: result.ok ? '✅ Deal unfrozen.' : `❌ ${result.error.message}`,
    embeds: [],
    components: [],
  });
};

const cancelModalSubmit: ModalHandler = async (interaction, decoded, deps) => {
  const reason = readReason(interaction);
  const token = deps.pendingActionCache.put({ reason });
  await sendConfirmationPrompt(interaction, {
    namespace: 'admin',
    action: 'cancel',
    dealId: decoded.dealId,
    extra: token,
    title: 'Cancel this deal?',
    description: `Reason: ${reason}\n\nOnly possible before any funds have been deposited.`,
  });
};

const cancelConfirm: ButtonHandler = async (interaction, decoded, deps) => {
  const payload = deps.pendingActionCache.take(decoded.extra ?? '');
  const reason = payload?.reason ?? 'No reason recorded';
  const result = await deps.adminCancel.execute(asDealId(decoded.dealId), interaction.user.id, reason);
  await interaction.update({
    content: result.ok ? '🚫 Deal cancelled.' : `❌ ${result.error.message}`,
    embeds: [],
    components: [],
  });
};

const refundModalSubmit: ModalHandler = async (interaction, decoded, deps) => {
  const reason = readReason(interaction);
  const address = readAddress(interaction);
  const token = deps.pendingActionCache.put({ reason, address });
  await sendConfirmationPrompt(interaction, {
    namespace: 'admin',
    action: 'refund',
    dealId: decoded.dealId,
    extra: token,
    title: 'Refund the buyer?',
    description: `Reason: ${reason}\nRefund address: \`${address}\`\n\nThis immediately broadcasts a transaction and cannot be reversed.`,
    highRisk: true,
  });
};

const refundConfirm: ButtonHandler = async (interaction, decoded, deps) => {
  const payload = deps.pendingActionCache.take(decoded.extra ?? '');
  if (!payload) {
    await interaction.update({
      content: '❌ This confirmation has expired. Please run the command again.',
      embeds: [],
      components: [],
    });
    return;
  }
  await interaction.update({ content: '⏳ Broadcasting refund…', embeds: [], components: [] });
  const result = await deps.adminRefund.execute(
    asDealId(decoded.dealId),
    interaction.user.id,
    payload.reason ?? '',
    payload.address ?? '',
  );
  await interaction.editReply({ content: result.ok ? '✅ Refund broadcast.' : `❌ ${result.error.message}` });
};

const overrideModalSubmit: ModalHandler = async (interaction, decoded, deps) => {
  const reason = readReason(interaction);
  const address = readAddress(interaction);
  const token = deps.pendingActionCache.put({ reason, address });
  await sendConfirmationPrompt(interaction, {
    namespace: 'admin',
    action: 'override',
    dealId: decoded.dealId,
    extra: token,
    title: 'Override the seller’s payout address?',
    description: `Reason: ${reason}\nNew address: \`${address}\`\n\n**Funds will go to an address the seller did NOT confirm.** This is the highest-risk admin action available — only use it for verified dispute resolution.`,
    highRisk: true,
  });
};

const overrideConfirm: ButtonHandler = async (interaction, decoded, deps) => {
  const payload = deps.pendingActionCache.take(decoded.extra ?? '');
  if (!payload) {
    await interaction.update({
      content: '❌ This confirmation has expired. Please run the command again.',
      embeds: [],
      components: [],
    });
    return;
  }
  const result = await deps.adminOverridePayoutAddress.execute(
    asDealId(decoded.dealId),
    interaction.user.id,
    payload.address ?? '',
    payload.reason ?? '',
  );
  await interaction.update({
    content: result.ok
      ? '⚠️ Payout address overridden. Buyer confirmation is still required before funds move.'
      : `❌ ${result.error.message}`,
    embeds: [],
    components: [],
  });
};

const closeConfirm: ButtonHandler = async (interaction, decoded, deps) => {
  const deal = await deps.dealRepository.findById(asDealId(decoded.dealId));
  const ticketChannelId = deal
    ? deal.toProps().ticketChannelId
    : deps.dealWizardStore.findByDealId(decoded.dealId)?.channelId;

  if (!ticketChannelId) {
    await interaction.update({ content: '❌ Deal no longer exists.', embeds: [], components: [] });
    return;
  }

  if (!deal) {
    deps.dealWizardStore.delete(ticketChannelId);
  }

  const channel = await interaction.client.channels.fetch(ticketChannelId).catch(() => null);
  await interaction.update({ content: '🗑️ Closing ticket…', embeds: [], components: [] });
  if (channel?.isTextBased() && 'delete' in channel) {
    await channel.delete(`Closed by ${interaction.user.tag} via /close`).catch(() => undefined);
  }
};

const forceReleasePrompt: ButtonHandler = async (interaction, decoded) => {
  await sendConfirmationPrompt(interaction, {
    namespace: 'admin',
    action: 'force_release',
    dealId: decoded.dealId,
    title: 'Force release request?',
    description:
      'This starts the release process on the buyer’s behalf. The seller must still submit and confirm a payout address, and the buyer must still give final confirmation before funds move.',
    highRisk: true,
  });
};

const forceReleaseConfirm: ButtonHandler = async (interaction, decoded, deps) => {
  const result = await deps.requestRelease.execute(asDealId(decoded.dealId), interaction.user.id, 'ADMIN');
  await interaction.update({
    content: result.ok
      ? '✅ Release forced. Waiting on seller payout address.'
      : `❌ ${result.error.message}`,
    embeds: [],
    components: [],
  });
};

export function registerAdminHandlers(registry: HandlerRegistry): void {
  registry.registerModal('admin:freeze', freezeModalSubmit);
  registry.registerButton('admin:confirm_freeze', freezeConfirm);
  registry.registerButton('admin:cancel_freeze', handleCancel);

  registry.registerButton('admin:unfreeze', unfreezePrompt);
  registry.registerButton('admin:confirm_unfreeze', unfreezeConfirm);
  registry.registerButton('admin:cancel_unfreeze', handleCancel);

  registry.registerModal('admin:cancel', cancelModalSubmit);
  registry.registerButton('admin:confirm_cancel', cancelConfirm);
  registry.registerButton('admin:cancel_cancel', handleCancel);

  registry.registerModal('admin:refund', refundModalSubmit);
  registry.registerButton('admin:confirm_refund', refundConfirm);
  registry.registerButton('admin:cancel_refund', handleCancel);

  registry.registerModal('admin:override', overrideModalSubmit);
  registry.registerButton('admin:confirm_override', overrideConfirm);
  registry.registerButton('admin:cancel_override', handleCancel);

  registry.registerButton('admin:force_release', forceReleasePrompt);
  registry.registerButton('admin:confirm_force_release', forceReleaseConfirm);
  registry.registerButton('admin:cancel_force_release', handleCancel);

  registry.registerButton('admin:confirm_close', closeConfirm);
  registry.registerButton('admin:cancel_close', handleCancel);
}
