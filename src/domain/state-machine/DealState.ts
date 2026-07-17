export const DEAL_STATES = [
  'CREATED',
  'AWAITING_DEPOSIT',
  'PARTIALLY_FUNDED',
  'FUNDED',
  'RELEASE_REQUESTED',
  'AWAITING_PAYOUT_CONFIRMATION',
  'PAYOUT_IN_PROGRESS',
  'COMPLETED',
  'FROZEN',
  'REFUNDED',
  'CANCELLED',
] as const;

export type DealState = (typeof DEAL_STATES)[number];

export function isDealState(value: string): value is DealState {
  return (DEAL_STATES as readonly string[]).includes(value);
}

export function assertDealState(value: string): DealState {
  if (!isDealState(value)) {
    throw new Error(`Invalid deal state: ${value}`);
  }
  return value;
}

/**
 * States a deal may be frozen from. Includes PAYOUT_IN_PROGRESS so an admin
 * can pause (and later unfreeze back to) a payout that's stuck — e.g. the
 * broadcast failed and nothing retries it automatically — rather than it
 * being permanently unrecoverable outside of AdminRetryPayoutUseCase.
 */
export const FREEZABLE_STATES: readonly DealState[] = [
  'AWAITING_DEPOSIT',
  'PARTIALLY_FUNDED',
  'FUNDED',
  'RELEASE_REQUESTED',
  'AWAITING_PAYOUT_CONFIRMATION',
  'PAYOUT_IN_PROGRESS',
];

/** States a deal may be refunded from (funds have arrived and payout hasn't executed yet). */
export const REFUNDABLE_STATES: readonly DealState[] = ['PARTIALLY_FUNDED', 'FUNDED'];
