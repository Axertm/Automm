import type { DealBackupRecord } from '../../domain/repositories/IDealBackupRepository.js';

export interface ActingIdentity {
  /** The real buyer/seller Discord id to pass into Deal's own actor checks — always the ORIGINAL party, never the backup's raw id. */
  effectiveDiscordId: string;
  /** True when actorDiscordId was a backup account standing in for the real party, not the party itself. */
  viaBackup: boolean;
}

/**
 * Deal entity methods (confirmReleaseByBuyer, submitPayoutAddress, etc.)
 * check the actor against the deal's real buyerDiscordId/sellerDiscordId —
 * they know nothing about backup accounts. This resolves whoever actually
 * clicked (actorDiscordId) to the identity Deal's checks expect: unchanged
 * if they're already the real party, or the real party's id if they're an
 * admin-activated backup standing in for that role (see IDealBackupRepository).
 * Passing through unresolved (viaBackup: false, effectiveDiscordId unchanged)
 * for a non-match is deliberate — the domain layer's own check is still the
 * final word and will reject them with the normal UnauthorizedActorError.
 */
export function resolveActingDiscordId(
  deal: { buyerDiscordId: string; sellerDiscordId: string },
  actorDiscordId: string,
  dealBackups: readonly DealBackupRecord[],
): ActingIdentity {
  if (actorDiscordId === deal.buyerDiscordId || actorDiscordId === deal.sellerDiscordId) {
    return { effectiveDiscordId: actorDiscordId, viaBackup: false };
  }
  const backup = dealBackups.find((b) => b.backupDiscordId === actorDiscordId);
  if (!backup) {
    return { effectiveDiscordId: actorDiscordId, viaBackup: false };
  }
  return {
    effectiveDiscordId: backup.role === 'BUYER' ? deal.buyerDiscordId : deal.sellerDiscordId,
    viaBackup: true,
  };
}
