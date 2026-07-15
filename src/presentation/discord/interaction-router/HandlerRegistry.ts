import type {
  AnySelectMenuInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import type { AppDependencies } from '../AppDependencies.js';
import type { DecodedCustomId } from './CustomId.js';

export type SlashCommandData =
  SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;

export interface SlashCommandDefinition {
  data: SlashCommandData;
  execute: (interaction: ChatInputCommandInteraction, deps: AppDependencies) => Promise<void>;
}

export type ButtonHandler = (
  interaction: ButtonInteraction,
  decoded: DecodedCustomId,
  deps: AppDependencies,
) => Promise<void>;
export type ModalHandler = (
  interaction: ModalSubmitInteraction,
  decoded: DecodedCustomId,
  deps: AppDependencies,
) => Promise<void>;
export type SelectMenuHandler = (
  interaction: AnySelectMenuInteraction,
  decoded: DecodedCustomId,
  deps: AppDependencies,
) => Promise<void>;

export class HandlerRegistry {
  private readonly commands = new Map<string, SlashCommandDefinition>();
  private readonly buttonHandlers = new Map<string, ButtonHandler>();
  private readonly modalHandlers = new Map<string, ModalHandler>();
  private readonly selectMenuHandlers = new Map<string, SelectMenuHandler>();

  registerCommand(definition: SlashCommandDefinition): void {
    this.commands.set(definition.data.name, definition);
  }

  registerButton(namespaceAction: string, handler: ButtonHandler): void {
    this.buttonHandlers.set(namespaceAction, handler);
  }

  registerModal(namespaceAction: string, handler: ModalHandler): void {
    this.modalHandlers.set(namespaceAction, handler);
  }

  registerSelectMenu(namespaceAction: string, handler: SelectMenuHandler): void {
    this.selectMenuHandlers.set(namespaceAction, handler);
  }

  getCommand(name: string): SlashCommandDefinition | undefined {
    return this.commands.get(name);
  }

  getButtonHandler(namespace: string, action: string): ButtonHandler | undefined {
    return this.buttonHandlers.get(`${namespace}:${action}`);
  }

  getModalHandler(namespace: string, action: string): ModalHandler | undefined {
    return this.modalHandlers.get(`${namespace}:${action}`);
  }

  getSelectMenuHandler(namespace: string, action: string): SelectMenuHandler | undefined {
    return this.selectMenuHandlers.get(`${namespace}:${action}`);
  }

  allCommands(): SlashCommandDefinition[] {
    return [...this.commands.values()];
  }
}
