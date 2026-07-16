import type { Currency } from '../../domain/value-objects/Currency.js';
import type { IBlockchainService } from './IBlockchainService.js';

export interface IBlockchainServiceFactory {
  getService(currency: Currency): IBlockchainService;
}
