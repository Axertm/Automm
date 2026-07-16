import type { DealId } from '../../domain/value-objects/EntityId.js';

/**
 * Everything a use case needs to trigger a Discord-side effect, without
 * importing discord.js. Implemented by presentation/discord and injected
 * into use cases — keeps application logic ignorant of embeds/channels.
 */
export interface IDiscordNotifier {
  dealFunded(dealId: DealId): Promise<void>;
  depositDetected(dealId: DealId, txid: string, confirmations: number): Promise<void>;
  releaseRequested(dealId: DealId): Promise<void>;
  payoutAddressSubmitted(dealId: DealId): Promise<void>;
  payoutConfirmedBySeller(dealId: DealId): Promise<void>;
  payoutCompleted(dealId: DealId): Promise<void>;
  dealStateChanged(dealId: DealId): Promise<void>;
}
