import type { Currency } from '../value-objects/Currency.js';
import type { Money } from '../value-objects/Money.js';
import type { DealId } from '../value-objects/EntityId.js';
import { assertTransition, canFreeze, canRefund } from '../state-machine/DealStateMachine.js';
import type { DealState } from '../state-machine/DealState.js';
import {
  InvalidTransitionError,
  PayoutConfirmationIncompleteError,
  UnauthorizedActorError,
} from '../errors/DomainErrors.js';

export interface DealProps {
  id: DealId;
  guildId: string;
  ticketChannelId: string;
  currency: Currency;
  state: DealState;
  buyerDiscordId: string;
  sellerDiscordId: string;
  expectedAmount: Money;
  feeBasisPointsSnapshot: number;
  payoutAddress: string | null;
  payoutAddressConfirmedBySeller: boolean;
  buyerReleaseConfirmed: boolean;
  payoutAddressOverriddenByAdmin: boolean;
  payoutOverrideReason: string | null;
  payoutOverrideByDiscordId: string | null;
  frozenFromState: DealState | null;
  frozenReason: string | null;
  frozenByDiscordId: string | null;
  cancelReason: string | null;
  refundReason: string | null;
  refundAddress: string | null;
  payoutFeeTxId: string | null;
  payoutMainTxId: string | null;
  createdAt: Date;
  updatedAt: Date;
  fundedAt: Date | null;
  completedAt: Date | null;
}

export type DealActorRole = 'BUYER' | 'SELLER' | 'ADMIN';

/**
 * Aggregate root for an escrow deal. Owns the state machine and every
 * mutation goes through an intention-revealing method that enforces its own
 * guard on top of DealStateMachine's transition table — there is
 * deliberately no public setState().
 */
export class Deal {
  private constructor(private props: DealProps) {}

  static create(props: DealProps): Deal {
    return new Deal(props);
  }

  get id(): DealId {
    return this.props.id;
  }

  get state(): DealState {
    return this.props.state;
  }

  get currency(): Currency {
    return this.props.currency;
  }

  get buyerDiscordId(): string {
    return this.props.buyerDiscordId;
  }

  get sellerDiscordId(): string {
    return this.props.sellerDiscordId;
  }

  get expectedAmount(): Money {
    return this.props.expectedAmount;
  }

  get feeBasisPointsSnapshot(): number {
    return this.props.feeBasisPointsSnapshot;
  }

  get payoutAddress(): string | null {
    return this.props.payoutAddress;
  }

  get payoutAddressConfirmedBySeller(): boolean {
    return this.props.payoutAddressConfirmedBySeller;
  }

  get buyerReleaseConfirmed(): boolean {
    return this.props.buyerReleaseConfirmed;
  }

  get frozenFromState(): DealState | null {
    return this.props.frozenFromState;
  }

  get payoutFeeTxId(): string | null {
    return this.props.payoutFeeTxId;
  }

  get payoutMainTxId(): string | null {
    return this.props.payoutMainTxId;
  }

  private transitionTo(next: DealState): void {
    assertTransition(this.props.state, next);
    this.props.state = next;
    this.props.updatedAt = new Date();
  }

  private assertActorIsBuyer(actorDiscordId: string, action: string): void {
    if (actorDiscordId !== this.props.buyerDiscordId) {
      throw new UnauthorizedActorError(action, 'BUYER');
    }
  }

  private assertActorIsSeller(actorDiscordId: string, action: string): void {
    if (actorDiscordId !== this.props.sellerDiscordId) {
      throw new UnauthorizedActorError(action, 'SELLER');
    }
  }

  // --- Funding lifecycle ---------------------------------------------------

  markAwaitingDeposit(): void {
    this.transitionTo('AWAITING_DEPOSIT');
  }

  /** Reconciles cumulative received funds against the expected amount and advances state accordingly. */
  recordDeposit(cumulativeReceived: Money): void {
    if (cumulativeReceived.isGreaterThanOrEqual(this.props.expectedAmount)) {
      if (this.props.state !== 'FUNDED') {
        this.transitionTo('FUNDED');
        this.props.fundedAt = new Date();
      }
      return;
    }
    if (!cumulativeReceived.isZero() && this.props.state === 'AWAITING_DEPOSIT') {
      this.transitionTo('PARTIALLY_FUNDED');
    }
  }

