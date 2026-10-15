import { describe, expect, it } from 'vitest';
import {
  applyPunts,
  computeValues,
  maxBid,
  poolSize,
  priceRemaining,
  type LeagueConfig,
  type Projection,
} from '../src/engine/index.js';

const baseConfig: LeagueConfig = {
  teams: 2,
  budget: 100,
  categories: ['fgm', 'fg_pct', 'ft_pct', 'tpm', 'pts', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'ato'],
  rosterSlots: [
    { slot: 'G', count: 1 },
    { slot: 'Util', count: 1 },
    { slot: 'BN', count: 1 },
    { slot: 'IL', count: 1 },
  ],
  slotEligibility: { G: ['PG', 'SG', 'G'], Util: ['*'], BN: ['*'], IL: ['*'] },
  basis: 'perGame',
  poolIterations: 1,
};

function player(id: string, over: Partial<Projection> = {}): Projection {
  return {
    id,
    name: id,
    positions: ['G'],
    gp: 82,
    mpg: 30,
    fgm: 5,
    fga: 10,
    ftm: 2,
    fta: 2.5,
    tpm: 1,
    pts: 13,
    oreb: 1,
    dreb: 3,
    ast: 3,
    stl: 1,
    blk: 0.5,
    tov: 2,
    ...over,
  };
}

describe('pool size', () => {
  it('counts draftable slots only', () => {
    expect(poolSize(baseConfig)).toBe(2 * 3);
  });
});

describe('counting z-scores', () => {
  it('standardizes over the pool', () => {
    const config = { ...baseConfig, categories: ['pts'] };
    const ps = [player('a', { pts: 10 }), player('b', { pts: 20 }), player('c', { pts: 30 })];
    const { players, pool } = computeValues(ps, config);
    expect(pool.cats.pts!.mean).toBeCloseTo(20);
    expect(pool.cats.pts!.sd).toBeCloseTo(Math.sqrt(200 / 3));
    const byId = Object.fromEntries(players.map((p) => [p.id, p]));
    expect(byId.c!.z.pts).toBeCloseTo(10 / Math.sqrt(200 / 3));
    expect(byId.b!.z.pts).toBeCloseTo(0);
    expect(players[0]!.id).toBe('c');
    expect(players[0]!.rank).toBe(1);
  });

  it('flips sign for lower-is-better categories', () => {
    const config = { ...baseConfig, categories: ['tov'] };
    const ps = [player('a', { tov: 1 }), player('b', { tov: 2 }), player('c', { tov: 4 })];
    const { players } = computeValues(ps, config);
    expect(players[0]!.id).toBe('a');
    expect(players[0]!.z.tov).toBeGreaterThan(0);
  });

  it('scales by games played on the total basis', () => {
    const config: LeagueConfig = { ...baseConfig, categories: ['pts'], basis: 'total', gpReference: 82 };
    const ps = [player('full', { pts: 20, gp: 82 }), player('half', { pts: 20, gp: 41 }), player('c', { pts: 0 })];
    const { players } = computeValues(ps, config);
    const byId = Object.fromEntries(players.map((p) => [p.id, p]));
    expect(byId.full!.contrib.pts).toBeCloseTo(20);
    expect(byId.half!.contrib.pts).toBeCloseTo(10);
  });
});

describe('ratio categories are volume weighted', () => {
  it('a player at the pool average has zero impact at any volume', () => {
    const config = { ...baseConfig, categories: ['fg_pct'] };
    // Pool FG% = (5+10+1)/(10+20+2) = 0.5. Everyone is exactly 50%.
    const ps = [
      player('low', { fgm: 1, fga: 2 }),
      player('mid', { fgm: 5, fga: 10 }),
      player('high', { fgm: 10, fga: 20 }),
    ];
    const { players, pool } = computeValues(ps, config);
    expect(pool.cats.fg_pct!.poolRatio).toBeCloseTo(0.5);
    for (const p of players) expect(p.contrib.fg_pct).toBeCloseTo(0);
  });

  it('impact grows with volume at the same percentage', () => {
    const config = { ...baseConfig, categories: ['fg_pct'] };
    const ps = [
      player('anchor', { fgm: 5, fga: 10 }), // 50%
      player('lowvol', { fgm: 1.2, fga: 2 }), // 60%
      player('highvol', { fgm: 12, fga: 20 }), // 60%
      player('brick', { fgm: 3, fga: 10 }), // 30%
    ];
    const { players } = computeValues(ps, config);
    const byId = Object.fromEntries(players.map((p) => [p.id, p]));
    expect(byId.highvol!.contrib.fg_pct).toBeGreaterThan(byId.lowvol!.contrib.fg_pct);
    expect(byId.highvol!.z.fg_pct).toBeGreaterThan(byId.lowvol!.z.fg_pct);
    expect(byId.brick!.z.fg_pct).toBeLessThan(0);
  });

  it('uses total AST / total TOV for the A/T pool ratio', () => {
    const config = { ...baseConfig, categories: ['ato'] };
    const ps = [
      player('a', { ast: 8, tov: 4 }),
      player('b', { ast: 2, tov: 2 }),
      player('c', { ast: 2, tov: 0 }),
    ];
    const { pool, players } = computeValues(ps, config);
    // (8+2+2)/(4+2+0) = 2
    expect(pool.cats.ato!.poolRatio).toBeCloseTo(2);
    const byId = Object.fromEntries(players.map((p) => [p.id, p]));
    expect(byId.a!.contrib.ato).toBeCloseTo(8 - 2 * 4);
    expect(byId.b!.contrib.ato).toBeCloseTo(2 - 2 * 2);
    expect(byId.c!.contrib.ato).toBeCloseTo(2);
    expect(players[0]!.id).toBe('c');
  });
});

