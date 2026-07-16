import type { Currency } from '../value-objects/Currency.js';
import type { DealId, WalletId } from '../value-objects/EntityId.js';

export interface EncryptedBlob {
  readonly iv: string;
  readonly authTag: string;
  readonly ciphertext: string;
  readonly keyVersion: number;
}

export interface WalletProps {
  id: WalletId;
  dealId: DealId;
  currency: Currency;
  address: string;
  encryptedPrivateKey: EncryptedBlob;
  derivationPath: string | null;
  createdAt: Date;
}

/**
 * A deposit wallet, generated fresh for exactly one deal and never reused.
 * The decrypted private key never lives on this entity — only the opaque
 * encrypted blob does. Decryption happens transiently in infrastructure,
 * immediately before signing, and nowhere else.
 */
export class Wallet {
  private constructor(private readonly props: WalletProps) {}

  static create(props: WalletProps): Wallet {
    return new Wallet(props);
  }

  get id(): WalletId {
    return this.props.id;
  }

  get dealId(): DealId {
    return this.props.dealId;
  }

  get currency(): Currency {
    return this.props.currency;
  }

  get address(): string {
    return this.props.address;
  }

  get encryptedPrivateKey(): EncryptedBlob {
    return this.props.encryptedPrivateKey;
  }

  get derivationPath(): string | null {
    return this.props.derivationPath;
  }

  toProps(): Readonly<WalletProps> {
    return { ...this.props };
  }
}
