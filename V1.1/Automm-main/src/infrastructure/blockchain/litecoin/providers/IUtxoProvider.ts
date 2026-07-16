export interface UtxoProviderTransaction {
  txid: string;
  amountLitoshi: bigint;
  confirmations: number;
  blockTime: number | null;
}

export interface Utxo {
  txid: string;
  vout: number;
  valueLitoshi: bigint;
  confirmations: number;
  scriptPubKeyHex: string;
}

/**
 * Narrow port for a single UTXO data provider (BlockCypher, Blockchair).
 * FailoverUtxoProvider composes two of these behind one IUtxoProvider-shaped
 * facade with retry/backoff/failover/caching — callers never see the
 * individual providers.
 */
export interface IUtxoProvider {
  readonly name: string;
  getAddressTransactions(address: string): Promise<UtxoProviderTransaction[]>;
  getUtxos(address: string): Promise<Utxo[]>;
  getFeeEstimateSatPerVByte(): Promise<number>;
  broadcastRawTransaction(txHex: string): Promise<string>;
  getTransactionConfirmations(txid: string): Promise<number>;
  /** A definitive existence check, distinct from getTransactionConfirmations: must resolve `false` on a clean "not found" rather than throwing, so callers can tell "doesn't exist" apart from "provider couldn't answer". */
  transactionExists(txid: string): Promise<boolean>;
}
