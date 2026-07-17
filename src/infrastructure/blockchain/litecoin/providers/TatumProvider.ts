import { PermanentProviderError } from '../../../rate-limit/retryWithBackoff.js';
import type { IUtxoProvider, Utxo, UtxoProviderTransaction } from './IUtxoProvider.js';

const V3_BASE_URL = 'https://api.tatum.io/v3/litecoin';
const V4_BASE_URL = 'https://api.tatum.io/v4/data';

// Tatum has no way to ask for "every UTXO" directly — /v4/data/utxos returns
// unspent outputs up to a requested totalValue. Deal wallets never hold more
// than a modest escrow amount, so a very large ceiling is functionally
// "all of them" without needing pagination.
const UTXO_TOTAL_VALUE_CEILING = '100000000';

interface TatumErrorBody {
  statusCode?: number;
  errorCode?: string;
  message?: string;
}

interface TatumTxOutput {
  value: string;
  script: string;
  address: string;
}

interface TatumTx {
  hash: string;
  blockNumber: number | null;
  time: number;
  outputs: TatumTxOutput[];
}

interface TatumInfo {
  blocks: number;
}

interface TatumFeeEstimate {
  medium: number;
}

interface TatumUtxoEntry {
  txHash: string;
  index: number;
  valueAsString: string;
}

/** Converts a decimal LTC amount string (e.g. "0.00131592") to litoshi without floating-point error. */
function ltcToLitoshi(decimal: string): bigint {
  const [wholePart = '0', fractionPart = ''] = decimal.split('.');
  const fraction = (fractionPart + '00000000').slice(0, 8);
  return BigInt(wholePart) * 100_000_000n + BigInt(fraction || '0');
}

// Tatum's mempool-transaction "time" field is milliseconds; its mined-block
// "time" field is seconds. There's no separate flag to tell them apart, so
// magnitude is the only signal (a millisecond Unix timestamp is always > 1e12
// for any date in this era, a second timestamp never is).
function normalizeUnixSeconds(time: number): number {
  return time > 1e12 ? Math.floor(time / 1000) : Math.floor(time);
}

async function fetchJson<T>(url: string, apiKey: string): Promise<T> {
  const response = await fetch(url, { headers: { 'x-api-key': apiKey } });
  if (response.status === 429 || response.status >= 500) {
    throw new Error(`Tatum transient error: HTTP ${response.status}`);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as TatumErrorBody | null;
    throw new PermanentProviderError(
      `Tatum permanent error: HTTP ${response.status} ${body?.errorCode ?? ''} ${body?.message ?? ''}`.trim(),
    );
  }
  return (await response.json()) as T;
}

/** Tatum UTXO/data-API provider for Litecoin mainnet (free-tier: 3 req/s, shared across all endpoints). */
export class TatumProvider implements IUtxoProvider {
  readonly name = 'tatum';

  constructor(private readonly apiKey: string) {}

  private async getCurrentBlockHeight(): Promise<number> {
    const info = await fetchJson<TatumInfo>(`${V3_BASE_URL}/info`, this.apiKey);
    return info.blocks;
  }

  private async getRawTransaction(txid: string): Promise<TatumTx> {
    return fetchJson<TatumTx>(`${V3_BASE_URL}/transaction/${txid}`, this.apiKey);
  }

  async getAddressTransactions(address: string): Promise<UtxoProviderTransaction[]> {
    const [txs, currentHeight] = await Promise.all([
      fetchJson<TatumTx[]>(`${V3_BASE_URL}/transaction/address/${address}?pageSize=50`, this.apiKey),
      this.getCurrentBlockHeight(),
    ]);
    return txs
      .map((tx) => {
        const amountLitoshi = tx.outputs
          .filter((output) => output.address === address)
          .reduce((sum, output) => sum + ltcToLitoshi(output.value), 0n);
        const confirmations =
          tx.blockNumber === null ? 0 : Math.max(0, currentHeight - tx.blockNumber + 1);
        return {
          txid: tx.hash,
          amountLitoshi,
          confirmations,
          blockTime: tx.time === undefined || tx.time === null ? null : normalizeUnixSeconds(tx.time),
        };
      })
      .filter((tx) => tx.amountLitoshi > 0n);
  }

  async getUtxos(address: string): Promise<Utxo[]> {
    const entries = await fetchJson<TatumUtxoEntry[]>(
      `${V4_BASE_URL}/utxos?chain=litecoin-mainnet&address=${address}&totalValue=${UTXO_TOTAL_VALUE_CEILING}`,
      this.apiKey,
    );
    if (entries.length === 0) return [];

    // scriptPubKeyHex isn't included on the v4 UTXO list — cross-referenced
    // from the owning transaction's outputs, one lookup per unique txid.
    const uniqueTxids = [...new Set(entries.map((e) => e.txHash))];
    const txs = new Map(
      await Promise.all(uniqueTxids.map(async (txid) => [txid, await this.getRawTransaction(txid)] as const)),
    );

    return entries.map((entry) => {
      const tx = txs.get(entry.txHash);
      const output = tx?.outputs[entry.index];
      return {
        txid: entry.txHash,
        vout: entry.index,
        valueLitoshi: ltcToLitoshi(entry.valueAsString),
        // Not consumed by LitecoinService today — a coarse "seen mined at all"
        // flag is sufficient (mirrors the conservative floor other providers use).
        confirmations: tx === undefined || tx.blockNumber === null ? 0 : 1,
        scriptPubKeyHex: output?.script ?? '',
      };
    });
  }

  async getFeeEstimateSatPerVByte(): Promise<number> {
    const data = await fetchJson<TatumFeeEstimate>(`https://api.tatum.io/v3/blockchain/fee/LTC`, this.apiKey);
    return Math.max(1, Math.round(data.medium));
  }

  async broadcastRawTransaction(txHex: string): Promise<string> {
    const response = await fetch(`${V3_BASE_URL}/broadcast`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey },
      body: JSON.stringify({ txData: txHex }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Tatum broadcast failed: HTTP ${response.status} ${body}`);
    }
    const data = (await response.json()) as { txId?: string; tx_id?: string };
    const txid = data.txId ?? data.tx_id;
    if (!txid) {
      throw new Error(`Tatum broadcast succeeded but returned no transaction id: ${JSON.stringify(data)}`);
    }
    return txid;
  }

  async getTransactionConfirmations(txid: string): Promise<number> {
    const [tx, currentHeight] = await Promise.all([this.getRawTransaction(txid), this.getCurrentBlockHeight()]);
    if (tx.blockNumber === null) return 0;
    return Math.max(0, currentHeight - tx.blockNumber + 1);
  }

  async transactionExists(txid: string): Promise<boolean> {
    const response = await fetch(`${V3_BASE_URL}/transaction/${txid}`, {
      headers: { 'x-api-key': this.apiKey },
    });
    if (response.ok) return true;
    // Tatum answers "not found" with a non-standard 403 + a specific
    // errorCode rather than a plain 404 — a definitive "does not exist" is
    // distinct from a transient/permanent error, which means the provider
    // couldn't answer at all (see LitecoinService.verifyBroadcast).
    const body = (await response.json().catch(() => null)) as TatumErrorBody | null;
    if (body?.errorCode === 'ltc.tx.not.found') return false;
    if (response.status === 429 || response.status >= 500) {
      throw new Error(`Tatum transient error: HTTP ${response.status}`);
    }
    throw new PermanentProviderError(
      `Tatum permanent error: HTTP ${response.status} ${body?.errorCode ?? ''} ${body?.message ?? ''}`.trim(),
    );
  }
}
