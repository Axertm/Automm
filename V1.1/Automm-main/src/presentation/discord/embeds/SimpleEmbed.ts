import { EmbedBuilder } from 'discord.js';

export type SimpleEmbedTone = 'info' | 'success' | 'warning' | 'error';

const TONE_COLOR: Record<SimpleEmbedTone, number> = {
  info: 0x5865f2,
  success: 0x2ecc71,
  warning: 0xf1c40f,
  error: 0xe74c3c,
};

/**
 * Wraps a short message as a minimal one-line embed. Used everywhere a
 * plain-text interaction reply/update or channel.send would otherwise be
 * sent, so every message the bot posts renders consistently as an embed —
 * never a bare content string.
 */
export function buildSimpleEmbed(description: string, tone: SimpleEmbedTone = 'info'): EmbedBuilder {
  return new EmbedBuilder().setDescription(description).setColor(TONE_COLOR[tone]);
}
