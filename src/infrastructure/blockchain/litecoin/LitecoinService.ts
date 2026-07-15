import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from 'ecpair';
import type { Logger } from 'pino';
import type {
  ConfirmationRequirement,
  GeneratedWallet,
  IBlockchainService,
  ObservedTransaction,
  PayoutOutput,
  PayoutResult,
} from '../../../application/ports/IBlockchainService.js';
import type { IEncryptionService } from '../../../application/ports/IEncryptionService.js';
import type { EncryptedBlob } from '../../../domain/entities/Wallet.js';
import { Money } from '../../../domain/value-objects/Money.js';
import { isValidAddress, LTC_MAINNET_PARAMS } from '../../../domain/value-objects/Address.js';
import type { IFailoverUtxoProvider } from './IFailoverUtxoProvider.js';

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);
const bip32 = BIP32Factory(ecc);

const DERIVATION_PATH = "m/84'/2'/0'/0/0";
const REQUIRED_CONFIRMATIONS = 3;

/**
 * Implements IBlockchainService for Litecoin. Every deal wallet is derived
 * from a fresh, independent BIP39 mnemonic generated (and immediately
 * discarded) at wallet-creation time — deliberately NOT from one shared
 * master seed/xprv across all deals, so compromising one wallet's stored
 * key never exposes any other deal's funds.
 */
export class LitecoinService implements IBlockchainService {
  readonly currency = 'LTC' as const;

  constructor(
    private readonly utxoProvider: IFailoverUtxoProvider,
    private readonly encryptionService: IEncryptionService,
    private readonly logger: Logger,
    private readonly requiredConfirmations: number = REQUIRED_CONFIRMATIONS,
  ) {}

  async generateWallet(): Promise<GeneratedWallet> {
    const mnemonic = bip39.generateMnemonic(256);
    const seed = await bip39.mnemonicToSeed(mnemonic);
    const root = bip32.fromSeed(seed, LTC_MAINNET_PARAMS);
    const child = root.derivePath(DERIVATION_PATH);
    if (!child.privateKey) {
      throw new Error('Failed to derive a Litecoin private key');
    }
    const pubkey = Buffer.from(child.publicKey);
    const { address } = bitcoin.payments.p2wpkh({ pubkey, network: LTC_MAINNET_PARAMS });
    if (!address) {
      throw new Error('Failed to derive a Litecoin address');
    }

    const encryptedPrivateKey = this.encryptionService.encrypt(Buffer.from(child.privateKey));
    // The mnemonic/seed/root/child key never leave this function scope and
    // are not referenced again — nothing beyond the encrypted blob persists.

    return { address, encryptedPrivateKey, derivationPath: DERIVATION_PATH };
  }

  validateAddress(address: string): boolean {
    return isValidAddress('LTC', address);
  }

  async getBalance(address: string): Promise<Money> {
    const utxos = await this.utxoProvider.getUtxos(address);
    const total = utxos.reduce((sum, utxo) => sum + utxo.valueLitoshi, 0n);
    return Money.fromSmallestUnits('LTC', total);
  }

  async getIncomingTransactions(address: string, sinceUnixTime?: number): Promise<ObservedTransaction[]> {
    const txs = await this.utxoProvider.getAddressTransactions(address);
    return txs
      .filter((tx) => !sinceUnixTime || !tx.blockTime || tx.blockTime >= sinceUnixTime)
      .map((tx) => ({
        txid: tx.txid,
        amount: Money.fromSmallestUnits('LTC', tx.amountLitoshi),
        confirmations: tx.confirmations,
        blockTime: tx.blockTime,
      }));
  }

  async estimateFee(params: { fromAddress: string; outputs: PayoutOutput[] }): Promise<Money> {
    const satPerVByte = await this.utxoProvider.getFeeEstimateSatPerVByte();
    // Rough vsize estimate: 1 P2WPKH input (~68 vbytes) + N P2WPKH outputs (~31 vbytes each) + 11 overhead.
    const utxos = await this.utxoProvider.getUtxos(params.fromAddress);
    const estimatedVBytes = 11 + utxos.length * 68 + params.outputs.length * 31;
    return Money.fromSmallestUnits('LTC', BigInt(Math.ceil(estimatedVBytes * satPerVByte)));
  }

  async sendPayout(params: {
    fromWallet: { address: string; encryptedPrivateKey: EncryptedBlob };
    outputs: PayoutOutput[];
  }): Promise<PayoutResult> {
    const utxos = await this.utxoProvider.getUtxos(params.fromWallet.address);
    if (utxos.length === 0) {
      throw new Error(`No spendable UTXOs found for ${params.fromWallet.address}`);
    }

    const fee = await this.estimateFee({ fromAddress: params.fromWallet.address, outputs: params.outputs });
    const totalOut = params.outputs.reduce((sum, o) => sum + o.amount.smallestUnits, 0n) + fee.smallestUnits;
    const totalIn = utxos.reduce((sum, u) => sum + u.valueLitoshi, 0n);
    if (totalIn < totalOut) {
      throw new Error(`Insufficient UTXO balance: have ${totalIn}, need ${totalOut} litoshi`);
    }

    let decryptedKey: Buffer | null = null;
    try {
      decryptedKey = this.encryptionService.decrypt(params.fromWallet.encryptedPrivateKey);
      const keyPair = ECPair.fromPrivateKey(decryptedKey, { network: LTC_MAINNET_PARAMS });

      const psbt = new bitcoin.Psbt({ network: LTC_MAINNET_PARAMS });
      for (const utxo of utxos) {
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: {
            script: bitcoin.address.toOutputScript(params.fromWallet.address, LTC_MAINNET_PARAMS),
            value: Number(utxo.valueLitoshi),
          },
        });
      }
      for (const output of params.outputs) {
        psbt.addOutput({ address: output.address, value: Number(output.amount.smallestUnits) });
      }
      const change = totalIn - totalOut;
      if (change > 546n) {
        psbt.addOutput({ address: params.fromWallet.address, value: Number(change) });
      }

      psbt.signAllInputs({
        publicKey: Buffer.from(keyPair.publicKey),
        sign: (hash) => Buffer.from(keyPair.sign(hash)),
      });
      psbt.finalizeAllInputs();
      const txHex = psbt.extractTransaction().toHex();

      const txid = await this.utxoProvider.broadcastRawTransaction(txHex);
      this.logger.info(
        { dealCurrency: 'LTC', txid, outputCount: params.outputs.length },
        'ltc_payout_broadcast',
      );
      return { txid, feeCharged: fee };
    } finally {
      decryptedKey?.fill(0);
    }
  }

  getRequiredConfirmations(): ConfirmationRequirement {
    return { kind: 'blocks', count: this.requiredConfirmations };
  }

  async getTransactionStatus(txid: string): Promise<{ confirmations: number; confirmed: boolean }> {
    const confirmations = await this.utxoProvider.getTransactionConfirmations(txid);
    return { confirmations, confirmed: confirmations >= this.requiredConfirmations };
  }
}
