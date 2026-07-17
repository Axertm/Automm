export const CURRENCIES = ['LTC', 'SOL', 'USDT'] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface CurrencyMetadata {
  readonly decimals: number;
  readonly smallestUnitName: string;
  readonly symbol: string;
}

const METADATA: Record<Currency, CurrencyMetadata> = {
  LTC: { decimals: 8, smallestUnitName: 'litoshi', symbol: 'LTC' },
  SOL: { decimals: 9, smallestUnitName: 'lamport', symbol: 'SOL' },
  // USDT on Polygon (the bridged PoS token, contract 0xc2132D...) — 6 decimals, same as every other USDT deployment.
  USDT: { decimals: 6, smallestUnitName: 'micro-USDT', symbol: 'USDT' },
};

export function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

export function assertCurrency(value: string): Currency {
  if (!isCurrency(value)) {
    throw new Error(`Invalid currency: ${value}`);
  }
  return value;
}

export function currencyMetadata(currency: Currency): CurrencyMetadata {
  return METADATA[currency];
}
