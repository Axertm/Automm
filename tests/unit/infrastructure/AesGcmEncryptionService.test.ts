import { describe, expect, it } from 'vitest';
import { AesGcmEncryptionService } from '../../../src/infrastructure/security/AesGcmEncryptionService.js';

const KEY = 'a'.repeat(64); // 32 bytes hex

describe('AesGcmEncryptionService', () => {
  it('round-trips plaintext through encrypt/decrypt', () => {
    const service = new AesGcmEncryptionService(KEY);
    const plaintext = Buffer.from('super-secret-private-key-material');

    const blob = service.encrypt(plaintext);
    const decrypted = service.decrypt(blob);

    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it('produces a different ciphertext and IV on every call (fresh random IV)', () => {
    const service = new AesGcmEncryptionService(KEY);
    const plaintext = Buffer.from('same input twice');

    const blobA = service.encrypt(plaintext);
    const blobB = service.encrypt(plaintext);

    expect(blobA.iv).not.toBe(blobB.iv);
    expect(blobA.ciphertext).not.toBe(blobB.ciphertext);
  });

  it('rejects a tampered ciphertext (GCM auth tag mismatch)', () => {
    const service = new AesGcmEncryptionService(KEY);
    const blob = service.encrypt(Buffer.from('private key'));

    const tamperedCiphertext = Buffer.from(blob.ciphertext, 'base64');
    tamperedCiphertext[0] = tamperedCiphertext[0]! ^ 0xff;

    expect(() => service.decrypt({ ...blob, ciphertext: tamperedCiphertext.toString('base64') })).toThrow();
  });

  it('rejects a tampered auth tag', () => {
    const service = new AesGcmEncryptionService(KEY);
    const blob = service.encrypt(Buffer.from('private key'));

    const tamperedTag = Buffer.from(blob.authTag, 'base64');
    tamperedTag[0] = tamperedTag[0]! ^ 0xff;

    expect(() => service.decrypt({ ...blob, authTag: tamperedTag.toString('base64') })).toThrow();
  });

  it('cannot decrypt with a different key', () => {
    const serviceA = new AesGcmEncryptionService(KEY);
    const serviceB = new AesGcmEncryptionService('b'.repeat(64));
    const blob = serviceA.encrypt(Buffer.from('private key'));

    expect(() => serviceB.decrypt(blob)).toThrow();
  });

  it('rejects a master key that is not exactly 32 bytes', () => {
    expect(() => new AesGcmEncryptionService('ab')).toThrow();
    expect(() => new AesGcmEncryptionService('a'.repeat(62))).toThrow();
  });

  it('rejects an unsupported key version on decrypt', () => {
    const service = new AesGcmEncryptionService(KEY);
    const blob = service.encrypt(Buffer.from('data'));
    expect(() => service.decrypt({ ...blob, keyVersion: 99 })).toThrow();
  });
});
