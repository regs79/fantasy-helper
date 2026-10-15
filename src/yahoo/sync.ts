import type { LeagueConfig, Projection } from '../engine/types.js';
import type { DraftState } from '../draft/store.js';

export async function syncDraftFromYahoo(_state: DraftState, _projections: Projection[], _config: LeagueConfig): Promise<{ added: number }> {
  throw new Error('Yahoo sync not built yet');
}
