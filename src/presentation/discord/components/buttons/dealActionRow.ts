import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { Deal } from '../../../../domain/entities/Deal.js';
import { encodeCustomId } from '../../interaction-router/CustomId.js';

/** Contextual action button(s) for the deal's current state, attached to the pinned status embed. */
export function buildDealActionRow(deal: Deal): ActionRowBuilder<ButtonBuilder> | null {
  const props = deal.toProps();

  if (props.state === 'FUNDED') {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId('deal', 'release_request', props.id))
        .setLabel('Release Funds')
        .setStyle(ButtonStyle.Success),
    );
  }

  if (props.state === 'RELEASE_REQUESTED' && !props.payoutAddress) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId('payout', 'submit_address', props.id))
        .setLabel('Submit Payout Address')
        .setStyle(ButtonStyle.Primary),
    );
  }

  if (props.state === 'RELEASE_REQUESTED' && props.payoutAddress && !props.payoutAddressConfirmedBySeller) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId('payout', 'confirm_wallet', props.id))
        .setLabel('Confirm Payout Address')
        .setStyle(ButtonStyle.Success),
    );
  }

  if (props.state === 'AWAITING_PAYOUT_CONFIRMATION') {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId('payout', 'confirm_release', props.id))
        .setLabel('Confirm & Release Funds')
        .setStyle(ButtonStyle.Success),
    );
  }

  return null;
}
