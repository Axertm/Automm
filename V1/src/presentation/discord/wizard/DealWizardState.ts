import type { Currency } from '../../../domain/value-objects/Currency.js';
import type { DealId } from '../../../domain/value-objects/EntityId.js';

export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

export interface DealWizardState {
  dealId: DealId;
  guildId: string;
  channelId: string;
  initiatorId: string;
  step: WizardStep;

  buyerId: string | null;
  buyerConfirmed: boolean;

  sellerId: string | null;
  sellerConfirmed: boolean;

  buyerRoleConfirmed: boolean;
  sellerRoleConfirmed: boolean;

  currency: Currency | null;
  currencyConfirmed: boolean;

  amountDecimal: string | null;
  amountConfirmed: boolean;

  buyerFinalConfirmed: boolean;
  sellerFinalConfirmed: boolean;

  createdAt: Date;
}

export function createInitialWizardState(params: {
  dealId: DealId;
  guildId: string;
  channelId: string;
  initiatorId: string;
}): DealWizardState {
  return {
    ...params,
    step: 1,
    buyerId: null,
    buyerConfirmed: false,
    sellerId: null,
    sellerConfirmed: false,
    buyerRoleConfirmed: false,
    sellerRoleConfirmed: false,
    currency: null,
    currencyConfirmed: false,
    amountDecimal: null,
    amountConfirmed: false,
    buyerFinalConfirmed: false,
    sellerFinalConfirmed: false,
    createdAt: new Date(),
  };
}

/**
 * Wizard progress is deliberately in-memory only, scoped to one ticket
 * channel — nothing here is "real" (no Deal row exists, no funds are at
 * risk) until step 6 finalizes it via CreateDealUseCase, so DB durability
 * isn't needed. A bot restart mid-wizard loses progress; the user re-runs
 * "Create Escrow" to start over (documented trade-off, mirrors
 * PendingActionCache's same in-memory-only design for admin action reasons).
 */
export class DealWizardStore {
  private readonly states = new Map<string, DealWizardState>();

  create(state: DealWizardState): void {
    this.states.set(state.channelId, state);
  }

  get(channelId: string): DealWizardState | null {
    return this.states.get(channelId) ?? null;
  }

  /**
   * Looks up an in-progress (not-yet-finalized) wizard session by its
   * short Deal ID, for admin commands run against an ID that hasn't been
   * persisted yet — the ticket channel already exists and has the ID in
   * its name/embeds well before step 6 creates the real Deal row.
   */
  findByDealId(dealId: string): DealWizardState | null {
    for (const state of this.states.values()) {
      if (state.dealId === dealId) return state;
    }
    return null;
  }

  update(channelId: string, patch: Partial<DealWizardState>): DealWizardState | null {
    const current = this.states.get(channelId);
    if (!current) return null;
    const next = { ...current, ...patch };
    this.states.set(channelId, next);
    return next;
  }

  delete(channelId: string): void {
    this.states.delete(channelId);
  }
}
