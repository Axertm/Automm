import { Connection, type ConnectionConfig } from '@solana/web3.js';
import type { Logger } from 'pino';
import { retryWithBackoff } from '../../rate-limit/retryWithBackoff.js';
import type { ISolanaRpcClient } from './ISolanaRpcClient.js';

const CONNECTION_CONFIG: ConnectionConfig = { commitment: 'confirmed' };

/**
 * Thin wrapper around @solana/web3.js Connection. Solana only has one
 * provider *type* (RPC endpoints are interchangeable, unlike BlockCypher vs
 * Blockchair's differing response shapes), so this uses the same
 * retry-with-backoff wrapper as Litecoin but a simpler primary/fallback
 * "try the other URL" shape rather than a distinct failover class.
 */
export class SolanaRpcClient implements ISolanaRpcClient {
  private readonly primaryConnection: Connection;
  private readonly fallbackConnection: Connection | null;

  constructor(
    primaryRpcUrl: string,
    fallbackRpcUrl: string | undefined,
    private readonly logger: Logger,
  ) {
    this.primaryConnection = new Connection(primaryRpcUrl, CONNECTION_CONFIG);
    this.fallbackConnection = fallbackRpcUrl ? new Connection(fallbackRpcUrl, CONNECTION_CONFIG) : null;
  }

  async withConnection<T>(operation: string, call: (connection: Connection) => Promise<T>): Promise<T> {
    try {
      return await retryWithBackoff(
        () => call(this.primaryConnection),
        (attempt, error) =>
          this.logger.warn({ operation, attempt, err: (error as Error).message }, 'sol_rpc_retry'),
      );
    } catch (primaryError) {
      if (!this.fallbackConnection) {
        throw primaryError;
      }
      this.logger.warn({ operation, err: (primaryError as Error).message }, 'sol_rpc_failover');
      return retryWithBackoff(
        () => call(this.fallbackConnection!),
        (attempt, error) =>
          this.logger.warn({ operation, attempt, err: (error as Error).message }, 'sol_rpc_retry_fallback'),
      );
    }
  }
}
