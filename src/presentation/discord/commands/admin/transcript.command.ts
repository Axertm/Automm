import { AttachmentBuilder, ChannelType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommandDefinition } from '../../interaction-router/HandlerRegistry.js';
import { requireAdmin } from './adminAuth.js';
import { resolveDealOrWizardSession } from '../resolveDealById.js';
import { buildSimpleEmbed } from '../../embeds/SimpleEmbed.js';

const MAX_MESSAGES = 500;
const PAGE_SIZE = 100;

export const transcriptCommand: SlashCommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('transcript')
    .setDescription('[Admin] Export a text transcript of a deal’s ticket channel')
    .addStringOption((opt) => opt.setName('deal_id').setDescription('The Deal ID').setRequired(true)),

  async execute(interaction, deps) {
    if (!(await requireAdmin(interaction, deps))) return;
    const resolved = await resolveDealOrWizardSession(interaction, deps);
    if (!resolved) return;

    const dealId = resolved.kind === 'deal' ? resolved.deal.id : resolved.state.dealId;
    const ticketChannelId =
      resolved.kind === 'deal' ? resolved.deal.toProps().ticketChannelId : resolved.state.channelId;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel = await interaction.client.channels.fetch(ticketChannelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.editReply({
        embeds: [buildSimpleEmbed('The ticket channel for this deal no longer exists.', 'error')],
      });
      return;
    }

    const lines: string[] = [`Transcript for deal ${dealId} — channel #${channel.name}`, ''];
    let before: string | undefined;
    let fetchedTotal = 0;
    const batches: Array<Awaited<ReturnType<typeof channel.messages.fetch>>> = [];

    while (fetchedTotal < MAX_MESSAGES) {
      const batch = await channel.messages.fetch({ limit: PAGE_SIZE, before });
      if (batch.size === 0) break;
      batches.push(batch);
      fetchedTotal += batch.size;
      before = batch.last()?.id;
      if (batch.size < PAGE_SIZE) break;
    }

    const allMessages = batches
      .flatMap((batch) => [...batch.values()])
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    for (const message of allMessages) {
      const timestamp = new Date(message.createdTimestamp).toISOString();
      const content =
        message.content ||
        (message.embeds.length > 0 ? '[embed]' : message.attachments.size > 0 ? '[attachment]' : '');
      lines.push(`[${timestamp}] ${message.author.tag}: ${content}`);
    }

    const buffer = Buffer.from(lines.join('\n'), 'utf-8');
    const attachment = new AttachmentBuilder(buffer, { name: `transcript-${dealId}.txt` });
    await interaction.editReply({
      embeds: [buildSimpleEmbed(`Transcript (${allMessages.length} messages):`)],
      files: [attachment],
    });
  },
};
