export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidTransitionError extends DomainError {
  readonly code = 'INVALID_TRANSITION';

  constructor(fromState: string, toState: string) {
    super(`Cannot transition deal from "${fromState}" to "${toState}"`);
  }
}

export class UnauthorizedActorError extends DomainError {
  readonly code = 'UNAUTHORIZED_ACTOR';

  constructor(action: string, requiredRole: string) {
    super(`Only a ${requiredRole} may perform "${action}"`);
  }
}

export class InsufficientFundsError extends DomainError {
  readonly code = 'INSUFFICIENT_FUNDS';

  constructor(expected: string, received: string) {
    super(`Insufficient funds: expected ${expected}, received ${received}`);
  }
}

export class InvalidAddressError extends DomainError {
  readonly code = 'INVALID_ADDRESS';

  constructor(address: string, currency: string) {
    super(`"${address}" is not a valid ${currency} address`);
  }
}

export class DealNotFoundError extends DomainError {
  readonly code = 'DEAL_NOT_FOUND';

  constructor(dealId: string) {
    super(`Deal "${dealId}" not found`);
  }
}

export class PayoutConfirmationIncompleteError extends DomainError {
  readonly code = 'PAYOUT_CONFIRMATION_INCOMPLETE';

  constructor(missing: string) {
    super(`Cannot execute payout: ${missing} confirmation is missing`);
  }
}

export class WalletAlreadyExistsError extends DomainError {
  readonly code = 'WALLET_ALREADY_EXISTS';

  constructor(dealId: string) {
    super(`Deal "${dealId}" already has a deposit wallet — wallets are never reused or regenerated`);
  }
}
