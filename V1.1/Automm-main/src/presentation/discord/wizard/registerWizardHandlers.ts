import type { HandlerRegistry } from '../interaction-router/HandlerRegistry.js';
import { registerCreateEscrowHandler } from './createEscrowHandler.js';
import { registerParticipantStepHandlers } from './steps/participantStep.js';
import { registerRoleClaimStepHandlers } from './steps/roleClaimStep.js';
import { registerCurrencyStepHandlers } from './steps/currencyStep.js';
import { registerAmountStepHandlers } from './steps/amountStep.js';
import { registerFinalStepHandlers } from './steps/finalStep.js';

export function registerWizardHandlers(registry: HandlerRegistry): void {
  registerCreateEscrowHandler(registry);
  registerParticipantStepHandlers(registry);
  registerRoleClaimStepHandlers(registry);
  registerCurrencyStepHandlers(registry);
  registerAmountStepHandlers(registry);
  registerFinalStepHandlers(registry);
}
