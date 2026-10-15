import { categoryDefs, stat } from './categories.js';
import type {
  CategoryDef,
  LeagueConfig,
  PlayerValue,
  PoolStats,
  Projection,
  ValueResult,
} from './types.js';

const DEFAULT_NON_DRAFT_SLOTS = ['IL', 'IL+', 'IR', 'NA'];

/** Number of draftable roster slots per team (IL-type slots excluded). */
export function draftSlotsPerTeam(config: LeagueConfig): number {
  const skip = new Set(config.nonDraftSlots ?? DEFAULT_NON_DRAFT_SLOTS);
  return config.rosterSlots.filter((s) => !skip.has(s.slot)).reduce((n, s) => n + s.count, 0);
}

/** Total draftable pool size: teams x draftable slots. */
export function poolSize(config: LeagueConfig): number {
  return config.teams * draftSlotsPerTeam(config);
}

function scaleOf(p: Projection, config: LeagueConfig): number {
  if ((config.basis ?? 'total') === 'perGame') return 1;
  const ref = config.gpReference ?? 82;
  const gp = Number.isFinite(p.gp) && p.gp > 0 ? p.gp : 0;
  return Math.min(gp, ref) / ref;
}

interface Contrib {
  /** Category key -> contribution on the chosen basis (counting stat, or ratio impact). */
  contrib: Record<string, number>;
  /** Category key -> scaled numerator/denominator for ratio cats (needed for pool ratios). */
  ratioParts: Record<string, { num: number; den: number }>;
}

/**
 * Contributions that do not depend on the pool (counting stats). Ratio impacts
 * depend on the pool average, so they are filled in per iteration.
 */
function countingContribs(p: Projection, defs: CategoryDef[], scale: number): Contrib {
  const contrib: Record<string, number> = {};
  const ratioParts: Record<string, { num: number; den: number }> = {};
  for (const d of defs) {
    if (d.kind === 'counting') {
      contrib[d.key] = stat(p, d.stat) * scale;
    } else {
      ratioParts[d.key] = { num: stat(p, d.num) * scale, den: stat(p, d.den) * scale };
    }
  }
  return { contrib, ratioParts };
}

function meanSd(xs: number[]): { mean: number; sd: number } {
  if (xs.length === 0) return { mean: 0, sd: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return { mean, sd: Math.sqrt(variance) };
}

/**
 * Compute per-category z-scores over the draftable pool.
 *
 * Counting categories: z of the (gp-scaled) per-game stat over the pool.
 * Ratio categories: volume-weighted impact `num - poolRatio * den`, where
 * poolRatio = sum(num) / sum(den) over the pool, then z of that impact.
 *
 * The pool starts as every player, then is narrowed to the top N by total
 * value and the stats are recomputed, for `poolIterations` rounds.
 * Pool membership always uses all categories, since the rest of the league
 * is not punting what you punt. Punts only change the `value` sum.
 */
export function computeValues(
  projections: Projection[],
  config: LeagueConfig,
  opts: { punt?: string[] } = {},
): ValueResult {
  const defs = categoryDefs(config.categories);
  const punted = new Set(opts.punt ?? []);
  const n = Math.min(poolSize(config), projections.length);
  const iterations = Math.max(1, config.poolIterations ?? 3);

  const base = projections.map((p) => ({
    p,
    scale: scaleOf(p, config),
    ...countingContribs(p, defs, scaleOf(p, config)),
  }));

  let poolIdx = base.map((_, i) => i);
  let pool: PoolStats = { cats: {}, poolSize: n };
  let zs: Record<string, number>[] = [];
  let contribs: Record<string, number>[] = [];

  for (let iter = 0; iter < iterations; iter++) {
    // Pool averages for ratio categories.
    const cats: PoolStats['cats'] = {};
    contribs = base.map((b) => ({ ...b.contrib }));
    for (const d of defs) {
      if (d.kind !== 'ratio') continue;
      let num = 0;
      let den = 0;
      for (const i of poolIdx) {
        const parts = base[i]!.ratioParts[d.key]!;
        num += parts.num;
        den += parts.den;
      }
      const poolRatio = den > 0 ? num / den : 0;
      base.forEach((b, i) => {
        const parts = b.ratioParts[d.key]!;
        contribs[i]![d.key] = parts.num - poolRatio * parts.den;
      });
      cats[d.key] = { mean: 0, sd: 0, poolRatio };
    }
    // Mean and sd over the pool for every category.
    for (const d of defs) {
      const xs = poolIdx.map((i) => contribs[i]![d.key]!);
      const { mean, sd } = meanSd(xs);
      cats[d.key] = { ...(cats[d.key] ?? {}), mean, sd };
    }
    zs = contribs.map((c) => {
      const z: Record<string, number> = {};
      for (const d of defs) {
        const { mean, sd } = cats[d.key]!;
        let v = sd > 0 ? (c[d.key]! - mean) / sd : 0;
        if (d.lowerIsBetter) v = -v;
        z[d.key] = v;
      }
      return z;
    });
    pool = { cats, poolSize: n };
    // Narrow the pool to the top N by all-category value.
    const totals = zs.map((z) => defs.reduce((s, d) => s + z[d.key]!, 0));
    poolIdx = base
      .map((_, i) => i)
      .sort((a, b) => totals[b]! - totals[a]!)
      .slice(0, n);
  }

  const inPool = new Set(poolIdx);
  const players: PlayerValue[] = base.map((b, i) => ({
    id: b.p.id,
    name: b.p.name,
    team: b.p.team,
    positions: b.p.positions,
    z: zs[i]!,
    contrib: contribs[i]!,
    value: sumValue(zs[i]!, defs, punted),
    rank: 0,
    inPool: inPool.has(i),
  }));
  players.sort((a, b) => b.value - a.value);
  players.forEach((p, i) => (p.rank = i + 1));
  return { players, pool, punted: [...punted] };
}

/** Sum z over the non-punted categories. Cheap enough to redo on every toggle. */
export function sumValue(
  z: Record<string, number>,
  defs: CategoryDef[] | string[],
  punted: Set<string> | string[],
): number {
  const puntSet = punted instanceof Set ? punted : new Set(punted);
  let total = 0;
  for (const d of defs) {
    const key = typeof d === 'string' ? d : d.key;
    if (puntSet.has(key)) continue;
    total += z[key] ?? 0;
  }
  return total;
}

/** Re-apply a punt set to already-computed values without touching the z-scores. */
export function applyPunts(result: ValueResult, punt: string[], categories: string[]): ValueResult {
  const punted = new Set(punt);
  const players = result.players
    .map((p) => ({ ...p, value: sumValue(p.z, categories, punted) }))
    .sort((a, b) => b.value - a.value)
    .map((p, i) => ({ ...p, rank: i + 1 }));
  return { players, pool: result.pool, punted: [...punted] };
}
