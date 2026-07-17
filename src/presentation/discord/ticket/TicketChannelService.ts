import { ChannelType, PermissionFlagsBits, type Guild, type TextChannel } from 'discord.js';
import type { Env } from '../../../config/env.schema.js';

const USER_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.AttachFiles,
] as const;

export class TicketChannelService {
  constructor(private readonly env: Env) {}

  /**
   * Creates the ticket the moment "Create Escrow" is clicked, before ANY
   * deal information (buyer, seller, currency, amount) is known — only the
   * initiator (whoever clicked the button), configured admin roles, and the
   * bot can see it at this point. The other participant's access is granted
   * later via grantAccess() once they're selected during the wizard — role
   * (buyer/seller) is claimed by each participant themselves afterward.
   * Named "escrow-<dealId>" using the short human-friendly deal ID
   * generated up front (see ShortDealIdGenerator), matching the requested
   * "escrow-482913" format.
   *
   * Note: a real Discord Administrator can always see the channel
   * regardless of these overwrites — Discord grants Administrator
   * permission holders implicit bypass of channel-level denies.
   */
  async createSetupTicket(guild: Guild, dealId: string, initiatorId: string): Promise<TextChannel> {
    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: initiatorId, allow: USER_PERMISSIONS },
      ...this.env.ADMIN_ROLE_IDS.map((roleId) => ({
        id: roleId,
        allow: [...USER_PERMISSIONS, PermissionFlagsBits.ManageMessages],
      })),
    ];

    return guild.channels.create({
      name: `escrow-${dealId}`,
      type: ChannelType.GuildText,
      parent: this.env.ESCROW_CATEGORY_ID || undefined,
      permissionOverwrites: overwrites,
      topic: `Escrow deal ${dealId} — setup in progress`,
    });
  }

  /** Grants a specific user (the confirmed buyer or seller) access to an already-created ticket channel. */
  async grantAccess(channel: TextChannel, discordUserId: string): Promise<void> {
    await channel.permissionOverwrites.edit(discordUserId, {
      ViewChannel: true,
      SendMessages: true,
      AttachFiles: true,
    });
  }

  async setTopic(channel: TextChannel, topic: string): Promise<void> {
    await channel.setTopic(topic).catch(() => undefined);
  }
}
