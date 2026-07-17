export interface BackupAccountRecord {
  ownerDiscordId: string;
  backupDiscordId: string;
}

/** A user's self-registered alternate Discord accounts (global, not deal-specific). */
export interface IBackupAccountRepository {
  add(ownerDiscordId: string, backupDiscordId: string): Promise<void>;
  remove(ownerDiscordId: string, backupDiscordId: string): Promise<void>;
  findByOwner(ownerDiscordId: string): Promise<BackupAccountRecord[]>;
  /** All backups registered by anyone that name this Discord id as the backup, used to check "who does this account back up?". */
  findByBackup(backupDiscordId: string): Promise<BackupAccountRecord[]>;
}
