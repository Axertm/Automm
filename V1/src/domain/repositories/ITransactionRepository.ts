import type { Transaction } from '../entities/Transaction.js';
import type { DealId, TransactionId, TxId } from '../value-objects/EntityId.js';
import type { TransactionDirection } from '../entities/Transaction.js';

export interface ITransactionRepository {
  save(transaction: Transaction): Promise<void>;
  findById(id: TransactionId): Promise<Transaction | null>;
  findByDealId(dealId: DealId): Promise<Transaction[]>;
  findByDealAndTxid(dealId: DealId, txid: TxId, direction: TransactionDirection): Promise<Transaction | null>;
}