  // --- Release flow ----------------------------------------------------------

  requestRelease(actorDiscordId: string, actorRole: DealActorRole): void {
    if (actorRole === 'BUYER') {
      this.assertActorIsBuyer(actorDiscordId, 'requestRelease');
    } else if (actorRole !== 'ADMIN') {
      throw new UnauthorizedActorError('requestRelease', 'BUYER or ADMIN');
    }
    this.transitionTo('RELEASE_REQUESTED');
  }

  /**
   * The buyer's own confirmation that funds should be released — required
   * before the seller is even allowed to submit a payout address. Moves the
   * deal into AWAITING_PAYOUT_CONFIRMATION, which now means "the buyer has
   * committed to releasing; waiting on the seller's payout address."
   */
  confirmReleaseByBuyer(actorDiscordId: string): void {
    this.assertActorIsBuyer(actorDiscordId, 'confirmReleaseByBuyer');
    if (this.props.state !== 'RELEASE_REQUESTED') {
      throw new InvalidTransitionError(this.props.state, 'AWAITING_PAYOUT_CONFIRMATION');
    }
    this.props.buyerReleaseConfirmed = true;
    this.transitionTo('AWAITING_PAYOUT_CONFIRMATION');
  }

  /**
   * Only reachable once the buyer has already confirmed (state is
   * AWAITING_PAYOUT_CONFIRMATION) — the seller cannot submit a payout
   * address before that. Freely re-callable to correct a mistaken address:
   * it doesn't change state, only resets payoutAddressConfirmedBySeller, so
   * the seller can resubmit as many times as needed before their own final
   * confirmation actually starts the payout.
   */
  submitPayoutAddress(actorDiscordId: string, address: string): void {
    this.assertActorIsSeller(actorDiscordId, 'submitPayoutAddress');
    if (this.props.state !== 'AWAITING_PAYOUT_CONFIRMATION') {
      throw new InvalidTransitionError(this.props.state, 'AWAITING_PAYOUT_CONFIRMATION');
    }
    this.props.payoutAddress = address;
    this.props.payoutAddressConfirmedBySeller = false;
    this.props.updatedAt = new Date();
  }

  /**
   * The seller's own final confirmation of their submitted address. Since
   * this state is only reachable after the buyer already confirmed
   * (confirmReleaseByBuyer), this is the last thing needed to satisfy
   * startPayout()'s two-party gate — callers trigger the actual payout
   * immediately after this succeeds.
   */
  confirmPayoutAddressBySeller(actorDiscordId: string): void {
    this.assertActorIsSeller(actorDiscordId, 'confirmPayoutAddressBySeller');
    if (this.props.state !== 'AWAITING_PAYOUT_CONFIRMATION') {
      throw new InvalidTransitionError(this.props.state, 'AWAITING_PAYOUT_CONFIRMATION');
    }
    if (!this.props.payoutAddress) {
      throw new PayoutConfirmationIncompleteError('a submitted payout address');
    }
    this.props.payoutAddressConfirmedBySeller = true;
    this.props.updatedAt = new Date();
  }

  /** Enforced gate: both parties must have independently confirmed before funds move. */
  startPayout(): void {
    if (!this.props.payoutAddressConfirmedBySeller) {
      throw new PayoutConfirmationIncompleteError('seller payout address');
    }
    if (!this.props.buyerReleaseConfirmed) {
      throw new PayoutConfirmationIncompleteError('buyer release');
    }
    if (!this.props.payoutAddress) {
      throw new PayoutConfirmationIncompleteError('a submitted payout address');
    }
    this.transitionTo('PAYOUT_IN_PROGRESS');
  }

  recordPayoutFeeTx(txid: string): void {
    this.props.payoutFeeTxId = txid;
    this.props.updatedAt = new Date();
  }

  recordPayoutMainTx(txid: string): void {
    this.props.payoutMainTxId = txid;
    this.props.updatedAt = new Date();
  }

  markCompleted(): void {
    if (!this.props.payoutFeeTxId || !this.props.payoutMainTxId) {
      throw new PayoutConfirmationIncompleteError('fee and payout transactions');
    }
    this.transitionTo('COMPLETED');
    this.props.completedAt = new Date();
  }

