import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { IEncryptionService } from '../../application/ports/IEncryptionService.js';
import type { EncryptedBlob } from '../../domain/entities/Wallet.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const CURRENT_KEY_VERSION = 1;

/**
 * AES-256-GCM encryption for private key material at rest. Encrypts with a
 * fresh random IV every call. Decryption is designed to be used transiently
 * — see IEncryptionService's contract: callers must zero the returned
 * buffer immediately after use.
 */
export class AesGcmEncryptionService implements IEncryptionService {
  private readonly key: Buffer;

  constructor(masterKeyHex: string) {
    const key = Buffer.from(masterKeyHex, 'hex');
    if (key.length !== 32) {
      throw new Error(`Encryption master key must decode to 32 bytes, got ${key.length}`);
    }
    this.key = key;
  }

  encrypt(plaintext: Buffer): EncryptedBlob {
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      keyVersion: CURRENT_KEY_VERSION,
    };
  }

  decrypt(blob: EncryptedBlob): Buffer {
    if (blob.keyVersion !== CURRENT_KEY_VERSION) {
      throw new Error(`Unsupported encryption key version: ${blob.keyVersion}`);
    }
    const iv = Buffer.from(blob.iv, 'base64');
    const authTag = Buffer.from(blob.authTag, 'base64');
    const ciphertext = Buffer.from(blob.ciphertext, 'base64');
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    // Throws if the ciphertext or auth tag was tampered with.
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}
