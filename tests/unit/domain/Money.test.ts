import { describe, expect, it } from 'vitest';
import { Money } from '../../../src/domain/value-objects/Money.js';

describe('Money', () => {
  it('parses and round-trips a decimal string for LTC (8 decimals)', () => {
    const money = Money.fromDecimalString('LTC', '1.5');
    expect(money.smallestUnits).toBe(150_000_000n);
    expect(money.toDecimalString()).toBe('1.5');
  });

  it('parses and round-trips a decimal string for SOL (9 decimals)', () => {
    const money = Money.fromDecimalString('SOL', '0.000000001');
    expect(money.smallestUnits).toBe(1n);
    expect(money.toDecimalString()).toBe('0.000000001');
  });

  it('rejects more decimal places than the currency supports', () => {
    expect(() => Money.fromDecimalString('LTC', '1.123456789')).toThrow();
  });

  it('rejects negative or malformed input', () => {
    expect(() => Money.fromDecimalString('LTC', '-1')).toThrow();
    expect(() => Money.fromDecimalString('LTC', 'abc')).toThrow();
  });

  it('adds and subtracts within the same currency', () => {
    const a = Money.fromDecimalString('LTC', '2');
    const b = Money.fromDecimalString('LTC', '0.5');
    expect(a.add(b).toDecimalString()).toBe('2.5');
    expect(a.subtract(b).toDecimalString()).toBe('1.5');
  });

  it('throws on cross-currency arithmetic', () => {
    const ltc = Money.fromDecimalString('LTC', '1');
    const sol = Money.fromDecimalString('SOL', '1');
    expect(() => ltc.add(sol)).toThrow();
  });

  it('throws when subtraction would go negative', () => {
    const a = Money.fromDecimalString('LTC', '1');
    const b = Money.fromDecimalString('LTC', '2');
    expect(() => a.subtract(b)).toThrow();
  });

  describe('splitByBasisPoints', () => {
    it('splits an amount so fee + remainder always equals the original exactly', () => {
      const amount = Money.fromDecimalString('LTC', '1.00000001');
      const { fee, remainder } = amount.splitByBasisPoints(250); // 2.5%
      expect(fee.add(remainder).equals(amount)).toBe(true);
    });

    it('handles amounts that do not divide evenly without losing a single smallest unit', () => {
      for (const raw of ['0.00000001', '0.00000003', '1.23456789', '9999.99999999']) {
        const amount = Money.fromDecimalString('LTC', raw);
        const { fee, remainder } = amount.splitByBasisPoints(333);
        expect(fee.add(remainder).equals(amount)).toBe(true);
      }
    });

    it('produces a zero fee at 0 basis points and a zero remainder at 10000', () => {
      const amount = Money.fromDecimalString('SOL', '5');
      expect(amount.splitByBasisPoints(0).fee.isZero()).toBe(true);
      expect(amount.splitByBasisPoints(10_000).remainder.isZero()).toBe(true);
    });

    it('rejects out-of-range basis points', () => {
      const amount = Money.fromDecimalString('LTC', '1');
      expect(() => amount.splitByBasisPoints(-1)).toThrow();
      expect(() => amount.splitByBasisPoints(10_001)).toThrow();
    });
  });

  it('compares amounts correctly', () => {
    const a = Money.fromDecimalString('LTC', '1');
    const b = Money.fromDecimalString('LTC', '2');
    expect(a.isLessThan(b)).toBe(true);
    expect(b.isGreaterThanOrEqual(a)).toBe(true);
    expect(a.equals(Money.fromDecimalString('LTC', '1'))).toBe(true);
  });
});
