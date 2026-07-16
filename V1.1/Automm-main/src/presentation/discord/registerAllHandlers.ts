import { HandlerRegistry } from './interaction-router/HandlerRegistry.js';
import { escrowPanelCommand } from './wizard/panelCommand.js';
import { freezeCommand } from './commands/admin/freeze.command.js';
import { unfreezeCommand } from './commands/admin/unfreeze.command.js';
import { releaseCommand } from './commands/admin/release.command.js';
import { refundCommand } from './commands/admin/refund.command.js';
import { cancelCommand } from './commands/admin/cancel.command.js';
import { overridePayoutCommand } from './commands/admin/override-payout.command.js';
import { retryPayoutCommand } from './commands/admin/retry-payout.command.js';
import { balanceCommand } from './commands/admin/balance.command.js';
import { statsCommand } from './commands/admin/stats.command.js';
import { closeCommand } from './commands/admin/close.command.js';
import { dealInfoCommand } from './commands/admin/deal-info.command.js';
import { transcriptCommand } from './commands/admin/transcript.command.js';
import { registerReleaseFlowHandlers } from './components/buttons/releaseFlowHandlers.js';
import { registerAdminHandlers } from './components/buttons/adminHandlers.js';
import { registerWizardHandlers } from './wizard/registerWizardHandlers.js';

export function buildHandlerRegistry(): HandlerRegistry {
  const registry = new HandlerRegistry();

  for (const command of [
    escrowPanelCommand,
    freezeCommand,
    unfreezeCommand,
    releaseCommand,
    refundCommand,
    cancelCommand,
    overridePayoutCommand,
    retryPayoutCommand,
    balanceCommand,
    statsCommand,
    closeCommand,
    dealInfoCommand,
    transcriptCommand,
  ]) {
    registry.registerCommand(command);
  }

  registerReleaseFlowHandlers(registry);
  registerAdminHandlers(registry);
  registerWizardHandlers(registry);

  return registry;
}
