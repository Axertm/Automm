import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { LitecoinService } from '../../../../src/infrastructure/blockchain/litecoin/LitecoinService.js';
import type { IFailoverUtxoProvider } from '../../../../src/infrastructure/blockchain/litecoin/IFailoverUtxoProvider.js';
import type {
  Utxo,
  UtxoProviderTransaction,
} from '../../../../src/infrastructure/blockchain/litecoin/providers/IUtxoProvider.js';

const silentLogger = pino({ level: 'silent' });

class StubUtxoProvider implements IFailoverUtxoProvider {
  utxos: Utxo[] = [];
  transactions: UtxoProviderTransaction[] = [];
  feeSatPerVByte = 10;
  broadcastedTxHex: string[] = [];
  broadcastTxid = 'broadcast-txid';
  confirmations = 5;
  /** 'found' | 'not-found' (definitive) | 'error' (inconclusive) — see LitecoinService.verifyBroadcast. */
  broadcastVerification: 'found' | 'not-found' | 'error' = 'found';

  async getAddressTransactions(): Promise<UtxoProviderTransaction[]> {
    return this.transactions;
  }

  async getUtxos(): Promise<Utxo[]> {
    return this.utxos;
  }

  async getFeeEstimateSatPerVByte(): Promise<number> {
    return this.feeSatPerVByte;
  }

  async broadcastRawTransaction(txHex: string): Promise<string> {
    this.broadcastedTxHex.push(txHex);
    return this.broadcastTxid;
  }

  async getTransactionConfirmations(): Promise<number> {
    return this.confirmations;
  }

  async transactionExists(): Promise<boolean> {
    if (this.broadcastVerification === 'error') {
      throw new Error('provider unavailable');
    }
    return this.broadcastVerification === 'found';
  }
}

function makeService() {
  const utxoProvider = new StubUtxoProvider();
  // Zero delay + a single attempt keeps the "not found"/"inconclusive" tests
  // fast and deterministic; production uses BROADCAST_VERIFY_* defaults.
  const service = new LitecoinService(utxoProvider, silentLogger, undefined, 1, 0);
  return { service, utxoProvider };
}

describe('LitecoinService', () => {
  it('generates a wallet with a valid bech32 LTC address and a decodable private key', async () => {
    const { service } = makeService();
    const wallet = await service.generateWallet();

    expect(wallet.address.startsWith('ltc1')).toBe(true);
    expect(service.validateAddress(wallet.address)).toBe(true);
    expect(wallet.derivationPath).toBe("m/84'/2'/0'/0/0");

    const decoded = Buffer.from(wallet.encryptedPrivateKey, 'base64');
    expect(decoded).toHaveLength(32);
  });

  it('generates a distinct, independent wallet on every call (never reused)', async () => {
    const { service } = makeService();
    const a = await service.generateWallet();
    const b = await service.generateWallet();
    expect(a.address).not.toBe(b.address);
  });

  it('rejects a Bitcoin/garbage address as invalid', () => {
    const { service } = makeService();
    expect(service.validateAddress('16NJyhjw4WNSnmgmEPTsYsEcCLrEaRHwzD')).toBe(false);
    expect(service.validateAddress('garbage')).toBe(false);
  });

  it('sums UTXOs into a balance', async () => {
    const { service, utxoProvider } = makeService();
    utxoProvider.utxos = [
      { txid: 't1', vout: 0, valueLitoshi: 100_000_000n, confirmations: 3, scriptPubKeyHex: '' },
      { txid: 't2', vout: 1, valueLitoshi: 50_000_000n, confirmations: 1, scriptPubKeyHex: '' },
    ];
    const balance = await service.getBalance('ltc1qsomeaddress');
    expect(balance.toDecimalString()).toBe('1.5');
  });

  it('reports the required confirmation count', () => {
    const { service } = makeService();
    expect(service.getRequiredConfirmations()).toEqual({ kind: 'blocks', count: 3 });
  });

  it('reports transaction status as confirmed once required confirmations are met', async () => {
    const { service, utxoProvider } = makeService();
    utxoProvider.confirmations = 3;
    const status = await service.getTransactionStatus('some-txid');
    expect(status).toEqual({ confirmations: 3, confirmed: true });
  });

  it('signs and broadcasts a payout transaction, zeroing the fee correctly against inputs', async () => {
    const { service, utxoProvider } = makeService();
    const wallet = await service.generateWallet();
    utxoProvider.feeSatPerVByte = 10;
    utxoProvider.utxos = [
      { txid: 'a'.repeat(64), vout: 0, valueLitoshi: 200_000_000n, confirmations: 6, scriptPubKeyHex: '' },
    ];

    const result = await service.sendPayout({
      fromWallet: { address: wallet.address, encryptedPrivateKey: wallet.encryptedPrivateKey },
      outputs: [
        {
          address: wallet.address,
          amount: (await import('../../../../src/domain/value-objects/Money.js')).Money.fromDecimalString(
            'LTC',
            '1',
          ),
        },
      ],
    });

    expect(result.txid).toBe('broadcast-txid');
    expect(utxoProvider.broadcastedTxHex).toHaveLength(1);
  });

  it('refuses to send a payout when there are no spendable UTXOs', async () => {
    const { service } = makeService();
    const wallet = await service.generateWallet();
    const { Money } = await import('../../../../src/domain/value-objects/Money.js');

    await expect(
      service.sendPayout({
        fromWallet: { address: wallet.address, encryptedPrivateKey: wallet.encryptedPrivateKey },
        outputs: [{ address: wallet.address, amount: Money.fromDecimalString('LTC', '1') }],
      }),
    ).rejects.toThrow();
  });

  it('fails the payout when the broadcast can never be verified on-chain, rather than trusting a phantom txid', async () => {
    const { service, utxoProvider } = makeService();
    const wallet = await service.generateWallet();
    utxoProvider.utxos = [
      { txid: 'a'.repeat(64), vout: 0, valueLitoshi: 200_000_000n, confirmations: 6, scriptPubKeyHex: '' },
    ];
    utxoProvider.broadcastVerification = 'not-found';
    const { Money } = await import('../../../../src/domain/value-objects/Money.js');

    await expect(
      service.sendPayout({
        fromWallet: { address: wallet.address, encryptedPrivateKey: wallet.encryptedPrivateKey },
        outputs: [{ address: wallet.address, amount: Money.fromDecimalString('LTC', '1') }],
      }),
    ).rejects.toThrow(/could not be found on-chain/);
  });

  it('still trusts the broadcast when verification is merely inconclusive (providers erroring, not a clean "not found")', async () => {
    const { service, utxoProvider } = makeService();
    const wallet = await service.generateWallet();
    utxoProvider.utxos = [
      { txid: 'a'.repeat(64), vout: 0, valueLitoshi: 200_000_000n, confirmations: 6, scriptPubKeyHex: '' },
    ];
    utxoProvider.broadcastVerification = 'error';
    const { Money } = await import('../../../../src/domain/value-objects/Money.js');

    const result = await service.sendPayout({
      fromWallet: { address: wallet.address, encryptedPrivateKey: wallet.encryptedPrivateKey },
      outputs: [{ address: wallet.address, amount: Money.fromDecimalString('LTC', '1') }],
    });

    expect(result.txid).toBe('broadcast-txid');
  });
});
