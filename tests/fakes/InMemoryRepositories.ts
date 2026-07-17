import type { Deal } from '../../src/domain/entities/Deal.js';
import type { Wallet } from '../../src/domain/entities/Wallet.js';
import type { Transaction, TransactionDirection } from '../../src/domain/entities/Transaction.js';
import type { AuditEntry } from '../../src/domain/entities/AuditEntry.js';
import type { Party } from '../../src/domain/entities/Party.js';
import type { IDealRepository } from '../../src/domain/repositories/IDealRepository.js';
import type { IWalletRepository } from '../../src/domain/repositories/IWalletRepository.js';
import type { ITransactionRepository } from '../../src/domain/repositories/ITransactionRepository.js';
import type { IAuditLogRepository } from '../../src/domain/repositories/IAuditLogRepository.js';
import type { IPartyRepository } from '../../src/domain/repositories/IPartyRepository.js';
import type {
  BackupAccountRecord,
  IBackupAccountRepository,
} from '../../src/domain/repositories/IBackupAccountRepository.js';
import type { DealBackupRecord, IDealBackupRepository } from '../../src/domain/repositories/IDealBackupRepository.js';
import type { ISavedPayoutAddressRepository } from '../../src/domain/repositories/ISavedPayoutAddressRepository.js';
import type { Currency } from '../../src/domain/value-objects/Currency.js';
import type { DealId, TransactionId, TxId, WalletId } from '../../src/domain/value-objects/EntityId.js';
import { DEAL_STATES, type DealState } from '../../src/domain/state-machine/DealState.js';

export class InMemoryDealRepository implements IDealRepository {
  private readonly deals = new Map<string, Deal>();
  // findById hands back the same mutable Deal instance that's stored here
  // (unlike a real DB read, which produces a fresh row each time), so a
  // caller mutating a Deal in-memory before calling saveIfCurrentStateIs
  // would otherwise see its own not-yet-persisted mutation reflected in
  // `deals` already. Tracking the last-saved state separately keeps the CAS
  // check honest about what's actually "persisted".
  private readonly persistedStates = new Map<string, DealState>();

  async save(deal: Deal): Promise<void> {
    this.deals.set(deal.id, deal);
    this.persistedStates.set(deal.id, deal.state);
  }

  async saveIfCurrentStateIs(deal: Deal, expectedState: DealState): Promise<boolean> {
    if (this.persistedStates.get(deal.id) !== expectedState) {
      return false;
    }
    this.deals.set(deal.id, deal);
    this.persistedStates.set(deal.id, deal.state);
    return true;
  }

  async findById(id: DealId): Promise<Deal | null> {
    return this.deals.get(id) ?? null;
  }

  async findByTicketChannelId(channelId: string): Promise<Deal | null> {
    for (const deal of this.deals.values()) {
      if (deal.toProps().ticketChannelId === channelId) return deal;
    }
    return null;
  }

  async findByStates(states: readonly DealState[]): Promise<Deal[]> {
    return [...this.deals.values()].filter((deal) => states.includes(deal.state));
  }

  async countByState(guildId: string): Promise<Record<DealState, number>> {
    const result = Object.fromEntries(DEAL_STATES.map((state) => [state, 0])) as Record<DealState, number>;
    for (const deal of this.deals.values()) {
      if (deal.toProps().guildId === guildId) {
        result[deal.state] += 1;
      }
    }
    return result;
  }
}

export class InMemoryWalletRepository implements IWalletRepository {
  private readonly wallets = new Map<string, Wallet>();

  async save(wallet: Wallet): Promise<void> {
    this.wallets.set(wallet.id, wallet);
  }

  async findById(id: WalletId): Promise<Wallet | null> {
    return this.wallets.get(id) ?? null;
  }

  async findByDealId(dealId: DealId): Promise<Wallet | null> {
    for (const wallet of this.wallets.values()) {
      if (wallet.dealId === dealId) return wallet;
    }
    return null;
  }
}

function transactionNaturalKey(dealId: DealId, txid: TxId, direction: TransactionDirection): string {
  return `${dealId}|${txid}|${direction}`;
}

