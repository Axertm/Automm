import { PermanentProviderError } from '../../../rate-limit/retryWithBackoff.js';
import type { IUtxoProvider, Utxo, UtxoProviderTransaction } from './IUtxoProvider.js';

const BASE_URL = 'https://api.blockcypher.com/v1/ltc/main';

interface BlockCypherTxRef {
  tx_hash: string;
  value: number;
  confirmations: number;
  confirmed?: string;
}

interface BlockCypherAddressResponse {
  txrefs?: BlockCypherTxRef[];
  unconfirmed_txrefs?: BlockCypherTxRef[];
}

interface BlockCypherChainInfo {
  medium_fee_per_kb: number;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (response.status === 429 || response.status >= 500) {
    throw new Error(`BlockCypher transient error: HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new PermanentProviderError(`BlockCypher permanent error: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

/** BlockCypher free-tier UTXO provider for Litecoin mainnet. */
export class BlockCypherProvider implements IUtxoProvider {
  readonly name = 'blockcypher';

  constructor(private readonly apiToken: string) {}

  private withToken(url: string): string {
    if (!this.apiToken) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}token=${encodeURIComponent(this.apiToken)}`;
  }

  async getAddressTransactions(address: string): Promise<UtxoProviderTransaction[]> {
    const data = await fetchJson<BlockCypherAddressResponse>(
      this.withToken(`${BASE_URL}/addrs/${address}?limit=200&confirmations=0`),
    );
    const refs = [...(data.txrefs ?? []), ...(data.unconfirmed_txrefs ?? [])];
    return refs
      .filter((ref) => ref.value > 0)
      .map((ref) => ({
        txid: ref.tx_hash,
        amountLitoshi: BigInt(ref.value),
        confirmations: ref.confirmations,
        blockTime: ref.confirmed ? Math.floor(new Date(ref.confirmed).getTime() / 1000) : null,
      }));
  }

  async getUtxos(address: string): Promise<Utxo[]> {
    const data = await fetchJson<BlockCypherAddressResponse>(
      this.withToken(`${BASE_URL}/addrs/${address}?unspentOnly=true&includeScript=true&limit=200`),
    );
    const refs = data.txrefs ?? [];
    return refs.map((ref) => ({
      txid: ref.tx_hash,
      vout: (ref as unknown as { tx_output_n: number }).tx_output_n,
      valueLitoshi: BigInt(ref.value),
      confirmations: ref.confirmations,
      scriptPubKeyHex: (ref as unknown as { script?: string }).script ?? '',
    }));
  }

  async getFeeEstimateSatPerVByte(): Promise<number> {
    const data = await fetchJson<BlockCypherChainInfo>(this.withToken(BASE_URL));
    return Math.max(1, Math.round(data.medium_fee_per_kb / 1000));
  }

  async broadcastRawTransaction(txHex: string): Promise<string> {
    const response = await fetch(this.withToken(`${BASE_URL}/txs/push`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tx: txHex }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`BlockCypher broadcast failed: HTTP ${response.status} ${body}`);
    }
    const data = (await response.json()) as { tx: { hash: string } };
    return data.tx.hash;
  }

  async getTransactionConfirmations(txid: string): Promise<number> {
    const data = await fetchJson<{ confirmations: number }>(this.withToken(`${BASE_URL}/txs/${txid}`));
    return data.confirmations;
  }

  async transactionExists(txid: string): Promise<boolean> {
    const response = await fetch(this.withToken(`${BASE_URL}/txs/${txid}`));
    // A clean 404 is a definitive "this transaction does not exist" answer —
    // distinct from a transient/permanent error, which means the provider
    // couldn't answer at all (see LitecoinService.verifyBroadcast).
    if (response.status === 404) return false;
    if (response.status === 429 || response.status >= 500) {
      throw new Error(`BlockCypher transient error: HTTP ${response.status}`);
    }
    if (!response.ok) {
      throw new PermanentProviderError(`BlockCypher permanent error: HTTP ${response.status}`);
    }
    return true;
  }
}
