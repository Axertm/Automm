import { describe, expect, it } from 'vitest';
import { buildProgressText } from '../../../src/presentation/discord/wizard/progressEmbed.js';
import { createInitialWizardState } from '../../../src/presentation/discord/wizard/DealWizardState.js';
import { asDealId } from '../../../src/domain/value-objects/EntityId.js';

function makeState(step: 1 | 2 | 3 | 4 | 5 | 6) {
  const state = createInitialWizardState({
    dealId: asDealId('482913'),
    guildId: 'guild-1',
    channelId: 'channel-1',
    initiatorId: 'user-1',
  });
  return { ...state, step };
}

describe('buildProgressText', () => {
  it('marks step 1 as in-progress and the rest as pending', () => {
    const text = buildProgressText(makeState(1));
    expect(text).toContain('Step 1/6 ⏳ Buyer Selected');
    expect(text).toContain('Step 2/6 ⬜ Seller Selected');
    expect(text).toContain('Step 6/6 ⬜ Final Confirmation');
  });

  it('marks earlier steps complete and the current step as in-progress', () => {
    const text = buildProgressText(makeState(4));
    expect(text).toContain('Step 1/6 ✅ Buyer Selected');
    expect(text).toContain('Step 2/6 ✅ Seller Selected');
    expect(text).toContain('Step 3/6 ✅ Roles Confirmed');
    expect(text).toContain('Step 4/6 ⏳ Coin Selected');
    expect(text).toContain('Step 5/6 ⬜ Amount Confirmed');
  });

  it('marks all steps complete-or-current at the final step', () => {
    const text = buildProgressText(makeState(6));
    expect(text).not.toContain('⬜');
    expect(text).toContain('Step 6/6 ⏳ Final Confirmation');
  });
});
