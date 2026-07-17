import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { AbiCoder, type JsonRpcProvider } from 'ethers';
import { UsdtPolygonService } from '../../../../src/infrastructure/blockchain/usdt-polygon/UsdtPolygonService.js';
import type { IPolygonRpcClient } from '../../../../src/infrastructure/blockchain/usdt-polygon/IPolygonRpcClient.js';

const silentLogger = pino({ level: 'silent' });
const CONTRACT_ADDRESS = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
const BALANCE_OF_SELECTOR = '0x70a08231';

class StubProvider {
  blockNumber = 1000;
  balanceWei = 0n;
  gasPrice = 30_000_000_000n;
  receipt: { status: number; blockNumber: number } | null = null;
  tokenBalance = 0n;

  async getBlockNumber(): Promise<number> {
    return this.blockNumber;
  }

  async getBalance(_address: string): Promise<bigint> {
    return this.balanceWei;
  }

  async getFeeData(): Promise<{ gasPrice: bigint | null; maxFeePerGas: bigint | null }> {
    return { gasPrice: this.gasPrice, maxFeePerGas: null };
  }

  async getTransactionReceipt(_hash: string): Promise<{ status: number; blockNumber: number } | null> {
    return this.receipt;
  }

  async call(tx: { data?: string }): Promise<string> {
    if (tx.data?.startsWith(BALANCE_OF_SELECTOR)) {
      return AbiCoder.defaultAbiCoder().encode(['uint256'], [this.tokenBalance]);
    }
    throw new Error(`StubProvider.call: unexpected calldata ${tx.data}`);
  }

  // Minimal surface ethers.Contract's read-call path touches internally.
  async getNetwork(): Promise<{ chainId: bigint }> {
    return { chainId: 137n };
  }
}

class StubRpcClient implements IPolygonRpcClient {
  readonly provider = new StubProvider();

  async withProvider<T>(_operation: string, call: (provider: JsonRpcProvider) => Promise<T>): Promise<T> {
    return call(this.provider as unknown as JsonRpcProvider);
  }
}

function makeService(requiredConfirmations = 30) {
  const rpcClient = new StubRpcClient();
  const service = new UsdtPolygonService(rpcClient, CONTRACT_ADDRESS, silentLogger, requiredConfirmations);
  return { service, rpcClient };
}

describe('UsdtPolygonService', () => {
  it('generates a wallet with a valid checksummed EVM address and a 32-byte key', async () => {
    const { service } = makeService();
    const wallet = await service.generateWallet();

    expect(service.validateAddress(wallet.address)).toBe(true);
    expect(wallet.derivationPath).toBe("m/44'/60'/0'/0/0");

    const decoded = Buffer.from(wallet.encryptedPrivateKey, 'base64');
    expect(decoded).toHaveLength(32);
  });

  it('generates a distinct wallet on every call', async () => {
    const { service } = makeService();
    const a = await service.generateWallet();
    const b = await service.generateWallet();
    expect(a.address).not.toBe(b.address);
  });

  it('validates real EVM addresses and rejects garbage / non-EVM addresses', () => {
    const { service } = makeService();
    expect(service.validateAddress('0xc2132D05D31c914a87C6611C10748AEb04B58e8F')).toBe(true);
    expect(service.validateAddress('not-an-address')).toBe(false);
    expect(service.validateAddress('11111111111111111111111111111112')).toBe(false);
  });

  it('reads a token balance via balanceOf', async () => {
    const { service, rpcClient } = makeService();
    rpcClient.provider.tokenBalance = 1_500_000n; // 1.5 USDT at 6 decimals
    const balance = await service.getBalance('0xc2132D05D31c914a87C6611C10748AEb04B58e8F');
    expect(balance.toDecimalString()).toBe('1.5');
  });

  it('always estimates zero fee — gas is paid from pre-funded POL, not carved from the USDT escrow', async () => {
    const { service } = makeService();
    const fee = await service.estimateFee();
    expect(fee.isZero()).toBe(true);
    expect(fee.currency).toBe('USDT');
  });

  it('reports the required confirmation model as block-count based', () => {
    const { service } = makeService(45);
    expect(service.getRequiredConfirmations()).toEqual({ kind: 'blocks', count: 45 });
  });

  it('refuses to send a payout when the wallet has insufficient POL for gas', async () => {
    const { service, rpcClient } = makeService();
    rpcClient.provider.balanceWei = 0n; // no gas at all

    await expect(
      service.sendPayout({
        fromWallet: { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', encryptedPrivateKey: Buffer.alloc(32, 1).toString('base64') },
        outputs: [{ address: '0x000000000000000000000000000000000000dEaD', amount: { smallestUnits: 1_000_000n } as never }],
      }),
    ).rejects.toThrow(/Insufficient POL for gas/);
  });

  it('reports a transaction as confirmed once it reaches the required confirmation count', async () => {
    const { service, rpcClient } = makeService(10);
    rpcClient.provider.receipt = { status: 1, blockNumber: 990 };
    rpcClient.provider.blockNumber = 1000;

    const status = await service.getTransactionStatus('0xsometxhash');
    expect(status.confirmations).toBe(11);
    expect(status.confirmed).toBe(true);
  });

  it('reports a failed (reverted) transaction as unconfirmed regardless of block depth', async () => {
    const { service, rpcClient } = makeService(10);
    rpcClient.provider.receipt = { status: 0, blockNumber: 990 };
    rpcClient.provider.blockNumber = 1000;

    const status = await service.getTransactionStatus('0xsometxhash');
    expect(status).toEqual({ confirmations: 0, confirmed: false });
  });

  it('reports unconfirmed when no receipt is found yet', async () => {
    const { service, rpcClient } = makeService();
    rpcClient.provider.receipt = null;

    const status = await service.getTransactionStatus('0xmissing');
    expect(status).toEqual({ confirmations: 0, confirmed: false });
  });
});
