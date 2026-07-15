import { describe, expect, it } from 'vitest';
import {
  createInitialWizardState,
  DealWizardStore,
} from '../../../src/presentation/discord/wizard/DealWizardState.js';
import { asDealId } from '../../../src/domain/value-objects/EntityId.js';

function makeState() {
  return createInitialWizardState({
    dealId: asDealId('482913'),
    guildId: 'guild-1',
    channelId: 'channel-1',
    initiatorId: 'user-1',
  });
}

describe('DealWizardStore', () => {
  it('starts at step 1 with nothing confirmed', () => {
    const state = makeState();
    expect(state.step).toBe(1);
    expect(state.buyerConfirmed).toBe(false);
    expect(state.sellerConfirmed).toBe(false);
    expect(state.buyerRoleConfirmed).toBe(false);
    expect(state.sellerRoleConfirmed).toBe(false);
    expect(state.currencyConfirmed).toBe(false);
    expect(state.amountConfirmed).toBe(false);
    expect(state.buyerFinalConfirmed).toBe(false);
    expect(state.sellerFinalConfirmed).toBe(false);
  });

  it('creates, retrieves, and updates a wizard session keyed by channel', () => {
    const store = new DealWizardStore();
    const state = makeState();
    store.create(state);

    expect(store.get('channel-1')).toEqual(state);

    const updated = store.update('channel-1', { buyerId: 'buyer-1', buyerConfirmed: true, step: 2 });
    expect(updated?.buyerId).toBe('buyer-1');
    expect(updated?.step).toBe(2);
    expect(store.get('channel-1')?.buyerId).toBe('buyer-1');
  });

  it('returns null when updating or getting an unknown channel', () => {
    const store = new DealWizardStore();
    expect(store.get('missing-channel')).toBeNull();
    expect(store.update('missing-channel', { step: 3 })).toBeNull();
  });

  it('deletes a session', () => {
    const store = new DealWizardStore();
    store.create(makeState());
    store.delete('channel-1');
    expect(store.get('channel-1')).toBeNull();
  });

  it('partial updates preserve unrelated fields', () => {
    const store = new DealWizardStore();
    store.create(makeState());
    store.update('channel-1', { buyerId: 'buyer-1' });
    const updated = store.update('channel-1', { sellerId: 'seller-1' });
    expect(updated?.buyerId).toBe('buyer-1');
    expect(updated?.sellerId).toBe('seller-1');
  });

  describe('findByDealId', () => {
    it('finds an active session by its short Deal ID, not just by channel', () => {
      const store = new DealWizardStore();
      store.create(makeState());
      expect(store.findByDealId('482913')?.channelId).toBe('channel-1');
    });

    it('returns null for a Deal ID with no active session', () => {
      const store = new DealWizardStore();
      store.create(makeState());
      expect(store.findByDealId('000000')).toBeNull();
    });
  });
});
