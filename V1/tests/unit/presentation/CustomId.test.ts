import { describe, expect, it } from 'vitest';
import {
  decodeCustomId,
  encodeCancel,
  encodeConfirm,
  encodeCustomId,
} from '../../../src/presentation/discord/interaction-router/CustomId.js';

describe('CustomId', () => {
  it('round-trips a plain action', () => {
    const id = encodeCustomId('admin', 'unfreeze', '482913');
    const decoded = decodeCustomId(id);
    expect(decoded).toEqual({ namespace: 'admin', action: 'unfreeze', dealId: '482913', extra: null });
  });

  it('round-trips a plain action with extra', () => {
    const id = encodeCustomId('wizard', 'select_buyer', '482913', 'user-123');
    const decoded = decodeCustomId(id);
    expect(decoded).toEqual({
      namespace: 'wizard',
      action: 'select_buyer',
      dealId: '482913',
      extra: 'user-123',
    });
  });

  it('round-trips an encodeConfirm id WITHOUT corrupting the dealId or extra fields', () => {
    // Regression test: encodeConfirm/encodeCancel used to build the action
    // as `confirm:${action}` and then join every field with the same ':'
    // delimiter used internally by that action string, which shifted every
    // subsequent field by one position on decode. This must never regress —
    // it silently broke every confirm/cancel button in the bot.
    const id = encodeConfirm('admin', 'freeze', '482913');
    const decoded = decodeCustomId(id);
    expect(decoded.namespace).toBe('admin');
    expect(decoded.action).toBe('confirm_freeze');
    expect(decoded.dealId).toBe('482913');
  });

  it('round-trips an encodeConfirm id carrying an extra token, preserving both dealId and extra', () => {
    const id = encodeConfirm('admin', 'refund', '482913', 'abc123token');
    const decoded = decodeCustomId(id);
    expect(decoded).toEqual({
      namespace: 'admin',
      action: 'confirm_refund',
      dealId: '482913',
      extra: 'abc123token',
    });
  });

  it('round-trips an encodeCancel id', () => {
    const id = encodeCancel('payout', 'confirm_release', '482913');
    const decoded = decodeCustomId(id);
    expect(decoded).toEqual({
      namespace: 'payout',
      action: 'cancel_confirm_release',
      dealId: '482913',
      extra: null,
    });
  });

  it('rejects a custom_id over the 100-character Discord limit', () => {
    expect(() => encodeCustomId('a'.repeat(50), 'b'.repeat(50), 'c'.repeat(50))).toThrow();
  });

  it('throws on a malformed custom_id missing required fields', () => {
    expect(() => decodeCustomId('onlyonepart')).toThrow();
  });
});
