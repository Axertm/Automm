import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { CURRENCIES, type Currency } from '../../../../domain/value-objects/Currency.js';
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

const CURRENCY_LABELS: Record<Currency, string> = { LTC: 'Litecoin (LTC)', SOL: 'Solana (SOL)' };

export function buildCurrencyStepMessage(state: DealWizardState) {
  const embed = buildProgressEmbed(
    state,
    'Select the Currency',
    'Choose which cryptocurrency this deal will use.',
  );
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(encodeCustomId('wizard', 'select_currency', state.dealId))
      .setPlaceholder('Select a currency...')
      .addOptions(CURRENCIES.map((c) => ({ label: CURRENCY_LABELS[c], value: c }))),
  );
  return { embeds: [embed], components: [row] };
}

async function handleSelect(interaction: StringSelectMenuInteraction, deps: AppDependencies): Promise<void> {
  const state = deps.dealWizardStore.get(interaction.channelId);
  if (!state) {
    await interaction.reply({
      embeds: [buildSimpleEmbed('This wizard session has expired. Please create a new ticket.', 'error')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const currency = interaction.values[0] as Currency;
  const embed = new EmbedBuilder()
    .setTitle('Confirm Currency')
    .setDescription(`You selected **${CURRENCY_LABELS[currency]}**. Is this correct?`)
    .setColor(0xf1c40f)
    .setFooter({ text: `Deal ID: ${state.dealId}` });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeConfirm('wizard', 'select_currency', state.dealId, currency))
      .setLabel('Confirm')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(encodeCancel('wizard', 'select_currency', state.dealId))
      .setLabel('Wrong Selection')
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.update({ embeds: [embed], components: [row] });
}

async function handleConfirm(
  interaction: ButtonInteraction,
  decoded: DecodedCustomId,
  deps: AppDependencies,
): Promise<void> {
  const state = deps.dealWizardStore.get(interaction.channelId);
  if (!state) return;

  const currency = decoded.extra as Currency | null;
  if (!currency || !(CURRENCIES as readonly string[]).includes(currency)) {
    await interaction.reply({
      embeds: [buildSimpleEmbed('Selection expired — please pick again.', 'error')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const updated = deps.dealWizardStore.update(interaction.channelId, {
    currency,
    currencyConfirmed: true,
    step: 5,
  });
  if (!updated) return;

  const { buildAmountStepMessage } = await import('./amountStep.js');
  await interaction.update(buildAmountStepMessage(updated));
}

async function handleWrong(interaction: ButtonInteraction, deps: AppDependencies): Promise<void> {
  const state = deps.dealWizardStore.get(interaction.channelId);
  if (!state) return;
  const updated = deps.dealWizardStore.update(interaction.channelId, {
    currency: null,
    currencyConfirmed: false,
  });
  if (!updated) return;
  await interaction.update(buildCurrencyStepMessage(updated));
}

export function registerCurrencyStepHandlers(registry: HandlerRegistry): void {
  registry.registerSelectMenu('wizard:select_currency', (interaction, _decoded, deps) =>
    handleSelect(interaction as StringSelectMenuInteraction, deps),
  );
  registry.registerButton('wizard:confirm_select_currency', (interaction, decoded, deps) =>
    handleConfirm(interaction, decoded, deps),
  );
  registry.registerButton('wizard:cancel_select_currency', (interaction, _decoded, deps) =>
    handleWrong(interaction, deps),
  );
}
