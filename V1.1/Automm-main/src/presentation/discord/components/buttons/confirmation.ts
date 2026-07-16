import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { encodeCancel, encodeConfirm } from '../../interaction-router/CustomId.js';
import { buildSimpleEmbed } from '../../embeds/SimpleEmbed.js';

export interface ConfirmationPromptOptions {
  namespace: string;
  action: string;
  dealId: string;
  title: string;
  description: string;
  /** Set true for the highest-risk actions (e.g. admin payout-address override) to render stronger warning styling/copy. */
  highRisk?: boolean;
  /** Opaque token (e.g. a PendingActionCache key) carried through to the confirm/cancel handler's custom_id. */
  extra?: string;
  /** Overrides the cancel button's label, e.g. "Wrong Selection" / "Wrong Wallet" / "Wrong Amount" instead of the generic "Cancel". */
  cancelLabel?: string;
}

/**
 * Renders the mandatory confirmation step for every fund/state-mutating
 * action. The triggering command/button NEVER invokes a use case directly —
 * only the resulting "confirm:<action>" button handler does.
 */
export async function sendConfirmationPrompt(
  interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
  options: ConfirmationPromptOptions,
): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle(options.highRisk ? `⚠️ ${options.title}` : options.title)
    .setDescription(options.description)
    .setColor(options.highRisk ? 0xe74c3c : 0xf1c40f);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeConfirm(options.namespace, options.action, options.dealId, options.extra))
      .setLabel(options.highRisk ? 'I understand — confirm' : 'Confirm')
      .setStyle(options.highRisk ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(encodeCancel(options.namespace, options.action, options.dealId, options.extra))
      .setLabel(options.cancelLabel ?? 'Cancel')
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
}

export async function handleCancel(interaction: ButtonInteraction): Promise<void> {
  await interaction.update({
    embeds: [buildSimpleEmbed('Cancelled — no changes were made.')],
    components: [],
  });
}
