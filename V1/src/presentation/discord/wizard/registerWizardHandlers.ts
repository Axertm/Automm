import type { HandlerRegistry } from '../interaction-router/HandlerRegistry.js';
import { registerCreateEscrowHandler } from './createEscrowHandler.js';
import { registerBuyerSellerStepHandlers } from './steps/buyerSellerStep.js';
import { registerRoleConfirmStepHandlers } from './steps/roleConfirmStep.js';
import { registerCurrencyStepHandlers } from './steps/currencyStep.js';
import { registerAmountStepHandlers } from './steps/amountStep.js';
import { registerFinalStepHandlers } from './steps/finalStep.js';

export function registerWizardHandlers(registry: HandlerRegistry): void {
  registerCreateEscrowHandler(registry);
  registerBuyerSellerStepHandlers(registry);
  registerRoleConfirmStepHandlers(registry);
  registerCurrencyStepHandlers(registry);
  registerAmountStepHandlers(registry);
  registerFinalStepHandlers(registry);
}
