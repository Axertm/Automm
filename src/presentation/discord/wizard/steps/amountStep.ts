import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { Money } from '../../../../domain/value-objects/Money.js';
import {
  encodeCancel,
  encodeConfirm,
  encodeCustomId,
  type DecodedCustomId,
} from '../../interaction-router/CustomId.js';
import { buildProgressEmbed } from '../progressEmbed.js';
import type { DealWizardState } from '../DealWizardState.js';
import type { AppDependencies } from '../../AppDependencies.js';
import type { HandlerRegistry } from '../../interaction-router/HandlerRegistry.js';

const AMOUNT_INPUT_ID = 'amount';

export function buildAmountStepMessage(state: DealWizardState) {
  const embed = buildProgressEmbed(
    state,
    'Enter the Amount',
    `Click below to enter the ${state.currency} amount for this deal.`,
  );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeCustomId('wizard', 'enter_amount', state.dealId))
      .setLabel('Enter Amount')
      .setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [row] };
}

function buildAmountModal(dealId: string): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId(AMOUNT_INPUT_ID)
    .setLabel('Amount')
    .setPlaceholder('e.g. 1.5')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(30);
  return new ModalBuilder()
    .setCustomId(encodeCustomId('wizard', 'enter_amount', dealId))
    .setTitle('Enter Escrow Amount')
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

async function handleOpenModal(interaction: ButtonInteraction, deps: AppDependencies): Promise<void> {
  const state = deps.dealWizardStore.get(interaction.channelId);
  if (!state) {
    await interaction.reply({
      content: 'This wizard session has expired. Please create a new ticket.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.showModal(buildAmountModal(state.dealId));
}

async function handleModalSubmit(interaction: ModalSubmitInteraction, deps: AppDependencies): Promise<void> {
  const state = interaction.channelId ? deps.dealWizardStore.get(interaction.channelId) : null;
  if (!state || !state.currency) {
    await interaction.reply({
      content: 'This wizard session has expired. Please create a new ticket.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const raw = interaction.fields.getTextInputValue(AMOUNT_INPUT_ID).trim();
  let amount: Money;
  try {
    amount = Money.fromDecimalString(state.currency, raw);
    if (amount.isZero()) throw new Error('Amount must be greater than zero');
  } catch {
    await interaction.reply({
      content: `"${raw}" is not a valid ${state.currency} amount. Please try again.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { fee, remainder } = amount.splitByBasisPoints(deps.env.FEE_BASIS_POINTS);

  const embed = new EmbedBuilder()
    .setTitle('Confirm Amount')
    .addFields(
      { name: 'Amount', value: `${amount.toDecimalString()} ${state.currency}`, inline: true },
      { name: 'Coin', value: state.currency, inline: true },
      {
        name: 'Deal Fee',
        value: `${fee.toDecimalString()} ${state.currency} (${(deps.env.FEE_BASIS_POINTS / 100).toFixed(2)}%)`,
        inline: true,
      },
      { name: 'Seller Receives', value: `${remainder.toDecimalString()} ${state.currency}`, inline: true },
      {
        name: 'Total Deposit Required',
        value: `${amount.toDecimalString()} ${state.currency}`,
        inline: true,
      },
    )
    .setColor(0xf1c40f)
    .setFooter({ text: `Deal ID: ${state.dealId}` });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeConfirm('wizard', 'enter_amount', state.dealId, amount.toDecimalString()))
      .setLabel('Confirm')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(encodeCancel('wizard', 'enter_amount', state.dealId))
      .setLabel('Wrong Amount')
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({ embeds: [embed], components: [row] });
}

async function handleConfirm(
  interaction: ButtonInteraction,
  decoded: DecodedCustomId,
  deps: AppDependencies,
): Promise<void> {
  const state = deps.dealWizardStore.get(interaction.channelId);
  if (!state) return;

  const amountDecimal = decoded.extra;
  if (!amountDecimal) {
    await interaction.reply({
      content: 'Amount expired — please enter it again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const updated = deps.dealWizardStore.update(interaction.channelId, {
    amountDecimal,
    amountConfirmed: true,
    step: 6,
  });
  if (!updated) return;

  const { buildFinalSummaryMessage } = await import('./finalStep.js');
  await interaction.update(buildFinalSummaryMessage(updated, deps));
}

async function handleWrong(interaction: ButtonInteraction, deps: AppDependencies): Promise<void> {
  const state = deps.dealWizardStore.get(interaction.channelId);
  if (!state) return;
  const updated = deps.dealWizardStore.update(interaction.channelId, {
    amountDecimal: null,
    amountConfirmed: false,
  });
  if (!updated) return;
  // "Wrong Amount" clears the stored amount and reopens the entry modal
  // directly, rather than an intermediate "Enter Amount" button click.
  await interaction.showModal(buildAmountModal(updated.dealId));
}

export function registerAmountStepHandlers(registry: HandlerRegistry): void {
  registry.registerButton('wizard:enter_amount', (interaction, _decoded, deps) =>
    handleOpenModal(interaction, deps),
  );
  registry.registerModal('wizard:enter_amount', (interaction, _decoded, deps) =>
    handleModalSubmit(interaction, deps),
  );
  registry.registerButton('wizard:confirm_enter_amount', (interaction, decoded, deps) =>
    handleConfirm(interaction, decoded, deps),
  );
  registry.registerButton('wizard:cancel_enter_amount', (interaction, _decoded, deps) =>
    handleWrong(interaction, deps),
  );
}