  /**
   * The single highest-risk admin action: unconditionally forces a payout to
   * an admin-chosen address, bypassing both halves of the normal two-party
   * gate — neither the seller's own address submission/confirmation nor the
   * buyer's release confirmation is required. Callable from any state where
   * funds are already confirmed in escrow and haven't moved yet (FUNDED,
   * RELEASE_REQUESTED, AWAITING_PAYOUT_CONFIRMATION), or from FROZEN
   * wrapping one of those — an admin can resolve a dispute without either
   * party's cooperation and without a separate unfreeze step first. Requires
   * a mandatory reason and is distinctly audited — this is a break-glass
   * action, not a routine one.
   */
  overridePayoutAddressByAdmin(adminDiscordId: string, newAddress: string, reason: string): void {
    const allowedStates: DealState[] = ['FUNDED', 'RELEASE_REQUESTED', 'AWAITING_PAYOUT_CONFIRMATION'];
    const effectiveState =
      this.props.state === 'FROZEN' && this.props.frozenFromState
        ? this.props.frozenFromState
        : this.props.state;
    if (!allowedStates.includes(effectiveState)) {
      throw new InvalidTransitionError(this.props.state, 'AWAITING_PAYOUT_CONFIRMATION');
    }
    if (reason.trim().length === 0) {
      throw new Error('An override reason is required');
    }
    this.props.payoutAddress = newAddress;
    this.props.payoutAddressConfirmedBySeller = true;
    this.props.buyerReleaseConfirmed = true;
    this.props.payoutAddressOverriddenByAdmin = true;
    this.props.payoutOverrideReason = reason;
    this.props.payoutOverrideByDiscordId = adminDiscordId;
    this.props.frozenFromState = null;
    this.props.frozenReason = null;
    this.props.frozenByDiscordId = null;
    // Bypass the strict adjacency check the same way refund() does: this may
    // be jumping from FROZEN (wrapping a refundable/freezable state) or
    // straight from FUNDED, neither of which is a single valid edge to
    // AWAITING_PAYOUT_CONFIRMATION in the transition table.
    this.props.state = effectiveState;
    if (effectiveState === 'AWAITING_PAYOUT_CONFIRMATION') {
      this.props.updatedAt = new Date();
    } else {
      this.transitionTo('AWAITING_PAYOUT_CONFIRMATION');
    }
  }

  // --- Admin off-ramps -------------------------------------------------------

  freeze(adminDiscordId: string, reason: string): void {
    if (!canFreeze(this.props.state)) {
      throw new InvalidTransitionError(this.props.state, 'FROZEN');
    }
    this.props.frozenFromState = this.props.state;
    this.props.frozenReason = reason;
    this.props.frozenByDiscordId = adminDiscordId;
    this.transitionTo('FROZEN');
  }

  unfreeze(): void {
    if (this.props.state !== 'FROZEN' || !this.props.frozenFromState) {
      throw new InvalidTransitionError(this.props.state, 'previous state');
    }
    const restoreTo = this.props.frozenFromState;
    this.props.state = restoreTo;
    this.props.frozenFromState = null;
    this.props.frozenReason = null;
    this.props.frozenByDiscordId = null;
    this.props.updatedAt = new Date();
  }

  refund(_adminDiscordId: string, reason: string, refundAddress: string): void {
    const effectiveState =
      this.props.state === 'FROZEN' && this.props.frozenFromState
        ? this.props.frozenFromState
        : this.props.state;
    if (!canRefund(effectiveState)) {
      throw new InvalidTransitionError(this.props.state, 'REFUNDED');
    }
    this.props.refundReason = reason;
    this.props.refundAddress = refundAddress;
    this.props.frozenFromState = null;
    // Bypass the strict adjacency check since refund is reachable from either
    // the live state or a frozen state that wraps a refundable one.
    this.props.state = effectiveState;
    this.transitionTo('REFUNDED');
  }

  cancel(reason: string): void {
    this.props.cancelReason = reason;
    this.transitionTo('CANCELLED');
  }

  toProps(): Readonly<DealProps> {
    return { ...this.props };
  }
}
