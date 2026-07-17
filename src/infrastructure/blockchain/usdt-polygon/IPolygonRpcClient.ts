import type { JsonRpcProvider } from 'ethers';

/** Extracted as an interface purely for unit-testability of UsdtPolygonService. */
export interface IPolygonRpcClient {
  withProvider<T>(operation: string, call: (provider: JsonRpcProvider) => Promise<T>): Promise<T>;
}
