export const DEAL_STATES = [
  'CREATED',
  'AWAITING_DEPOSIT',
  'PARTIALLY_FUNDED',
  'FUNDED',
  'RELEASE_REQUESTED',
  'AWAITING_PAYOUT_CONFIRMATION',
  'REFUND_REQUESTED',
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

/** States a deal may be frozen from — i.e. any state before real fund movement (payout) begins. */
export const FREEZABLE_STATES: readonly DealState[] = [
  'AWAITING_DEPOSIT',
  'PARTIALLY_FUNDED',
  'FUNDED',
  'RELEASE_REQUESTED',
  'AWAITING_PAYOUT_CONFIRMATION',
  'REFUND_REQUESTED',
];

/**
 * States a deal may be refunded from (funds have arrived and payout hasn't
 * executed yet). REFUND_REQUESTED is included so the seller-initiated refund
 * flow (seller requests, buyer submits a refund address) can finalize back to
 * REFUNDED — and so an admin can still force a refund on a deal already in
 * that flow.
 */
export const REFUNDABLE_STATES: readonly DealState[] = [
  'PARTIALLY_FUNDED',
  'FUNDED',
  'REFUND_REQUESTED',
];
