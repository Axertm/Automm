import type { Connection } from '@solana/web3.js';

/** Extracted as an interface purely for unit-testability of SolanaService. */
export interface ISolanaRpcClient {
  withConnection<T>(operation: string, call: (connection: Connection) => Promise<T>): Promise<T>;
}
