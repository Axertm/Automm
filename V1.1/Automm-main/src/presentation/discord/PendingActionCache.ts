import { randomBytes } from 'node:crypto';

interface CacheEntry {
  payload: Record<string, string>;
  expiresAt: number;
}

const TTL_MS = 2 * 60 * 1000;

/**
 * Short-lived bridge between a modal submission (which can carry arbitrary
 * free text) and the subsequent confirm-button click (whose custom_id is
 * capped at 100 characters and can't carry a full reason/address). The
 * modal handler stashes its payload here and passes only the resulting
 * token through the confirmation button's custom_id.
 */
export class PendingActionCache {
  private readonly entries = new Map<string, CacheEntry>();

  put(payload: Record<string, string>): string {
    const token = randomBytes(6).toString('hex');
    this.entries.set(token, { payload, expiresAt: Date.now() + TTL_MS });
    return token;
  }

  take(token: string): Record<string, string> | null {
    const entry = this.entries.get(token);
    this.entries.delete(token);
    if (!entry || entry.expiresAt < Date.now()) return null;
    return entry.payload;
  }
}
