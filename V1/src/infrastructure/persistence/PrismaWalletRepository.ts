import type { PrismaClient, Wallet as PrismaWallet } from '@prisma/client';
import { Wallet, type EncryptedBlob } from '../../domain/entities/Wallet.js';
import { assertCurrency } from '../../domain/value-objects/Currency.js';
import { asDealId, asWalletId, type DealId, type WalletId } from '../../domain/value-objects/EntityId.js';
import type { IWalletRepository } from '../../domain/repositories/IWalletRepository.js';

function toDomain(row: PrismaWallet): Wallet {
  const encryptedPrivateKey: EncryptedBlob = JSON.parse(row.encryptedPrivateKey);
  return Wallet.create({
    id: asWalletId(row.id),
    dealId: asDealId(row.dealId),
    currency: assertCurrency(row.currency),
    address: row.address,
    encryptedPrivateKey,
    derivationPath: row.derivationPath,
    createdAt: row.createdAt,
  });
}

export class PrismaWalletRepository implements IWalletRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(wallet: Wallet): Promise<void> {
    const props = wallet.toProps();
    await this.prisma.wallet.upsert({
      where: { id: props.id },
      create: {
        id: props.id,
        dealId: props.dealId,
        currency: props.currency,
        address: props.address,
        encryptedPrivateKey: JSON.stringify(props.encryptedPrivateKey),
        derivationPath: props.derivationPath,
        createdAt: props.createdAt,
      },
      update: {
        encryptedPrivateKey: JSON.stringify(props.encryptedPrivateKey),
      },
    });
  }

  async findById(id: WalletId): Promise<Wallet | null> {
    const row = await this.prisma.wallet.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByDealId(dealId: DealId): Promise<Wallet | null> {
    const row = await this.prisma.wallet.findUnique({ where: { dealId } });
    return row ? toDomain(row) : null;
  }
}
