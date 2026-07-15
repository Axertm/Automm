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
  FUNDED: ['RELEASE_REQUESTED', 'FROZEN', 'REFUNDED'],
  RELEASE_REQUESTED: ['AWAITING_PAYOUT_CONFIRMATION', 'FROZEN', 'REFUNDED'],
  AWAITING_PAYOUT_CONFIRMATION: ['PAYOUT_IN_PROGRESS', 'FROZEN', 'REFUNDED'],
  PAYOUT_IN_PROGRESS: ['COMPLETED'],
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
