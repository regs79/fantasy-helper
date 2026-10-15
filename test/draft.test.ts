import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { computeValues, type LeagueConfig } from '../src/engine/index.js';
import { importCsvText } from '../src/projections/index.js';
import { addPick, assignLineup, buildBoard, findTeam, newDraft, removePick, setMe, undoPick } from '../src/draft/index.js';
import { findPlayer, searchPlayers } from '../src/draft/session.js';

const config: LeagueConfig = {
  teams: 3,
  budget: 100,
  categories: ['fgm', 'fg_pct', 'ft_pct', 'tpm', 'pts', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'ato'],
  rosterSlots: [
    { slot: 'G', count: 1 },
    { slot: 'F', count: 1 },
    { slot: 'C', count: 1 },
    { slot: 'Util', count: 1 },
    { slot: 'BN', count: 1 },
    { slot: 'IL', count: 1 },
  ],
  slotEligibility: {
    G: ['PG', 'SG', 'G'], F: ['SF', 'PF', 'F'], C: ['C'], Util: ['*'], BN: ['*'], IL: ['*'],
  },
  basis: 'total',
  gpReference: 82,
};

async function sample() {
  const text = await readFile(new URL('../samples/projections-sample.csv', import.meta.url), 'utf8');
  return importCsvText(text).projections;
}

describe('draft store', () => {
  it('creates teams and finds them by id, name, or prefix', () => {
    const s = newDraft(config, { teamNames: ['Alpha Dogs', 'Beta Boys', 'Gamma'], me: 'beta' });
    expect(s.teams).toHaveLength(3);
    expect(findTeam(s, '1').name).toBe('Alpha Dogs');
    expect(findTeam(s, 'gamma').id).toBe('3');
    expect(findTeam(s, 'Beta').isMe).toBe(true);
    expect(() => findTeam(s, 'a')).toThrow(/several/);
    expect(() => findTeam(s, 'zzz')).toThrow(/No team/);
    setMe(s, '1');
    expect(s.teams.filter((t) => t.isMe).map((t) => t.id)).toEqual(['1']);
  });

  it('rejects wrong team count', () => {
    expect(() => newDraft(config, { teamNames: ['a'] })).toThrow(/3 teams/);
  });

  it('adds, validates, undoes, and removes picks', () => {
    const s = newDraft(config);
    const slots = 5;
    const p1 = addPick(s, { playerName: 'Nikola Jokic', teamId: '1', price: 60 }, slots);
    expect(p1.n).toBe(1);
    expect(p1.playerId).toBe('nikola-jokic');
    expect(() => addPick(s, { playerName: 'Nikola Jokić', teamId: '2', price: 1 }, slots)).toThrow(/already drafted/);
    // Team 1 has $40 left and 4 slots: max bid 37.
    expect(() => addPick(s, { playerName: 'X', teamId: '1', price: 38 }, slots)).toThrow(/at most \$37/);
    addPick(s, { playerName: 'X', teamId: '1', price: 37 }, slots);
    expect(() => addPick(s, { playerName: 'Y', teamId: '1', price: 1.5 }, slots)).toThrow(/whole number/);
    expect(undoPick(s)?.playerName).toBe('X');
    addPick(s, { playerName: 'A', teamId: '2', price: 10 }, slots);
    addPick(s, { playerName: 'B', teamId: '2', price: 10 }, slots);
    expect(removePick(s, 2)?.playerName).toBe('A');
    expect(s.picks.map((p) => p.n)).toEqual([1, 2]);
    expect(s.picks[1]!.playerName).toBe('B');
  });

  it('refuses picks on a full roster', () => {
    const s = newDraft(config);
    for (let i = 0; i < 5; i++) addPick(s, { playerName: `P${i}`, teamId: '1', price: 1 }, 5);
    expect(() => addPick(s, { playerName: 'P9', teamId: '1', price: 1 }, 5)).toThrow(/no open roster slots/);
  });
});

describe('lineup assignment', () => {
  it('puts restrictive positions in their slots first', () => {
    const lineup = assignLineup(config, [
      { id: 'u', name: 'Util Guy', positions: ['PG', 'SG'] },
      { id: 'c', name: 'Center', positions: ['C'] },
      { id: 'pf', name: 'Forward', positions: ['PF', 'C'] },
      { id: 'g', name: 'Guard', positions: ['G'] },
    ]);
    const bySlot = Object.fromEntries(lineup.map((l) => [l.slot + (l.slot === 'BN' || l.slot === 'IL' ? '' : ''), l.playerName]));
    expect(bySlot.C).toBe('Center');
    expect(bySlot.F).toBe('Forward');
    expect(['Util Guy', 'Guard']).toContain(bySlot.G);
    expect(lineup.map((l) => l.slot)).toEqual(['G', 'F', 'C', 'Util', 'BN', 'IL']);
    expect(lineup.filter((l) => l.playerName)).toHaveLength(4);
  });
});

