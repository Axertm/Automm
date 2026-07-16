import type { IDealRepository } from '../../../domain/repositories/IDealRepository.js';
import type { DealState } from '../../../domain/state-machine/DealState.js';

export interface DealStats {
  countsByState: Record<DealState, number>;
  totalDeals: number;
  activeDeals: number;
}

const TERMINAL_STATES: readonly DealState[] = ['COMPLETED', 'REFUNDED', 'CANCELLED'];

/** Read-only aggregate — deliberately exempt from the confirmation-step pattern since it neither moves funds nor changes state. */
export class AdminStatsUseCase {
  constructor(private readonly dealRepository: IDealRepository) {}

  async execute(guildId: string): Promise<DealStats> {
    const countsByState = await this.dealRepository.countByState(guildId);
    const totalDeals = Object.values(countsByState).reduce((sum, count) => sum + count, 0);
    const activeDeals = Object.entries(countsByState)
      .filter(([state]) => !TERMINAL_STATES.includes(state as DealState))
      .reduce((sum, [, count]) => sum + count, 0);

    return { countsByState, totalDeals, activeDeals };
  }
}
