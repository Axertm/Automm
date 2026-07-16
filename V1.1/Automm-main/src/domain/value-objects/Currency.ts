export const CURRENCIES = ['LTC', 'SOL'] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface CurrencyMetadata {
  readonly decimals: number;
  readonly smallestUnitName: string;
  readonly symbol: string;
}

const METADATA: Record<Currency, CurrencyMetadata> = {
  LTC: { decimals: 8, smallestUnitName: 'litoshi', symbol: 'LTC' },
  SOL: { decimals: 9, smallestUnitName: 'lamport', symbol: 'SOL' },
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
