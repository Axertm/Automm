type Brand<T, B extends string> = T & { readonly __brand: B };

export type DealId = Brand<string, 'DealId'>;
export type WalletId = Brand<string, 'WalletId'>;
export type TransactionId = Brand<string, 'TransactionId'>;
export type PartyId = Brand<string, 'PartyId'>;
export type TxId = Brand<string, 'TxId'>;

export function asDealId(value: string): DealId {
  return value as DealId;
}

export function asWalletId(value: string): WalletId {
  return value as WalletId;
}

export function asTransactionId(value: string): TransactionId {
  return value as TransactionId;
}

export function asPartyId(value: string): PartyId {
  return value as PartyId;
}

export function asTxId(value: string): TxId {
  return value as TxId;
}
