import type { Projection } from '../engine/types.js';
import { autoMap, buildProjections } from '../projections/mapping.js';
import { normalizeName, slug } from '../projections/names.js';
import type { YahooPlayer, YahooStatCategory } from './api.js';

export interface YahooConversion {
  projections: Projection[];
  warnings: string[];
  headers: string[];
  mapping: Record<string, string>;
}

/**
 * Turn Yahoo player stat lines into projections by routing them through the
 * CSV importer: stat ids become columns named by their display name, composite
 * "FGM/FGA" columns are split, and the header mapper does the rest.
 */
export function yahooPlayersToProjections(
  players: YahooPlayer[],
  statCategories: YahooStatCategory[],
  opts: { totals: boolean; source?: string; defaultGp?: number } = { totals: true },
): YahooConversion {
  const nameById = new Map(statCategories.map((s) => [s.stat_id, s.display_name || s.name]));
  const rows: Record<string, string>[] = [];
  const headerSet = new Set<string>(['Player', 'Team', 'Pos']);
  for (const p of players) {
    const row: Record<string, string> = { Player: p.name, Team: p.team, Pos: p.positions.join(',') };
    for (const [id, value] of Object.entries(p.stats)) {
      const header = nameById.get(id) ?? `stat_${id}`;
      const split = header.includes('/') && value.includes('/') ? compositeHeaders(header) : undefined;
      if (split) {
        const [v1, v2] = value.split('/');
        row[split[0]] = (v1 ?? '').trim();
        row[split[1]] = (v2 ?? '').trim();
        headerSet.add(split[0]);
        headerSet.add(split[1]);
        continue;
      }
      row[header] = value;
      headerSet.add(header);
    }
    rows.push(row);
  }
  const headers = [...headerSet];
  const mapping = autoMap(headers);
  const result = buildProjections(rows, { mapping, totals: opts.totals, source: opts.source ?? 'yahoo', defaultGp: opts.defaultGp });
  // Attach Yahoo keys and drop players with no games (retired / no stats last season).
  const byName = new Map(players.map((p) => [normalizeName(p.name), p]));
  for (const proj of result.projections) {
    const yp = byName.get(normalizeName(proj.name));
    if (yp) {
      proj.yahooKey = yp.player_key;
      if (yp.draft_analysis) {
        proj.market = {
          avgCost: yp.draft_analysis.average_cost,
          avgPick: yp.draft_analysis.average_pick,
          pctDrafted: yp.draft_analysis.percent_drafted,
        };
      }
    }
  }
  return { projections: result.projections, warnings: result.warnings, headers, mapping: result.mapping as Record<string, string> };
}

/**
 * Column names for a composite "made/attempted" stat. Yahoo's display names
 * are "FGM/A" and "FTM/A" (the second half is just "A"), so derive the
 * attempts column from the made column; "FGM/FGA" style names pass through.
 */
export function compositeHeaders(header: string): [string, string] | undefined {
  const [h1, h2, ...rest] = header.split('/').map((s) => s.trim());
  if (!h1 || !h2 || rest.length) return undefined;
  if (/^a(tt)?$/i.test(h2)) return /m$/i.test(h1) ? [h1, h1.replace(/m$/i, 'A')] : undefined;
  return [h1, h2];
}

export function yahooPlayerId(p: YahooPlayer): string {
  return slug(p.name);
}
