import { EmbedBuilder } from 'discord.js';
import type { DealWizardState } from './DealWizardState.js';

const STEP_LABELS = [
  'Participant Selected',
  'Roles Claimed',
  'Coin Selected',
  'Amount Confirmed',
  'Final Confirmation',
] as const;

function stepLine(index: number, state: DealWizardState): string {
  const stepNumber = index + 1;
  const total = STEP_LABELS.length;
  const label = STEP_LABELS[index];
  if (stepNumber < state.step) return `Step ${stepNumber}/${total} ✅ ${label}`;
  if (stepNumber === state.step) return `Step ${stepNumber}/${total} ⏳ ${label}`;
  return `Step ${stepNumber}/${total} ⬜ ${label}`;
}

export function buildProgressText(state: DealWizardState): string {
  return Array.from({ length: STEP_LABELS.length }, (_, i) => stepLine(i, state)).join('\n');
}

export function buildProgressEmbed(state: DealWizardState, title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`Escrow Setup — ${title}`)
    .setDescription(description)
    .addFields({ name: 'Progress', value: `\`\`\`\n${buildProgressText(state)}\n\`\`\`` })
    .setColor(0x5865f2)
    .setFooter({ text: `Deal ID: ${state.dealId}` });
}