describe('player search', () => {
  it('finds by exact, prefix, word, substring; errors when ambiguous', async () => {
    const ps = await sample();
    expect(findPlayer(ps, 'nikola jokic').id).toBe('nikola-jokic');
    expect(findPlayer(ps, 'Jokic').id).toBe('nikola-jokic');
    expect(findPlayer(ps, 'shai g').id).toBe('shai-gilgeous-alexander');
    expect(findPlayer(ps, 'jaren jackson').id).toBe('jaren-jackson');
    expect(() => findPlayer(ps, 'ja')).toThrow(/several/);
    expect(() => findPlayer(ps, 'nobody here')).toThrow(/No player/);
    expect(searchPlayers(ps, 'j w')[0]!.name).toBe('Jalen Williams');
  });
});

describe('board', () => {
  it('prices, budgets, inflation, and my profile', async () => {
    const projections = await sample();
    const values = computeValues(projections, config);
    const state = newDraft(config, { me: '1' });
    const slots = 5;
    const before = buildBoard({ state, projections, values, config });
    expect(before.pricing.money).toBe(300);
    expect(before.pricing.slots).toBe(15);
    expect(before.pricing.inflation).toBeCloseTo(1);
    const poolPrices = before.players.filter((p) => p.inPool !== undefined).slice(0, 15).map((p) => p.price);
    expect(poolPrices.reduce((a, b) => a + b, 0)).toBeCloseTo(300);
    const top = before.players[0]!;
    expect(top.basePrice).toBeCloseTo(top.price);

    // Bargain on the top player => inflation for the rest.
    const bargain = Math.max(1, Math.round(top.price) - 15);
    addPick(state, { playerId: top.id, playerName: top.name, teamId: '2', price: bargain }, slots);
    const after = buildBoard({ state, projections, values, config });
    expect(after.pricing.inflation).toBeGreaterThan(1);
    expect(after.pricing.money).toBe(300 - bargain);
    expect(after.players.find((p) => p.id === top.id)!.drafted).toMatchObject({ teamId: '2', price: bargain, n: 1 });
    expect(after.players[0]!.id).not.toBe(top.id);
    expect(after.players[0]!.price).toBeGreaterThan(after.players[0]!.basePrice);

    const t2 = after.teams.find((t) => t.id === '2')!;
    expect(t2.spent).toBe(bargain);
    expect(t2.openSlots).toBe(4);
    expect(t2.maxBid).toBe(100 - bargain - 3);
    expect(t2.catRank.pts).toBe(1);

    // My team: pick a center, check the profile.
    const sabonis = projections.find((p) => p.id === 'domantas-sabonis')!;
    addPick(state, { playerId: sabonis.id, playerName: sabonis.name, teamId: '1', price: 30 }, slots);
    const mine = buildBoard({ state, projections, values, config }).me!;
    expect(mine.id).toBe('1');
    expect(mine.lineup.find((l) => l.slot === 'C')?.playerName).toBe('Domantas Sabonis');
    const fg = mine.profile.find((c) => c.key === 'fg_pct')!;
    expect(fg.display).toBe('59.0%');
    expect(mine.profile.find((c) => c.key === 'ato')!.display).toBe((6.4 / 3.1).toFixed(2));
    expect(mine.profile.find((c) => c.key === 'oreb')!.z).toBeGreaterThan(0);
  });

  it('keeps unknown drafted players on the board with no value', async () => {
    const projections = await sample();
    const values = computeValues(projections, config);
    const state = newDraft(config);
    addPick(state, { playerName: 'Random Rookie', teamId: '3', price: 2 }, 5);
    const board = buildBoard({ state, projections, values, config });
    const rookie = board.players.find((p) => p.id === 'random-rookie')!;
    expect(rookie.drafted?.price).toBe(2);
    expect(rookie.value).toBe(0);
    expect(board.recentPicks[0]!.teamName).toBe('Team 3');
  });

  it('applies punts from the draft state', async () => {
    const projections = await sample();
    const values = computeValues(projections, config);
    const state = newDraft(config);
    state.punts = ['ft_pct', 'ato'];
    const board = buildBoard({ state, projections, values, config });
    expect(board.punts).toEqual(['ft_pct', 'ato']);
    const giannis = board.players.find((p) => p.id === 'giannis-antetokounmpo')!;
    expect(giannis.value).toBeCloseTo(
      config.categories.filter((c) => c !== 'ft_pct' && c !== 'ato').reduce((s, c) => s + giannis.z[c]!, 0),
    );
  });
});
