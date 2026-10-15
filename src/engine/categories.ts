import type { CategoryDef, Projection, StatKey } from './types.js';

/** Every category this engine knows how to score. League config picks a subset. */
export const CATEGORY_CATALOG: Record<string, CategoryDef> = {
  fgm: { key: 'fgm', label: 'FGM', kind: 'counting', stat: 'fgm' },
  fga: { key: 'fga', label: 'FGA', kind: 'counting', stat: 'fga' },
  fg_pct: { key: 'fg_pct', label: 'FG%', kind: 'ratio', num: 'fgm', den: 'fga' },
  ftm: { key: 'ftm', label: 'FTM', kind: 'counting', stat: 'ftm' },
  fta: { key: 'fta', label: 'FTA', kind: 'counting', stat: 'fta' },
  ft_pct: { key: 'ft_pct', label: 'FT%', kind: 'ratio', num: 'ftm', den: 'fta' },
  tpm: { key: 'tpm', label: '3PM', kind: 'counting', stat: 'tpm' },
  pts: { key: 'pts', label: 'PTS', kind: 'counting', stat: 'pts' },
  oreb: { key: 'oreb', label: 'OREB', kind: 'counting', stat: 'oreb' },
  dreb: { key: 'dreb', label: 'DREB', kind: 'counting', stat: 'dreb' },
  reb: { key: 'reb', label: 'REB', kind: 'counting', stat: 'reb' },
  ast: { key: 'ast', label: 'AST', kind: 'counting', stat: 'ast' },
  stl: { key: 'stl', label: 'STL', kind: 'counting', stat: 'stl' },
  blk: { key: 'blk', label: 'BLK', kind: 'counting', stat: 'blk' },
  tov: { key: 'tov', label: 'TO', kind: 'counting', stat: 'tov', lowerIsBetter: true },
  ato: { key: 'ato', label: 'A/T', kind: 'ratio', num: 'ast', den: 'tov' },
};

export function categoryDefs(keys: string[]): CategoryDef[] {
  return keys.map((k) => {
    const def = CATEGORY_CATALOG[k];
    if (!def) throw new Error(`Unknown category "${k}". Known: ${Object.keys(CATEGORY_CATALOG).join(', ')}`);
    return def;
  });
}

/** Read a stat from a projection, deriving composites like total rebounds. */
export function stat(p: Projection, key: StatKey): number {
  if (key === 'reb') return (p.oreb ?? 0) + (p.dreb ?? 0);
  const v = p[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
