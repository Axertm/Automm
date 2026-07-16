import { describe, expect, it } from 'vitest';
import { Address, isValidAddress } from '../../../src/domain/value-objects/Address.js';

describe('Address', () => {
  it('validates a real LTC P2PKH mainnet address', () => {
    expect(isValidAddress('LTC', 'LUZeuR2a3erentvW6B48dGTQt87NNRHSJo')).toBe(true);
  });

  it('validates a real LTC bech32 mainnet address', () => {
    expect(isValidAddress('LTC', 'ltc1qvee0vzxmw43yer44jse3u0qkylkftk7w5x8esm')).toBe(true);
  });

  it('rejects a Bitcoin address as an LTC address', () => {
    expect(isValidAddress('LTC', '16NJyhjw4WNSnmgmEPTsYsEcCLrEaRHwzD')).toBe(false);
  });

  it('rejects garbage as an LTC address', () => {
    expect(isValidAddress('LTC', 'not-an-address')).toBe(false);
  });

  it('validates a real SOL base58 address', () => {
    expect(isValidAddress('SOL', '11111111111111111111111111111112')).toBe(true);
  });

  it('rejects garbage as a SOL address', () => {
    expect(isValidAddress('SOL', 'not-an-address')).toBe(false);
    expect(isValidAddress('SOL', '0x1234')).toBe(false);
  });

  it('rejects an empty string for either currency', () => {
    expect(isValidAddress('LTC', '')).toBe(false);
    expect(isValidAddress('SOL', '   ')).toBe(false);
  });

  it('Address.create throws on an invalid address and succeeds on a valid one', () => {
    expect(() => Address.create('LTC', 'garbage')).toThrow();
    const addr = Address.create('SOL', '11111111111111111111111111111112');
    expect(addr.toString()).toBe('11111111111111111111111111111112');
  });
});
