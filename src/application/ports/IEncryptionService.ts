import type { EncryptedBlob } from '../../domain/entities/Wallet.js';

export interface IEncryptionService {
  encrypt(plaintext: Buffer): EncryptedBlob;
  /**
   * Decrypts and returns the plaintext. Callers MUST treat the returned
   * buffer as transient: use it immediately (e.g. to sign a transaction)
   * and zero it in a `finally` block — never store or log it.
   */
  decrypt(blob: EncryptedBlob): Buffer;
}
