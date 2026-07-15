import type { Currency } from '../value-objects/Currency.js';
import type { Money } from '../value-objects/Money.js';
import type { DealId, TransactionId, TxId } from '../value-objects/EntityId.js';

export const TRANSACTION_DIRECTIONS = ['DEPOSIT', 'PAYOUT', 'FEE', 'REFUND'] as const;
export type TransactionDirection = (typeof TRANSACTION_DIRECTIONS)[number];

export const TRANSACTION_STATUSES = ['PENDING', 'CONFIRMED', 'FAILED'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export interface TransactionProps {
  id: TransactionId;
  dealId: DealId;
  txid: TxId;
  direction: TransactionDirection;
  status: TransactionStatus;
  currency: Currency;
  amount: Money;
  confirmations: number;
  detectedAt: Date;
  confirmedAt: Date | null;
}

export class Transaction {
  private constructor(private props: TransactionProps) {}

  static create(props: TransactionProps): Transaction {
    return new Transaction(props);
  }

  get id(): TransactionId {
    return this.props.id;
  }

  get dealId(): DealId {
    return this.props.dealId;
  }

  get txid(): TxId {
    return this.props.txid;
  }

  get direction(): TransactionDirection {
    return this.props.direction;
  }

  get status(): TransactionStatus {
    return this.props.status;
  }

  get amount(): Money {
    return this.props.amount;
  }

  get confirmations(): number {
    return this.props.confirmations;
  }

  updateConfirmations(confirmations: number, requiredConfirmations: number): void {
    this.props.confirmations = confirmations;
    if (confirmations >= requiredConfirmations && this.props.status === 'PENDING') {
      this.props.status = 'CONFIRMED';
      this.props.confirmedAt = new Date();
    }
  }

  markFailed(): void {
    this.props.status = 'FAILED';
  }

  isConfirmed(): boolean {
    return this.props.status === 'CONFIRMED';
  }

  toProps(): Readonly<TransactionProps> {
    return { ...this.props };
  }
}
