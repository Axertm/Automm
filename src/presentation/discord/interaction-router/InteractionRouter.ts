import { Events, MessageFlags, type Client, type Interaction } from 'discord.js';
import type { Logger } from 'pino';
import type { AppDependencies } from '../AppDependencies.js';
import { decodeCustomId } from './CustomId.js';
import type { HandlerRegistry } from './HandlerRegistry.js';
import { buildSimpleEmbed } from '../embeds/SimpleEmbed.js';

/** The single interactionCreate dispatcher — routes every command/button/modal to its registered handler. */
export function registerInteractionRouter(
  client: Client,
  registry: HandlerRegistry,
  deps: AppDependencies,
  logger: Logger,
): void {
  client.on(Events.InteractionCreate, (interaction) => {
    void handle(interaction);
  });

  async function handle(interaction: Interaction): Promise<void> {
    try {
      if (interaction.isChatInputCommand()) {
        const command = registry.getCommand(interaction.commandName);
        if (!command) return;
        await command.execute(interaction, deps);
        return;
      }

      if (interaction.isButton()) {
        const decoded = decodeCustomId(interaction.customId);
        const handler = registry.getButtonHandler(decoded.namespace, decoded.action);
        if (!handler) return;
        await handler(interaction, decoded, deps);
        return;
      }

      if (interaction.isModalSubmit()) {
        const decoded = decodeCustomId(interaction.customId);
        const handler = registry.getModalHandler(decoded.namespace, decoded.action);
        if (!handler) return;
        await handler(interaction, decoded, deps);
        return;
      }

      if (interaction.isAnySelectMenu()) {
        const decoded = decodeCustomId(interaction.customId);
        const handler = registry.getSelectMenuHandler(decoded.namespace, decoded.action);
        if (!handler) return;
        await handler(interaction, decoded, deps);
        return;
      }
    } catch (error) {
      logger.error({ err: (error as Error).message }, 'interaction_handler_failed');
      if (!interaction.isRepliable()) return;

      const errorEmbed = buildSimpleEmbed(
        'Something went wrong handling that action. Please try again or contact an admin.',
        'error',
      );
      // A handler that already called .update()/.reply() (e.g. to show an
      // "⏳ …" placeholder before an async step) has `replied`/`deferred`
      // already true here — reply() would throw "already replied" and the
      // placeholder would be left stuck forever with no error ever shown.
      // editReply() overwrites that placeholder in place instead.
      const send =
        interaction.replied || interaction.deferred
          ? interaction.editReply({ embeds: [errorEmbed], components: [] })
          : interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
      await send.catch(() => undefined);
    }
  }
}
