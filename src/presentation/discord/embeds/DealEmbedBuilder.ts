import { EmbedBuilder } from 'discord.js';
import type { Deal } from '../../../domain/entities/Deal.js';
import type { Wallet } from '../../../domain/entities/Wallet.js';
import type { DealState } from '../../../domain/state-machine/DealState.js';

/**
 * Per-state presentation: a colour, a human-readable label with a status dot,
 * and a one-line hint describing what's happening or what's needed next. Keeps
 * the raw SCREAMING_SNAKE_CASE enum out of the user-facing embed.
 */
const STATE_META: Record<DealState, { color: number; label: string; hint: string }> = {
  CREATED: { color: 0x95a5a6, label: '⚪ Draft', hint: 'Setting up the deal…' },
  AWAITING_DEPOSIT: {
    color: 0xf1c40f,
    label: '🟡 Awaiting Deposit',
    hint: 'Waiting for the buyer to send funds to the deposit address below.',
  },
  PARTIALLY_FUNDED: {
    color: 0xe67e22,
    label: '🟠 Partially Funded',
    hint: 'Some funds have arrived — waiting for the full amount.',
  },
  FUNDED: {
    color: 0x2ecc71,
    label: '🟢 Funded',
    hint: 'Funds are secured in escrow. The buyer can release, or the seller can refund.',
  },
  RELEASE_REQUESTED: {
    color: 0x3498db,
    label: '🔵 Release Requested',
    hint: 'Waiting for the buyer to give their final release confirmation.',
  },
  AWAITING_PAYOUT_CONFIRMATION: {
    color: 0x3498db,
    label: '🔵 Awaiting Payout',
    hint: 'Waiting for the seller to submit and confirm a payout address.',
  },
  REFUND_REQUESTED: {
    color: 0xe67e22,
    label: '🟠 Refund Requested',
    hint: 'Waiting for the buyer to submit and confirm an address to receive the refund.',
  },
  PAYOUT_IN_PROGRESS: {
    color: 0x9b59b6,
    label: '🟣 Payout In Progress',
    hint: 'The transaction has been broadcast — waiting for on-chain confirmation.',
  },
  COMPLETED: { color: 0x2ecc71, label: '🟢 Completed', hint: 'Payout confirmed. This deal is closed.' },
  FROZEN: { color: 0xe74c3c, label: '🔴 Frozen', hint: 'An admin has paused this deal.' },
  REFUNDED: {
    color: 0xe74c3c,
    label: '🔴 Refunded',
    hint: 'Funds were returned to the buyer. This deal is closed.',
  },
  CANCELLED: {
    color: 0x7f8c8d,
    label: '⚫ Cancelled',
    hint: 'This deal was cancelled before any funds moved.',
  },
};

const EXPLORER_TX_URL: Record<string, (txid: string) => string> = {
  LTC: (txid) => `https://litecoinspace.org/tx/${txid}`,
  SOL: (txid) => `https://explorer.solana.com/tx/${txid}`,
};

/** Renders a Deal's current state as the ticket channel's pinned status embed — edited in place on every transition. */
export function buildDealStatusEmbed(deal: Deal, wallet: Wallet | null): EmbedBuilder {
  const props = deal.toProps();
  const meta = STATE_META[props.state];

  const embed = new EmbedBuilder()
    .setAuthor({ name: `Escrow Deal · ${props.currency}` })
    .setTitle(meta.label)
    .setDescription(meta.hint)
    .setColor(meta.color)
    .addFields(
      {
        name: 'Amount',
        value: `**${props.expectedAmount.toDecimalString()} ${props.currency}**`,
        inline: true,
      },
      { name: 'Escrow Fee', value: `${(props.feeBasisPointsSnapshot / 100).toFixed(2)}%`, inline: true },
      { name: '​', value: '​', inline: true },
      { name: 'Buyer', value: `<@${props.buyerDiscordId}>`, inline: true },
      { name: 'Seller', value: `<@${props.sellerDiscordId}>`, inline: true },
      { name: '​', value: '​', inline: true },
    )
    .setFooter({ text: `Deal ID: ${props.id}` })
    .setTimestamp(props.updatedAt);

  if (wallet) {
    embed.addFields({ name: '📥 Deposit Address', value: `\`\`\`${wallet.address}\`\`\``, inline: false });
  }
  if (props.payoutAddress) {
    const status = props.payoutAddressConfirmedBySeller
      ? '✅ Confirmed by seller'
      : '⏳ Awaiting seller confirmation';
    embed.addFields({ name: '📤 Payout Address', value: `\`\`\`${props.payoutAddress}\`\`\`\n${status}` });
  }
  if (props.refundAddress) {
    const status = props.state === 'REFUND_REQUESTED' ? '\n⏳ Awaiting buyer confirmation' : '';
    embed.addFields({ name: '↩️ Refund Address', value: `\`\`\`${props.refundAddress}\`\`\`${status}` });
  }
  if (props.payoutAddressOverriddenByAdmin) {
    embed.addFields({
      name: '⚠️ Payout Address Overridden by Admin',
      value: `Reason: ${props.payoutOverrideReason ?? 'n/a'}`,
    });
  }
  if (props.frozenReason) {
    embed.addFields({ name: '🔴 Frozen', value: props.frozenReason });
  }
  if (props.payoutMainTxId) {
    const urlBuilder = EXPLORER_TX_URL[props.currency];
    const link = urlBuilder
      ? `[View on explorer](${urlBuilder(props.payoutMainTxId)})`
      : `\`${props.payoutMainTxId}\``;
    embed.addFields({ name: '🧾 Payout Transaction', value: link });
  }

  return embed;
}

export function buildTxidExplorerLink(currency: string, txid: string): string {
  return EXPLORER_TX_URL[currency]?.(txid) ?? txid;
}
