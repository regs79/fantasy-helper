import type { LeagueConfig } from '../engine/types.js';
import { normalizeHeader } from '../projections/mapping.js';
import type { YahooSettings } from './api.js';

/** Yahoo display names (normalized) -> engine category keys. */
const CATEGORY_ALIASES: Record<string, string[]> = {
  fgm: ['fgm'],
  fga: ['fga'],
  fg_pct: ['fgpct'],
  ftm: ['ftm'],
  fta: ['fta'],
  ft_pct: ['ftpct'],
  tpm: ['3ptm', '3pm', '3pt'],
  pts: ['pts'],
  oreb: ['oreb'],
  dreb: ['dreb'],
  reb: ['reb'],
  ast: ['ast'],
  stl: ['st', 'stl'],
  blk: ['blk'],
  tov: ['to', 'tov'],
  ato: ['at', 'ato', 'asttov'],
};

export function categoryKeyFor(displayName: string): string | undefined {
  const n = normalizeHeader(displayName);
  for (const [key, aliases] of Object.entries(CATEGORY_ALIASES)) if (aliases.includes(n)) return key;
  return undefined;
}

export interface ConfigFromSettings {
  config: LeagueConfig;
  unmapped: string[];
}

/** Build a league config from Yahoo settings, keeping eligibility rules and tunables from the existing config. */
export function configFromSettings(settings: YahooSettings, base: LeagueConfig): ConfigFromSettings {
  const categories: string[] = [];
  const unmapped: string[] = [];
  for (const s of settings.stat_categories) {
    if (s.is_only_display_stat) continue;
    const key = categoryKeyFor(s.display_name) ?? categoryKeyFor(s.name);
    if (key) categories.push(key);
    else unmapped.push(s.display_name || s.name);
  }
  const rosterSlots = settings.roster_positions.filter((p) => p.count > 0).map((p) => ({ slot: p.position, count: p.count }));
  const slotEligibility = { ...base.slotEligibility };
  for (const p of settings.roster_positions) if (!slotEligibility[p.position]) slotEligibility[p.position] = ['*'];
  return {
    config: {
      ...base,
      name: settings.league.name || base.name,
      teams: settings.league.num_teams || base.teams,
      budget: settings.budget ?? base.budget,
      categories: categories.length ? categories : base.categories,
      rosterSlots: rosterSlots.length ? rosterSlots : base.rosterSlots,
      slotEligibility,
    },
    unmapped,
  };
}
