import type { Currency } from '../../domain/value-objects/Currency.js';
import type { IBlockchainService } from '../../application/ports/IBlockchainService.js';
import type { IBlockchainServiceFactory } from '../../application/ports/IBlockchainServiceFactory.js';

export class BlockchainServiceFactory implements IBlockchainServiceFactory {
  private readonly services: Record<Currency, IBlockchainService>;

  constructor(ltcService: IBlockchainService, solService: IBlockchainService, usdtService: IBlockchainService) {
    this.services = { LTC: ltcService, SOL: solService, USDT: usdtService };
  }

  getService(currency: Currency): IBlockchainService {
    return this.services[currency];
  }
}
