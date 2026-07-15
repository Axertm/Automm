import { EmbedBuilder } from 'discord.js';
import type { DealWizardState } from './DealWizardState.js';

const STEP_LABELS = [
  'Buyer Selected',
  'Seller Selected',
  'Roles Confirmed',
  'Coin Selected',
  'Amount Confirmed',
  'Final Confirmation',
] as const;

function stepLine(index: number, state: DealWizardState): string {
  const stepNumber = index + 1;
  const label = STEP_LABELS[index];
  if (stepNumber < state.step) return `Step ${stepNumber}/6 ✅ ${label}`;
  if (stepNumber === state.step) return `Step ${stepNumber}/6 ⏳ ${label}`;
  return `Step ${stepNumber}/6 ⬜ ${label}`;
}

export function buildProgressText(state: DealWizardState): string {
  return Array.from({ length: 6 }, (_, i) => stepLine(i, state)).join('\n');
}

export function buildProgressEmbed(state: DealWizardState, title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`Escrow Setup — ${title}`)
    .setDescription(description)
    .addFields({ name: 'Progress', value: `\`\`\`\n${buildProgressText(state)}\n\`\`\`` })
    .setColor(0x5865f2)
    .setFooter({ text: `Deal ID: ${state.dealId}` });
}
