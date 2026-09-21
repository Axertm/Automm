import { mkdirSync, writeFileSync, unlinkSync, renameSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Logger } from 'pino';
import { Deal, type DealProps } from '../../../domain/entities/Deal.js';
import { Wallet, type WalletProps } from '../../../domain/entities/Wallet.js';
import { Money } from '../../../domain/value-objects/Money.js';
import { assertCurrency } from '../../../domain/value-objects/Currency.js';
import { assertDealState } from '../../../domain/state-machine/DealState.js';
import { asDealId, asWalletId } from '../../../domain/value-objects/EntityId.js';

const TERMINAL_STATES: ReadonlySet<string> = new Set(['COMPLETED', 'REFUNDED', 'CANCELLED']);

/**
 * A second, independent, on-disk copy of every non-terminal deal and its
 * wallet — plain JSON files, written on every save alongside the primary
 * Prisma/SQL persistence. Exists because a test run once wiped the exact
 * SQLite file a live bot instance was using (test and dev shared
 * DATABASE_URL — now fixed separately, see package.json), turning a real
 * deposit's private key permanently unrecoverable. This is the safety net
 * so that scenario is recoverable next time via `npm run restore:backup`
 * instead of unrecoverable: even if the database is destroyed outright,
 * every active deal + wallet still exists as a file on local disk.
 *
 * Entries are deleted once a deal reaches a terminal state (COMPLETED /
 * REFUNDED / CANCELLED) — by then funds have already moved (or a wallet was
 * never funded), so the backup is no longer protecting anything live.
 *
 * Writes are atomic (write to a .tmp file, then rename) so a crash mid-write
 * never leaves a half-written, corrupt backup file.
 */
export class JsonBackupStore {
  private readonly dealsDir: string;
  private readonly walletsDir: string;

  constructor(
    baseDir: string,
    private readonly logger: Logger,
  ) {
    this.dealsDir = path.join(baseDir, 'deals');
    this.walletsDir = path.join(baseDir, 'wallets');
    mkdirSync(this.dealsDir, { recursive: true });
    mkdirSync(this.walletsDir, { recursive: true });
  }

  saveDeal(deal: Deal): void {
    const props = deal.toProps();
    if (TERMINAL_STATES.has(props.state)) {
      this.deleteDeal(props.id);
      this.deleteWallet(props.id);
      return;
    }
    this.writeAtomic(this.dealPath(props.id), serializeDealProps(props), 'deal', props.id);
  }

  saveWallet(wallet: Wallet): void {
    const props = wallet.toProps();
    this.writeAtomic(this.walletPath(props.dealId), serializeWalletProps(props), 'wallet', props.dealId);
  }

  deleteDeal(dealId: string): void {
    this.safeUnlink(this.dealPath(dealId));
  }

  deleteWallet(dealId: string): void {
    this.safeUnlink(this.walletPath(dealId));
  }

  /** Used by the restore script — every backed-up deal, reconstructed as a domain entity. */
  loadAllDeals(): Deal[] {
    return this.loadAll(this.dealsDir, (raw) => Deal.create(deserializeDealProps(raw)));
  }

  /** Used by the restore script — every backed-up wallet, reconstructed as a domain entity. */
  loadAllWallets(): Wallet[] {
    return this.loadAll(this.walletsDir, (raw) => Wallet.create(deserializeWalletProps(raw)));
  }

  private loadAll<T>(dir: string, parse: (raw: unknown) => T): T[] {
    const results: T[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        results.push(parse(JSON.parse(readFileSync(path.join(dir, file), 'utf8'))));
      } catch (error) {
        this.logger.error({ file, err: (error as Error).message }, 'backup_file_unreadable');
      }
    }
    return results;
  }

  private dealPath(dealId: string): string {
    return path.join(this.dealsDir, `${dealId}.json`);
  }

  private walletPath(dealId: string): string {
    return path.join(this.walletsDir, `${dealId}.json`);
  }

  private writeAtomic(filePath: string, data: unknown, kind: 'deal' | 'wallet', id: string): void {
    try {
      const tmpPath = `${filePath}.${process.pid}.tmp`;
      writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      renameSync(tmpPath, filePath);
    } catch (error) {
      // Never let a backup failure break the real save — the primary DB
      // write already succeeded by the time this runs (see the decorator
      // repositories); this is defense-in-depth, not the source of truth.
      this.logger.error({ kind, id, err: (error as Error).message }, 'backup_write_failed');
    }
  }

  private safeUnlink(filePath: string): void {
    try {
      unlinkSync(filePath);
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') {
        this.logger.warn({ filePath, err: (error as Error).message }, 'backup_delete_failed');
      }
    }
  }
}

function serializeDealProps(props: Readonly<DealProps>) {
  return {
    ...props,
    expectedAmount: {
      currency: props.expectedAmount.currency,
      decimal: props.expectedAmount.toDecimalString(),
    },
  };
}

function deserializeDealProps(raw: unknown): DealProps {
  const r = raw as Record<string, unknown> & {
    expectedAmount: { currency: string; decimal: string };
  };
  const currency = assertCurrency(r.expectedAmount.currency);
  return {
    ...(r as unknown as DealProps),
    id: asDealId(r.id as string),
    currency: assertCurrency(r.currency as string),
    state: assertDealState(r.state as string),
    expectedAmount: Money.fromDecimalString(currency, r.expectedAmount.decimal),
    createdAt: new Date(r.createdAt as string),
    updatedAt: new Date(r.updatedAt as string),
    fundedAt: r.fundedAt ? new Date(r.fundedAt as string) : null,
    completedAt: r.completedAt ? new Date(r.completedAt as string) : null,
  };
}

function serializeWalletProps(props: Readonly<WalletProps>) {
  return { ...props };
}

function deserializeWalletProps(raw: unknown): WalletProps {
  const r = raw as Record<string, unknown>;
  return {
    ...(r as unknown as WalletProps),
    id: asWalletId(r.id as string),
    dealId: asDealId(r.dealId as string),
    currency: assertCurrency(r.currency as string),
    createdAt: new Date(r.createdAt as string),
  };
}
