import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { Deal } from '../../../../domain/entities/Deal.js';
import { encodeCustomId } from '../../interaction-router/CustomId.js';

/** Contextual action button(s) for the deal's current state, attached to the pinned status embed. */
export function buildDealActionRow(deal: Deal): ActionRowBuilder<ButtonBuilder> | null {
  const props = deal.toProps();

  if (props.state === 'FUNDED') {
    // "Release Funds" is the buyer's action; "Refund to Buyer" is the seller's
    // — the party who would otherwise be paid out offering the money back. Both
    // are offered here; each use case enforces which party may actually act.
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId('deal', 'release_request', props.id))
        .setLabel('Release Funds')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(encodeCustomId('deal', 'refund_request', props.id))
        .setLabel('Refund to Buyer')
        .setStyle(ButtonStyle.Secondary),
    );
  }

  // The seller has offered a refund — now it's the buyer's turn to submit and
  // confirm the address they want their funds returned to. Mirror image of the
  // AWAITING_PAYOUT_CONFIRMATION row below.
  if (props.state === 'REFUND_REQUESTED') {
    if (!props.refundAddress) {
      return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeCustomId('refund', 'submit_address', props.id))
          .setLabel('Submit Refund Address')
          .setStyle(ButtonStyle.Primary),
      );
    }
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId('refund', 'confirm_refund', props.id))
        .setLabel('Confirm & Send Refund')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(encodeCustomId('refund', 'submit_address', props.id))
        .setLabel('Change Refund Address')
        .setStyle(ButtonStyle.Secondary),
    );
  }

  // Buyer hasn't given final confirmation yet — the seller can't act until
  // they do (see Deal.confirmReleaseByBuyer / Deal.submitPayoutAddress).
  if (props.state === 'RELEASE_REQUESTED') {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId('payout', 'confirm_release', props.id))
        .setLabel('Confirm Release')
        .setStyle(ButtonStyle.Success),
    );
  }

  // Buyer has confirmed — now it's the seller's turn to submit and confirm
  // a payout address. The seller's confirmation is the final, fund-moving
  // step, so it's always offered alongside a way to change the address
  // first if it's wrong.
  if (props.state === 'AWAITING_PAYOUT_CONFIRMATION') {
    if (!props.payoutAddress) {
      return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeCustomId('payout', 'submit_address', props.id))
          .setLabel('Submit Payout Address')
          .setStyle(ButtonStyle.Primary),
      );
    }
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId('payout', 'confirm_wallet', props.id))
        .setLabel('Confirm & Release Funds')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(encodeCustomId('payout', 'submit_address', props.id))
        .setLabel('Change Payout Address')
        .setStyle(ButtonStyle.Secondary),
    );
  }

  return null;
}
