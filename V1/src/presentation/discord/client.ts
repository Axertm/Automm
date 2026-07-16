import { Client, GatewayIntentBits, REST, Routes, Events } from 'discord.js';
import type { Logger } from 'pino';
import type { Env } from '../../config/env.schema.js';
import type { AppDependencies } from './AppDependencies.js';
import { buildHandlerRegistry } from './registerAllHandlers.js';
import { registerInteractionRouter } from './interaction-router/InteractionRouter.js';

export function createDiscordClient(): Client {
  return new Client({ intents: [GatewayIntentBits.Guilds] });
}

export async function registerSlashCommands(
  env: Env,
  registry: ReturnType<typeof buildHandlerRegistry>,
  logger: Logger,
): Promise<void> {
  const rest = new REST().setToken(env.DISCORD_TOKEN);
  const body = registry.allCommands().map((command) => command.data.toJSON());
  await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID), { body });
  logger.info({ count: body.length }, 'slash_commands_registered');
}

export async function startDiscordBot(deps: AppDependencies): Promise<Client> {
  const client = createDiscordClient();
  const registry = buildHandlerRegistry();

  registerInteractionRouter(client, registry, deps, deps.logger);

  client.once(Events.ClientReady, (readyClient) => {
    deps.logger.info({ tag: readyClient.user.tag }, 'discord_client_ready');
  });

  await registerSlashCommands(deps.env, registry, deps.logger);
  await client.login(deps.env.DISCORD_TOKEN);

  return client;
}
