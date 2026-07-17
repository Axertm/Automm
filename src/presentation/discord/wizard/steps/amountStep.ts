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
import { currencyMetadata } from '../../../../domain/value-objects/Currency.js';
import {
  encodeCancel,
  encodeConfirm,
  encodeCustomId,
  type DecodedCustomId,
} from '../../interaction-router/CustomId.js';
import { buildProgressEmbed } from '../progressEmbed.js';
import { buildSimpleEmbed } from '../../embeds/SimpleEmbed.js';
import type { DealWizardState } from '../DealWizardState.js';
import type { AppDependencies } from '../../AppDependencies.js';
import type { HandlerRegistry } from '../../interaction-router/HandlerRegistry.js';

const USD_INPUT_ID = 'usdAmount';
const USD_DECIMAL_PATTERN = /^\d+(\.\d{1,2})?$/;

export function buildAmountStepMessage(state: DealWizardState) {
  const embed = buildProgressEmbed(
    state,
    'Enter the Amount',
    'Click below to enter the deal amount in **US dollars**. It will be converted to the current market amount of the coin at today’s price — deals are always entered in $, never directly in coin units.',
  );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeCustomId('wizard', 'enter_amount', state.dealId))
      .setLabel('Enter Amount ($)')
      .setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [row] };
}

function buildAmountModal(dealId: string): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId(USD_INPUT_ID)
    .setLabel('Amount in USD ($)')
    .setPlaceholder('e.g. 100')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(15);
  return new ModalBuilder()
    .setCustomId(encodeCustomId('wizard', 'enter_amount', dealId))
    .setTitle('Enter Escrow Amount (USD)')
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

async function handleOpenModal(interaction: ButtonInteraction, deps: AppDependencies): Promise<void> {
  const state = deps.dealWizardStore.get(interaction.channelId);
  if (!state) {
    await interaction.reply({
      embeds: [buildSimpleEmbed('This wizard session has expired. Please create a new ticket.', 'error')],
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
      embeds: [buildSimpleEmbed('This wizard session has expired. Please create a new ticket.', 'error')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const usdRaw = interaction.fields.getTextInputValue(USD_INPUT_ID).trim();
  if (!USD_DECIMAL_PATTERN.test(usdRaw) || Number(usdRaw) <= 0) {
    await interaction.reply({
      embeds: [
        buildSimpleEmbed(`"${usdRaw}" is not a valid USD amount. Enter a number like \`100\` or \`49.99\`.`, 'error'),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const usdAmount = Number(usdRaw);

  let usdPrice: number;
  try {
    usdPrice = await deps.priceProvider.getUsdPrice(state.currency);
  } catch {
    await interaction.reply({
      embeds: [
        buildSimpleEmbed(
          `Could not fetch the current ${state.currency} price right now. Please try again in a moment.`,
          'error',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { decimals } = currencyMetadata(state.currency);
  const coinDecimal = (usdAmount / usdPrice).toFixed(decimals);

  let amount: Money;
  try {
    amount = Money.fromDecimalString(state.currency, coinDecimal);
    if (amount.isZero()) throw new Error('Amount must be greater than zero');
  } catch {
    await interaction.reply({
      embeds: [
        buildSimpleEmbed(
          `$${usdRaw} converts to 0 ${state.currency} at the current price — please enter a larger amount.`,
          'error',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { fee, remainder } = amount.splitByBasisPoints(deps.env.FEE_BASIS_POINTS);

  const embed = new EmbedBuilder()
    .setTitle('Confirm Amount')
    .addFields(
      { name: 'Amount (USD)', value: `$${usdRaw}`, inline: true },
      { name: 'Coin', value: state.currency, inline: true },
      {
        name: `Live Price (1 ${state.currency})`,
        value: `$${usdPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
        inline: true,
      },
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
    .setDescription('The coin amount is locked in now, at today’s price — it will not change even if the market price moves before deposit.')
    .setColor(0xf1c40f)
    .setFooter({ text: `Deal ID: ${state.dealId}` });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeConfirm('wizard', 'enter_amount', state.dealId, `${usdRaw}:${amount.toDecimalString()}`))
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

  const [usdAmountDecimal, amountDecimal] = decoded.extra?.split(':') ?? [];
  if (!usdAmountDecimal || !amountDecimal) {
    await interaction.reply({
      embeds: [buildSimpleEmbed('Amount expired — please enter it again.', 'error')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const updated = deps.dealWizardStore.update(interaction.channelId, {
    usdAmountDecimal,
    amountDecimal,
    amountConfirmed: true,
    step: 5,
  });
  if (!updated) return;

  const { buildFinalSummaryMessage } = await import('./finalStep.js');
  await interaction.update(buildFinalSummaryMessage(updated, deps));
}

async function handleWrong(interaction: ButtonInteraction, deps: AppDependencies): Promise<void> {
  const state = deps.dealWizardStore.get(interaction.channelId);
  if (!state) return;
  const updated = deps.dealWizardStore.update(interaction.channelId, {
    usdAmountDecimal: null,
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
