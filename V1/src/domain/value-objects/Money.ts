import { z } from 'zod';
import { currencyMetadata, type Currency } from './Currency.js';

const decimalStringSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, 'must be a non-negative decimal number');

/**
 * Currency-aware fixed-point amount. Internally stored as a bigint in the
 * currency's smallest unit (litoshi for LTC, lamport for SOL) so arithmetic
 * never touches floating point.
 */
export class Money {
  private constructor(
    public readonly currency: Currency,
    public readonly smallestUnits: bigint,
  ) {
    if (smallestUnits < 0n) {
      throw new Error('Money amount cannot be negative');
    }
  }

  static zero(currency: Currency): Money {
    return new Money(currency, 0n);
  }

  static fromSmallestUnits(currency: Currency, units: bigint): Money {
    return new Money(currency, units);
  }

  /** Parses a human decimal string, e.g. "1.5" LTC, into smallest units. */
  static fromDecimalString(currency: Currency, value: string): Money {
    const parsed = decimalStringSchema.parse(value);
    const { decimals } = currencyMetadata(currency);
    const [wholePart, fractionPartRaw = ''] = parsed.split('.');
    if (fractionPartRaw.length > decimals) {
      throw new Error(`${currency} supports at most ${decimals} decimal places, got "${value}"`);
    }
    const fractionPart = fractionPartRaw.padEnd(decimals, '0');
    const units = BigInt(wholePart ?? '0') * 10n ** BigInt(decimals) + BigInt(fractionPart || '0');
    return new Money(currency, units);
  }

  toDecimalString(): string {
    const { decimals } = currencyMetadata(this.currency);
    const divisor = 10n ** BigInt(decimals);
    const whole = this.smallestUnits / divisor;
    const fraction = this.smallestUnits % divisor;
    if (decimals === 0) {
      return whole.toString();
    }
    const fractionStr = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
    return fractionStr.length > 0 ? `${whole}.${fractionStr}` : whole.toString();
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new Error(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.currency, this.smallestUnits + other.smallestUnits);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    if (other.smallestUnits > this.smallestUnits) {
      throw new Error('Cannot subtract a larger amount from a smaller one');
    }
    return new Money(this.currency, this.smallestUnits - other.smallestUnits);
  }

  /**
   * Splits this amount into a fee (in basis points, 1 bp = 0.01%) and a
   * remainder, using integer math so fee + remainder always equals the
   * original amount exactly — no rounding leakage.
   */
  splitByBasisPoints(feeBasisPoints: number): { fee: Money; remainder: Money } {
    if (feeBasisPoints < 0 || feeBasisPoints > 10_000) {
      throw new Error('feeBasisPoints must be between 0 and 10000');
    }
    const feeUnits = (this.smallestUnits * BigInt(feeBasisPoints)) / 10_000n;
    const fee = new Money(this.currency, feeUnits);
    const remainder = new Money(this.currency, this.smallestUnits - feeUnits);
    return { fee, remainder };
  }

  isZero(): boolean {
    return this.smallestUnits === 0n;
  }

  isGreaterThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.smallestUnits >= other.smallestUnits;
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.smallestUnits < other.smallestUnits;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.smallestUnits === other.smallestUnits;
  }
}