describe('punts', () => {
  const config = { ...baseConfig, categories: ['pts', 'blk'] };
  const ps = [
    player('scorer', { pts: 30, blk: 0 }),
    player('rim', { pts: 10, blk: 3 }),
    player('avg', { pts: 20, blk: 1 }),
  ];

  it('excludes punted categories from value but keeps the z-scores', () => {
    const full = computeValues(ps, config);
    const punted = computeValues(ps, config, { punt: ['blk'] });
    const fullById = Object.fromEntries(full.players.map((p) => [p.id, p]));
    const puntById = Object.fromEntries(punted.players.map((p) => [p.id, p]));
    expect(puntById.rim!.z.blk).toBeCloseTo(fullById.rim!.z.blk);
    expect(puntById.rim!.value).toBeCloseTo(fullById.rim!.z.pts);
    expect(punted.players[0]!.id).toBe('scorer');
    expect(punted.punted).toEqual(['blk']);
  });

  it('applyPunts matches recomputing with the punt', () => {
    const full = computeValues(ps, config);
    const direct = computeValues(ps, config, { punt: ['blk'] });
    const applied = applyPunts(full, ['blk'], config.categories);
    expect(applied.players.map((p) => [p.id, p.value.toFixed(6)])).toEqual(
      direct.players.map((p) => [p.id, p.value.toFixed(6)]),
    );
  });
});

describe('pool iteration', () => {
  it('flags exactly poolSize players as in the pool and recomputes over them', () => {
    const config: LeagueConfig = { ...baseConfig, categories: ['pts'], poolIterations: 3 };
    const ps = Array.from({ length: 20 }, (_, i) => player(`p${i}`, { pts: 30 - i }));
    const { players, pool } = computeValues(ps, config);
    expect(players.filter((p) => p.inPool)).toHaveLength(6);
    expect(pool.poolSize).toBe(6);
    // Pool after narrowing = pts 30..25, mean 27.5.
    expect(pool.cats.pts!.mean).toBeCloseTo(27.5);
    // Players outside the pool still get z-scores, relative to the pool.
    expect(players[19]!.z.pts).toBeLessThan(players[5]!.z.pts);
  });
});

describe('dollar pricing', () => {
  const values = Array.from({ length: 10 }, (_, i) => ({
    id: `p${i}`,
    name: `p${i}`,
    positions: [],
    z: {},
    contrib: {},
    value: 10 - i,
    rank: i + 1,
    inPool: i < 6,
  }));

  it('spends all the money across the pool with a $1 floor', () => {
    const r = priceRemaining(values, { slots: 6, money: 200 });
    const poolPrices = r.players.slice(0, 6).map((p) => p.price);
    expect(poolPrices.reduce((a, b) => a + b, 0)).toBeCloseTo(200);
    expect(r.replacement).toBe(values[6]!.value);
    for (const p of r.players) expect(p.price).toBeGreaterThanOrEqual(1);
    expect(r.players[7]!.price).toBe(1);
    expect(r.players[0]!.price).toBeGreaterThan(r.players[1]!.price);
  });

  it('inflates when a player goes for less than their price', () => {
    const before = priceRemaining(values, { slots: 6, money: 200 });
    const p0 = before.players[0]!;
    const bargain = p0.price - 20;
    const after = priceRemaining(values, { slots: 5, money: 200 - bargain, drafted: new Set(['p0']) });
    expect(after.players[0]!.id).toBe('p1');
    expect(after.players[0]!.price).toBeGreaterThan(before.players[1]!.price);
    const overpay = p0.price + 20;
    const deflated = priceRemaining(values, { slots: 5, money: 200 - overpay, drafted: new Set(['p0']) });
    expect(deflated.players[0]!.price).toBeLessThan(before.players[1]!.price);
  });

  it('handles an exhausted draft', () => {
    const r = priceRemaining(values, { slots: 0, money: 0 });
    expect(r.players.every((p) => p.price === 0)).toBe(true);
  });

  it('max bid leaves $1 for every other open slot', () => {
    expect(maxBid(50, 3)).toBe(48);
    expect(maxBid(50, 1)).toBe(50);
    expect(maxBid(0, 2)).toBe(0);
    expect(maxBid(50, 0)).toBe(0);
  });
});
