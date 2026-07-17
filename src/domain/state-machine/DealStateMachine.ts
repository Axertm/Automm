import { InvalidTransitionError } from '../errors/DomainErrors.js';
import { FREEZABLE_STATES, REFUNDABLE_STATES, type DealState } from './DealState.js';

/**
 * Explicit transition table. Every edge a Deal is ever allowed to take, and
 * nothing else — this is the single source of truth the Deal entity defers
 * to, deliberately kept free of any actor/authorization concerns (those are
 * enforced in the application layer's use cases, on top of these guards).
 */
const TRANSITIONS: Record<DealState, readonly DealState[]> = {
  CREATED: ['AWAITING_DEPOSIT', 'CANCELLED'],
  AWAITING_DEPOSIT: ['PARTIALLY_FUNDED', 'FUNDED', 'CANCELLED', 'FROZEN'],
  PARTIALLY_FUNDED: ['FUNDED', 'FROZEN', 'REFUNDED'],
  // The AWAITING_PAYOUT_CONFIRMATION edge here is admin-override-only —
  // Deal.overridePayoutAddressByAdmin can jump straight from FUNDED,
  // skipping the request/confirm steps entirely, to force-resolve a dispute.
  FUNDED: ['RELEASE_REQUESTED', 'AWAITING_PAYOUT_CONFIRMATION', 'FROZEN', 'REFUNDED'],
  // Buyer's own confirmReleaseByBuyer() is what makes this transition — the
  // seller isn't allowed to submit a payout address before it happens.
  RELEASE_REQUESTED: ['AWAITING_PAYOUT_CONFIRMATION', 'FROZEN', 'REFUNDED'],
  // The seller resubmitting/confirming their address, or an admin override,
  // happen without a state change (the buyer already confirmed to get
  // here) — the seller's own final confirmation is what then satisfies the
  // two-party gate and moves straight to PAYOUT_IN_PROGRESS.
  AWAITING_PAYOUT_CONFIRMATION: ['PAYOUT_IN_PROGRESS', 'FROZEN', 'REFUNDED'],
  // FROZEN here is what lets an admin pause a stuck payout (e.g. a failed
  // broadcast that nothing retries automatically) and later unfreeze it back
  // to PAYOUT_IN_PROGRESS to retry — see AdminRetryPayoutUseCase.
  PAYOUT_IN_PROGRESS: ['COMPLETED', 'FROZEN'],
  COMPLETED: [],
  FROZEN: [...FREEZABLE_STATES, ...REFUNDABLE_STATES],
  REFUNDED: [],
  CANCELLED: [],
};

export function canTransition(from: DealState, to: DealState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: DealState, to: DealState): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function canFreeze(from: DealState): boolean {
  return FREEZABLE_STATES.includes(from);
}

export function canRefund(from: DealState): boolean {
  return REFUNDABLE_STATES.includes(from);
}

export { TRANSITIONS };
