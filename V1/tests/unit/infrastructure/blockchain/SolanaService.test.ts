import { describe, expect, it } from 'vitest';
import pino from 'pino';
import type { Connection } from '@solana/web3.js';
import { SolanaService } from '../../../../src/infrastructure/blockchain/solana/SolanaService.js';
import { AesGcmEncryptionService } from '../../../../src/infrastructure/security/AesGcmEncryptionService.js';
import type { ISolanaRpcClient } from '../../../../src/infrastructure/blockchain/solana/ISolanaRpcClient.js';

const silentLogger = pino({ level: 'silent' });

class StubRpcClient implements ISolanaRpcClient {
  balanceLamports = 0;
  signatureStatus: { confirmationStatus: string; confirmations: number | null } | null = null;

  async withConnection<T>(operation: string, call: (connection: Connection) => Promise<T>): Promise<T> {
    const fakeConnection = {
      getBalance: async () => this.balanceLamports,
      getSignaturesForAddress: async () => [],
      getSignatureStatuses: async () => ({ value: [this.signatureStatus] }),
    } as unknown as Connection;
    void operation;
    return call(fakeConnection);
  }
}

function makeService() {
  const rpcClient = new StubRpcClient();
  const encryption = new AesGcmEncryptionService('c'.repeat(64));
  const service = new SolanaService(rpcClient, encryption, silentLogger);
  return { service, rpcClient, encryption };
}

describe('SolanaService', () => {
  it('generates a wallet with a valid base58 SOL address and an encrypted, decryptable secret key', async () => {
    const { service, encryption } = makeService();
    const wallet = await service.generateWallet();

    expect(service.validateAddress(wallet.address)).toBe(true);
    expect(wallet.derivationPath).toBeNull();

    const decrypted = encryption.decrypt(wallet.encryptedPrivateKey);
    expect(decrypted).toHaveLength(64); // ed25519 secret key length
  });

  it('generates a distinct wallet on every call', async () => {
    const { service } = makeService();
    const a = await service.generateWallet();
    const b = await service.generateWallet();
    expect(a.address).not.toBe(b.address);
  });

  it('rejects a garbage address as invalid', () => {
    const { service } = makeService();
    expect(service.validateAddress('not-a-solana-address')).toBe(false);
  });

  it('converts a lamport balance into Money', async () => {
    const { service, rpcClient } = makeService();
    rpcClient.balanceLamports = 1_500_000_000;
    const balance = await service.getBalance('11111111111111111111111111111112');
    expect(balance.toDecimalString()).toBe('1.5');
  });

  it('reports the required confirmation model as commitment-based (finalized)', () => {
    const { service } = makeService();
    expect(service.getRequiredConfirmations()).toEqual({ kind: 'commitment', level: 'finalized' });
  });

  it('reports a flat base fee estimate', async () => {
    const { service } = makeService();
    const fee = await service.estimateFee({ fromAddress: 'addr', outputs: [] });
    expect(fee.smallestUnits).toBe(5000n);
  });

  it('reports transaction status as confirmed only once finalized', async () => {
    const { service, rpcClient } = makeService();
    rpcClient.signatureStatus = { confirmationStatus: 'confirmed', confirmations: 5 };
    let status = await service.getTransactionStatus('sig');
    expect(status.confirmed).toBe(false);

    rpcClient.signatureStatus = { confirmationStatus: 'finalized', confirmations: null };
    status = await service.getTransactionStatus('sig');
    expect(status.confirmed).toBe(true);
  });

  it('reports unconfirmed when no signature status is found', async () => {
    const { service, rpcClient } = makeService();
    rpcClient.signatureStatus = null;
    const status = await service.getTransactionStatus('missing-sig');
    expect(status).toEqual({ confirmations: 0, confirmed: false });
  });
});
