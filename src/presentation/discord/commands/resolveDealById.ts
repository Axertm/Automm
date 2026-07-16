import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import type { Deal } from '../../../domain/entities/Deal.js';
import { asDealId } from '../../../domain/value-objects/EntityId.js';
import type { AppDependencies } from '../AppDependencies.js';
import type { DealWizardState } from '../wizard/DealWizardState.js';
import { buildSimpleEmbed } from '../embeds/SimpleEmbed.js';

/**
 * Every deal-related admin command takes an explicit `deal_id` option rather
 * than inferring the deal from whichever channel the command happens to be
 * run in — admins can act on a deal from anywhere (e.g. after its ticket
 * was archived), and this makes it impossible to accidentally act on the
 * wrong deal because you typed a command in the wrong channel.
 *
 * A Deal ID becomes valid for this lookup only once the ticket wizard
 * finalizes it (step 6) — before that it exists only as an in-progress
 * wizard session (see resolveDealOrWizardSession below for commands that
 * only need the ticket channel and can work during setup too). If the ID
 * matches an active wizard session, the error message says so explicitly
 * rather than a generic "not found".
 */
export async function resolveDealById(
  interaction: ChatInputCommandInteraction,
  deps: AppDependencies,
): Promise<Deal | null> {
  const rawId = interaction.options.getString('deal_id', true).trim();
  const deal = await deps.dealRepository.findById(asDealId(rawId));
  if (!deal) {
    const wizardSession = deps.dealWizardStore.findByDealId(rawId);
    await interaction.reply({
      embeds: [
        buildSimpleEmbed(
          wizardSession
            ? `Deal \`${rawId}\` is still being set up in its ticket (<#${wizardSession.channelId}>) — it isn't finalized yet, so there's nothing to act on. Finish the setup wizard first.`
            : `No deal found with ID \`${rawId}\`. Double-check the Deal ID and try again.`,
          'error',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }
  return deal;
}

export type DealOrWizardSession = { kind: 'deal'; deal: Deal } | { kind: 'wizard'; state: DealWizardState };

/**
 * For admin commands that only need the ticket channel (transcript, close,
 * deal-info) and can therefore work on a deal that's still mid-setup, not
 * just a finalized one.
 */
export async function resolveDealOrWizardSession(
  interaction: ChatInputCommandInteraction,
  deps: AppDependencies,
): Promise<DealOrWizardSession | null> {
  const rawId = interaction.options.getString('deal_id', true).trim();
  const deal = await deps.dealRepository.findById(asDealId(rawId));
  if (deal) return { kind: 'deal', deal };

  const wizardSession = deps.dealWizardStore.findByDealId(rawId);
  if (wizardSession) return { kind: 'wizard', state: wizardSession };

  await interaction.reply({
    embeds: [
      buildSimpleEmbed(
        `No deal or in-progress ticket found with ID \`${rawId}\`. Double-check the Deal ID and try again.`,
        'error',
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
  return null;
}
