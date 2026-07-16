import type { IDiscordNotifier } from '../../src/application/ports/IDiscordNotifier.js';
import type { DealId } from '../../src/domain/value-objects/EntityId.js';

export class FakeDiscordNotifier implements IDiscordNotifier {
  readonly calls: Array<{ method: string; dealId: DealId; extra?: unknown }> = [];

  async dealFunded(dealId: DealId): Promise<void> {
    this.calls.push({ method: 'dealFunded', dealId });
  }

  async depositDetected(dealId: DealId, txid: string, confirmations: number): Promise<void> {
    this.calls.push({ method: 'depositDetected', dealId, extra: { txid, confirmations } });
  }

  async releaseRequested(dealId: DealId): Promise<void> {
    this.calls.push({ method: 'releaseRequested', dealId });
  }

  async releaseConfirmedByBuyer(dealId: DealId): Promise<void> {
    this.calls.push({ method: 'releaseConfirmedByBuyer', dealId });
  }

  async payoutAddressSubmitted(dealId: DealId): Promise<void> {
    this.calls.push({ method: 'payoutAddressSubmitted', dealId });
  }

  async payoutConfirmedBySeller(dealId: DealId): Promise<void> {
    this.calls.push({ method: 'payoutConfirmedBySeller', dealId });
  }

  async payoutCompleted(dealId: DealId): Promise<void> {
    this.calls.push({ method: 'payoutCompleted', dealId });
  }

  async dealStateChanged(dealId: DealId): Promise<void> {
    this.calls.push({ method: 'dealStateChanged', dealId });
  }
}
