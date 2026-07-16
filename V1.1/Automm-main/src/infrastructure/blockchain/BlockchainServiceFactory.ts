import type { Currency } from '../../domain/value-objects/Currency.js';
import type { IBlockchainService } from '../../application/ports/IBlockchainService.js';
import type { IBlockchainServiceFactory } from '../../application/ports/IBlockchainServiceFactory.js';

export class BlockchainServiceFactory implements IBlockchainServiceFactory {
  constructor(
    private readonly ltcService: IBlockchainService,
    private readonly solService: IBlockchainService,
  ) {}

  getService(currency: Currency): IBlockchainService {
    return currency === 'LTC' ? this.ltcService : this.solService;
  }
}
