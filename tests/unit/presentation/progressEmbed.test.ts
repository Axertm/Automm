import { describe, expect, it } from 'vitest';
import { buildProgressText } from '../../../src/presentation/discord/wizard/progressEmbed.js';
import { createInitialWizardState } from '../../../src/presentation/discord/wizard/DealWizardState.js';
import { asDealId } from '../../../src/domain/value-objects/EntityId.js';

function makeState(step: 1 | 2 | 3 | 4 | 5) {
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
    expect(text).toContain('Step 1/5 ⏳ Participant Selected');
    expect(text).toContain('Step 2/5 ⬜ Roles Claimed');
    expect(text).toContain('Step 5/5 ⬜ Final Confirmation');
  });

  it('marks earlier steps complete and the current step as in-progress', () => {
    const text = buildProgressText(makeState(3));
    expect(text).toContain('Step 1/5 ✅ Participant Selected');
    expect(text).toContain('Step 2/5 ✅ Roles Claimed');
    expect(text).toContain('Step 3/5 ⏳ Coin Selected');
    expect(text).toContain('Step 4/5 ⬜ Amount Confirmed');
  });

  it('marks all steps complete-or-current at the final step', () => {
    const text = buildProgressText(makeState(5));
    expect(text).not.toContain('⬜');
    expect(text).toContain('Step 5/5 ⏳ Final Confirmation');
  });
});