export class InMemoryTransactionRepository implements ITransactionRepository {
  // Keyed by the real natural key (dealId, txid, direction), matching the
  // Prisma schema's @@unique — NOT by the synthetic `id`, which
  // ExecutePayoutUseCase generates fresh on every call including retries.
  // Keying by `id` here would silently accept a save() that a real database
  // would reject with a unique-constraint violation.
  private readonly transactions = new Map<string, Transaction>();

  async save(transaction: Transaction): Promise<void> {
    this.transactions.set(
      transactionNaturalKey(transaction.dealId, transaction.txid, transaction.direction),
      transaction,
    );
  }

  async findById(id: TransactionId): Promise<Transaction | null> {
    for (const tx of this.transactions.values()) {
      if (tx.id === id) return tx;
    }
    return null;
  }

  async findByDealId(dealId: DealId): Promise<Transaction[]> {
    return [...this.transactions.values()].filter((tx) => tx.dealId === dealId);
  }

  async findByDealAndTxid(
    dealId: DealId,
    txid: TxId,
    direction: TransactionDirection,
  ): Promise<Transaction | null> {
    return this.transactions.get(transactionNaturalKey(dealId, txid, direction)) ?? null;
  }
}

export class InMemoryAuditLogRepository implements IAuditLogRepository {
  private readonly entries: AuditEntry[] = [];

  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }

  async findByDealId(dealId: DealId): Promise<AuditEntry[]> {
    return this.entries.filter((entry) => entry.toProps().dealId === dealId);
  }

  all(): readonly AuditEntry[] {
    return this.entries;
  }
}

export class InMemoryPartyRepository implements IPartyRepository {
  private readonly parties = new Map<string, Party>();

  async save(party: Party): Promise<void> {
    this.parties.set(party.id, party);
  }

  async findByDealId(dealId: DealId): Promise<Party[]> {
    return [...this.parties.values()].filter((party) => party.dealId === dealId);
  }
}

export class InMemoryBackupAccountRepository implements IBackupAccountRepository {
  private readonly records: BackupAccountRecord[] = [];

  async add(ownerDiscordId: string, backupDiscordId: string): Promise<void> {
    if (!this.records.some((r) => r.ownerDiscordId === ownerDiscordId && r.backupDiscordId === backupDiscordId)) {
      this.records.push({ ownerDiscordId, backupDiscordId });
    }
  }

  async remove(ownerDiscordId: string, backupDiscordId: string): Promise<void> {
    const idx = this.records.findIndex(
      (r) => r.ownerDiscordId === ownerDiscordId && r.backupDiscordId === backupDiscordId,
    );
    if (idx !== -1) this.records.splice(idx, 1);
  }

  async findByOwner(ownerDiscordId: string): Promise<BackupAccountRecord[]> {
    return this.records.filter((r) => r.ownerDiscordId === ownerDiscordId);
  }

  async findByBackup(backupDiscordId: string): Promise<BackupAccountRecord[]> {
    return this.records.filter((r) => r.backupDiscordId === backupDiscordId);
  }
}

export class InMemoryDealBackupRepository implements IDealBackupRepository {
  private readonly records = new Map<string, DealBackupRecord>();

  private key(dealId: DealId, role: 'BUYER' | 'SELLER'): string {
    return `${dealId}|${role}`;
  }

  async upsert(record: DealBackupRecord): Promise<void> {
    this.records.set(this.key(record.dealId, record.role), record);
  }

  async remove(dealId: DealId, role: 'BUYER' | 'SELLER'): Promise<void> {
    this.records.delete(this.key(dealId, role));
  }

  async findByDealId(dealId: DealId): Promise<DealBackupRecord[]> {
    return [...this.records.values()].filter((r) => r.dealId === dealId);
  }
}

export class InMemorySavedPayoutAddressRepository implements ISavedPayoutAddressRepository {
  private readonly addresses = new Map<string, string>();

  private key(discordUserId: string, currency: Currency): string {
    return `${discordUserId}|${currency}`;
  }

  async save(discordUserId: string, currency: Currency, address: string): Promise<void> {
    this.addresses.set(this.key(discordUserId, currency), address);
  }

  async find(discordUserId: string, currency: Currency): Promise<string | null> {
    return this.addresses.get(this.key(discordUserId, currency)) ?? null;
  }
}
