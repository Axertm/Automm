import { describe, expect, it } from 'vitest';
import {
  canTransition,
  assertTransition,
  canFreeze,
  canRefund,
} from '../../../src/domain/state-machine/DealStateMachine.js';
import { DEAL_STATES, type DealState } from '../../../src/domain/state-machine/DealState.js';
import { InvalidTransitionError } from '../../../src/domain/errors/DomainErrors.js';

const VALID_EDGES: Array<[DealState, DealState]> = [
  ['CREATED', 'AWAITING_DEPOSIT'],
  ['CREATED', 'CANCELLED'],
  ['AWAITING_DEPOSIT', 'PARTIALLY_FUNDED'],
  ['AWAITING_DEPOSIT', 'FUNDED'],
  ['AWAITING_DEPOSIT', 'CANCELLED'],
  ['PARTIALLY_FUNDED', 'FUNDED'],
  ['FUNDED', 'RELEASE_REQUESTED'],
  // Admin-override-only shortcut — see Deal.overridePayoutAddressByAdmin.
  ['FUNDED', 'AWAITING_PAYOUT_CONFIRMATION'],
  ['RELEASE_REQUESTED', 'AWAITING_PAYOUT_CONFIRMATION'],
  ['AWAITING_PAYOUT_CONFIRMATION', 'PAYOUT_IN_PROGRESS'],
  ['PAYOUT_IN_PROGRESS', 'COMPLETED'],
  ['PARTIALLY_FUNDED', 'FROZEN'],
  ['FUNDED', 'FROZEN'],
  ['RELEASE_REQUESTED', 'FROZEN'],
  ['AWAITING_PAYOUT_CONFIRMATION', 'FROZEN'],
  ['PAYOUT_IN_PROGRESS', 'FROZEN'],
  ['PARTIALLY_FUNDED', 'REFUNDED'],
  ['FUNDED', 'REFUNDED'],
  ['RELEASE_REQUESTED', 'REFUNDED'],
  ['AWAITING_PAYOUT_CONFIRMATION', 'REFUNDED'],
];

const INVALID_EDGES: Array<[DealState, DealState]> = [
  ['CREATED', 'FUNDED'],
  ['CREATED', 'COMPLETED'],
  ['PARTIALLY_FUNDED', 'CANCELLED'],
  ['FUNDED', 'CANCELLED'],
  ['FUNDED', 'PAYOUT_IN_PROGRESS'],
  ['RELEASE_REQUESTED', 'PAYOUT_IN_PROGRESS'],
  ['COMPLETED', 'REFUNDED'],
  ['REFUNDED', 'FUNDED'],
  ['CANCELLED', 'AWAITING_DEPOSIT'],
  ['PAYOUT_IN_PROGRESS', 'REFUNDED'],
];

describe('DealStateMachine', () => {
  it.each(VALID_EDGES)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it.each(INVALID_EDGES)('rejects %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(InvalidTransitionError);
  });

  it('exhaustively covers every declared state in the valid/invalid fixture sets', () => {
    const touched = new Set<DealState>();
    for (const [from, to] of [...VALID_EDGES, ...INVALID_EDGES]) {
      touched.add(from);
      touched.add(to);
    }
    for (const state of DEAL_STATES) {
      expect(touched.has(state)).toBe(true);
    }
  });

  it('a funded deal can never be CANCELLED — it must go through REFUNDED', () => {
    expect(canTransition('FUNDED', 'CANCELLED')).toBe(false);
    expect(canTransition('PARTIALLY_FUNDED', 'CANCELLED')).toBe(false);
  });

  describe('canFreeze', () => {
    it('permits freezing from any non-terminal state, including a payout stuck in flight', () => {
      for (const state of [
        'AWAITING_DEPOSIT',
        'PARTIALLY_FUNDED',
        'FUNDED',
        'RELEASE_REQUESTED',
        'AWAITING_PAYOUT_CONFIRMATION',
        'PAYOUT_IN_PROGRESS',
      ] as DealState[]) {
        expect(canFreeze(state)).toBe(true);
      }
    });

    it('forbids freezing before a deal exists yet or once it is terminal', () => {
      for (const state of ['CREATED', 'COMPLETED', 'REFUNDED', 'CANCELLED', 'FROZEN'] as DealState[]) {
        expect(canFreeze(state)).toBe(false);
      }
    });
  });

  describe('canRefund', () => {
    it('permits refund only from funded states', () => {
      expect(canRefund('PARTIALLY_FUNDED')).toBe(true);
      expect(canRefund('FUNDED')).toBe(true);
    });

    it('forbids refund from unfunded or terminal states', () => {
      for (const state of ['CREATED', 'AWAITING_DEPOSIT', 'COMPLETED', 'CANCELLED'] as DealState[]) {
        expect(canRefund(state)).toBe(false);
      }
    });
  });
});
