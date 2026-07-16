import { EmbedBuilder } from 'discord.js';
import type { Deal } from '../../../domain/entities/Deal.js';
import type { Wallet } from '../../../domain/entities/Wallet.js';

const STATE_COLOR: Record<string, number> = {
  CREATED: 0x95a5a6,
  AWAITING_DEPOSIT: 0xf1c40f,
  PARTIALLY_FUNDED: 0xe67e22,
  FUNDED: 0x2ecc71,
  RELEASE_REQUESTED: 0x3498db,
  AWAITING_PAYOUT_CONFIRMATION: 0x3498db,
  PAYOUT_IN_PROGRESS: 0x9b59b6,
  COMPLETED: 0x2ecc71,
  FROZEN: 0xe74c3c,
  REFUNDED: 0xe74c3c,
  CANCELLED: 0x7f8c8d,
};

const EXPLORER_TX_URL: Record<string, (txid: string) => string> = {
  LTC: (txid) => `https://litecoinspace.org/tx/${txid}`,
  SOL: (txid) => `https://explorer.solana.com/tx/${txid}`,
};

/** Renders a Deal's current state as the ticket channel's pinned status embed — edited in place on every transition. */
export function buildDealStatusEmbed(deal: Deal, wallet: Wallet | null): EmbedBuilder {
  const props = deal.toProps();
  const embed = new EmbedBuilder()
    .setTitle(`Escrow Deal — ${props.currency}`)
    .setColor(STATE_COLOR[props.state] ?? 0x95a5a6)
    .addFields(
      { name: 'Status', value: props.state, inline: true },
      { name: 'Currency', value: props.currency, inline: true },
      { name: 'Amount', value: `${props.expectedAmount.toDecimalString()} ${props.currency}`, inline: true },
      { name: 'Buyer', value: `<@${props.buyerDiscordId}>`, inline: true },
      { name: 'Seller', value: `<@${props.sellerDiscordId}>`, inline: true },
      { name: 'Fee', value: `${(props.feeBasisPointsSnapshot / 100).toFixed(2)}%`, inline: true },
    )
    .setFooter({ text: `Deal ID: ${props.id}` })
    .setTimestamp(props.updatedAt);

  if (wallet) {
    embed.addFields({ name: 'Deposit address', value: `\`${wallet.address}\``, inline: false });
  }
  if (props.payoutAddress) {
    embed.addFields({
      name: 'Payout address',
      value: `\`${props.payoutAddress}\`${props.payoutAddressConfirmedBySeller ? ' ✅ confirmed' : ' ⏳ awaiting seller confirmation'}`,
    });
  }
  if (props.payoutAddressOverriddenByAdmin) {
    embed.addFields({
      name: '⚠️ Payout address overridden by admin',
      value: `Reason: ${props.payoutOverrideReason ?? 'n/a'}`,
    });
  }
  if (props.frozenReason) {
    embed.addFields({ name: 'Frozen', value: props.frozenReason });
  }
  if (props.payoutMainTxId) {
    const urlBuilder = EXPLORER_TX_URL[props.currency];
    const link = urlBuilder ? urlBuilder(props.payoutMainTxId) : props.payoutMainTxId;
    embed.addFields({ name: 'Payout transaction', value: link });
  }

  return embed;
}

export function buildTxidExplorerLink(currency: string, txid: string): string {
  return EXPLORER_TX_URL[currency]?.(txid) ?? txid;
}
