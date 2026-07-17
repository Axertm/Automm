import type { Utxo, UtxoProviderTransaction } from './providers/IUtxoProvider.js';

/** The subset of FailoverUtxoProvider's public API that LitecoinService depends on — extracted as an interface purely for unit-testability. */
export interface IFailoverUtxoProvider {
  getAddressTransactions(address: string): Promise<UtxoProviderTransaction[]>;
  getUtxos(address: string): Promise<Utxo[]>;
  getFeeEstimateSatPerVByte(): Promise<number>;
  broadcastRawTransaction(txHex: string): Promise<string>;
  getTransactionConfirmations(txid: string): Promise<number>;
  transactionExists(txid: string): Promise<boolean>;
}
