import type { Currency } from '../value-objects/Currency.js';

/** A user's default payout address per currency, offered as a shortcut the next time they'd otherwise retype it. */
export interface ISavedPayoutAddressRepository {
  save(discordUserId: string, currency: Currency, address: string): Promise<void>;
  find(discordUserId: string, currency: Currency): Promise<string | null>;
}
