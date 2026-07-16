import { PermanentProviderError } from '../../../rate-limit/retryWithBackoff.js';
import type { IUtxoProvider, Utxo, UtxoProviderTransaction } from './IUtxoProvider.js';

const BASE_URL = 'https://api.blockchair.com/litecoin';

interface BlockchairUtxo {
  transaction_hash: string;
  index: number;
  value: number;
}

interface BlockchairAddressDashboard {
  data: Record<
    string,
    {
      transactions: string[];
      utxo: BlockchairUtxo[];
    }
  >;
}

interface BlockchairTxInfo {
  data: Record<string, { transaction: { block_id: number; time: string } }>;
  context: { state: number };
}

interface BlockchairStats {
  data: { suggested_transaction_fee_per_byte_sat: number };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  // 430 is Blockchair's own non-standard "too many requests" status (their
  // equivalent of 429) — must be retried like any other rate limit, not
  // treated as a permanent client error that skips retries entirely.
  if (response.status === 429 || response.status === 430 || response.status >= 500) {
    throw new Error(`Blockchair transient error: HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new PermanentProviderError(`Blockchair permanent error: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

/** Blockchair free-tier UTXO provider for Litecoin mainnet — the failover partner for BlockCypher. */
export class BlockchairProvider implements IUtxoProvider {
  readonly name = 'blockchair';

  constructor(private readonly apiKey: string) {}

  private withKey(url: string): string {
    if (!this.apiKey) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}key=${encodeURIComponent(this.apiKey)}`;
  }

  async getAddressTransactions(address: string): Promise<UtxoProviderTransaction[]> {
    const data = await fetchJson<BlockchairAddressDashboard>(
      this.withKey(`${BASE_URL}/dashboards/address/${address}?limit=100`),
    );
    const entry = data.data[address];
    if (!entry) return [];
    const utxos = await this.getUtxos(address);
    const utxoByTxid = new Map(utxos.map((u) => [u.txid, u]));
    return entry.transactions.map((txid) => {
      const utxo = utxoByTxid.get(txid);
      return {
        txid,
        amountLitoshi: utxo?.valueLitoshi ?? 0n,
        confirmations: utxo?.confirmations ?? 0,
        blockTime: null,
      };
    });
  }

  async getUtxos(address: string): Promise<Utxo[]> {
    const data = await fetchJson<BlockchairAddressDashboard>(
      this.withKey(`${BASE_URL}/dashboards/address/${address}?limit=100`),
    );
    const entry = data.data[address];
    if (!entry) return [];
    return entry.utxo.map((u) => ({
      txid: u.transaction_hash,
      vout: u.index,
      valueLitoshi: BigInt(u.value),
      confirmations: 0,
      scriptPubKeyHex: '',
    }));
  }

  async getFeeEstimateSatPerVByte(): Promise<number> {
    const data = await fetchJson<BlockchairStats>(this.withKey(`${BASE_URL}/stats`));
    return Math.max(1, data.data.suggested_transaction_fee_per_byte_sat);
  }

  async broadcastRawTransaction(txHex: string): Promise<string> {
    const response = await fetch(this.withKey(`${BASE_URL}/push/transaction`), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(txHex)}`,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Blockchair broadcast failed: HTTP ${response.status} ${body}`);
    }
    const data = (await response.json()) as { data: { transaction_hash: string } };
    return data.data.transaction_hash;
  }

  async getTransactionConfirmations(txid: string): Promise<number> {
    const data = await fetchJson<BlockchairTxInfo>(
      this.withKey(`${BASE_URL}/dashboards/transaction/${txid}`),
    );
    const entry = data.data[txid];
    if (!entry || entry.transaction.block_id <= 0) return 0;
    // Blockchair's dashboard endpoint doesn't return confirmation count
    // directly; treating "mined into a block" as at least 1 confirmation is
    // a conservative floor — getRequiredConfirmations() callers should
    // prefer BlockCypher's precise count when it is available (i.e. this
    // path is only hit when BlockCypher has already failed over).
    return entry.transaction.block_id > 0 ? 1 : 0;
  }

  async transactionExists(txid: string): Promise<boolean> {
    const data = await fetchJson<BlockchairTxInfo>(
      this.withKey(`${BASE_URL}/dashboards/transaction/${txid}`),
    );
    return Boolean(data.data[txid]);
  }
}
