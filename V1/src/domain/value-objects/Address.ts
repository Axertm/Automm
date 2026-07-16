import * as bitcoin from 'bitcoinjs-lib';
import { PublicKey } from '@solana/web3.js';
import type { Currency } from './Currency.js';

// NOTE: bitcoinjs-lib / @solana/web3.js are pure, I/O-free cryptographic
// libraries used here only for address-format validation (base58check /
// bech32 / ed25519 point checks). Treated as an allowed exception to the
// domain layer's "zero external deps" rule, on the same footing as zod,
// because hand-rolling checksum/curve validation would be a real security
// risk for comparatively little architectural benefit.

const LTC_MAINNET_PARAMS: bitcoin.networks.Network = {
  messagePrefix: '\x19Litecoin Signed Message:\n',
  bech32: 'ltc',
  bip32: { public: 0x019da462, private: 0x019d9cfe },
  pubKeyHash: 0x30,
  scriptHash: 0x32,
  wif: 0xb0,
};

function isValidLitecoinAddress(address: string): boolean {
  try {
    bitcoin.address.toOutputScript(address, LTC_MAINNET_PARAMS);
    return true;
  } catch {
    return false;
  }
}

function isValidSolanaAddress(address: string): boolean {
  try {
    // Throws on malformed base58 or a key not on the ed25519 curve's byte length.
    new PublicKey(address);
    return address.length >= 32 && address.length <= 44;
  } catch {
    return false;
  }
}

export function isValidAddress(currency: Currency, address: string): boolean {
  if (address.trim().length === 0) return false;
  return currency === 'LTC' ? isValidLitecoinAddress(address) : isValidSolanaAddress(address);
}

export class Address {
  private constructor(
    public readonly currency: Currency,
    public readonly value: string,
  ) {}

  static create(currency: Currency, value: string): Address {
    if (!isValidAddress(currency, value)) {
      throw new Error(`Invalid ${currency} address: "${value}"`);
    }
    return new Address(currency, value);
  }

  toString(): string {
    return this.value;
  }

  equals(other: Address): boolean {
    return this.currency === other.currency && this.value === other.value;
  }
}

export { LTC_MAINNET_PARAMS };
