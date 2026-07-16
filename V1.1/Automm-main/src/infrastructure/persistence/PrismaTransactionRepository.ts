import type { PrismaClient, Transaction as PrismaTransaction } from '@prisma/client';
import {
  Transaction,
  type TransactionDirection,
  type TransactionStatus,
} from '../../domain/entities/Transaction.js';
import { assertCurrency } from '../../domain/value-objects/Currency.js';
import { Money } from '../../domain/value-objects/Money.js';
import {
  asDealId,
  asTransactionId,
  asTxId,
  type DealId,
  type TransactionId,
  type TxId,
} from '../../domain/value-objects/EntityId.js';
import type { ITransactionRepository } from '../../domain/repositories/ITransactionRepository.js';

function toDomain(row: PrismaTransaction): Transaction {
  const currency = assertCurrency(row.currency);
  return Transaction.create({
    id: asTransactionId(row.id),
    dealId: asDealId(row.dealId),
    txid: asTxId(row.txid),
    direction: row.direction as TransactionDirection,
    status: row.status as TransactionStatus,
    currency,
    amount: Money.fromDecimalString(currency, row.amount),
    confirmations: row.confirmations,
    detectedAt: row.detectedAt,
    confirmedAt: row.confirmedAt,
  });
}

export class PrismaTransactionRepository implements ITransactionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(transaction: Transaction): Promise<void> {
    const props = transaction.toProps();
    // Upsert on the real natural key (dealId, txid, direction), not the
    // synthetic `id` — ExecutePayoutUseCase generates a fresh id on every
    // call, including retries, but a retry that re-signs the same UTXO set
    // deterministically produces the SAME txid as a prior attempt. Keying on
    // `id` meant that case could never find the existing row and always fell
    // through to `create`, hitting the (dealId, txid, direction) unique
    // constraint instead of updating in place.
    await this.prisma.transaction.upsert({
      where: { dealId_txid_direction: { dealId: props.dealId, txid: props.txid, direction: props.direction } },
      create: {
        id: props.id,
        dealId: props.dealId,
        txid: props.txid,
        direction: props.direction,
        status: props.status,
        currency: props.currency,
        amount: props.amount.toDecimalString(),
        confirmations: props.confirmations,
        detectedAt: props.detectedAt,
        confirmedAt: props.confirmedAt,
      },
      update: {
        status: props.status,
        confirmations: props.confirmations,
        confirmedAt: props.confirmedAt,
      },
    });
  }

  async findById(id: TransactionId): Promise<Transaction | null> {
    const row = await this.prisma.transaction.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByDealId(dealId: DealId): Promise<Transaction[]> {
    const rows = await this.prisma.transaction.findMany({ where: { dealId } });
    return rows.map(toDomain);
  }

  async findByDealAndTxid(
    dealId: DealId,
    txid: TxId,
    direction: TransactionDirection,
  ): Promise<Transaction | null> {
    const row = await this.prisma.transaction.findUnique({
      where: { dealId_txid_direction: { dealId, txid, direction } },
    });
    return row ? toDomain(row) : null;
  }
}
