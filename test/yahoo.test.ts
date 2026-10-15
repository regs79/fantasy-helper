import { describe, expect, it } from 'vitest';
import { asArray, dig, unwrap } from '../src/yahoo/normalize.js';
import { getDraftResults, getSettings, getTeams, parsePlayersPage, type YahooSettings } from '../src/yahoo/api.js';
import { compositeHeaders, yahooPlayersToProjections } from '../src/yahoo/projections.js';
import { accessHint } from '../src/yahoo/client.js';
import { authUrl } from '../src/yahoo/oauth.js';
import { configFromSettings } from '../src/yahoo/config.js';
import { applyDraftResults, linkTeams } from '../src/yahoo/sync.js';
import { newDraft } from '../src/draft/store.js';
import type { LeagueConfig } from '../src/engine/types.js';
import type { YahooClient } from '../src/yahoo/client.js';

// Shapes modeled on Yahoo's XML-to-JSON output.
const settingsRaw = {
  fantasy_content: {
    league: [
      { league_key: '466.l.1234', league_id: '1234', name: 'Old Timers', num_teams: 12, draft_status: 'predraft', season: '2026' },
      {
        settings: [
          {
            draft_type: 'auction',
            is_auction_draft: '1',
            stat_categories: {
              stats: [
                { stat: { stat_id: 9004003, name: 'Field Goals Made / Attempted', display_name: 'FGM/A', sort_order: '1', is_only_display_stat: '1' } },
                { stat: { stat_id: 4, name: 'Field Goals Made', display_name: 'FGM', sort_order: '1' } },
                { stat: { stat_id: 5, name: 'Field Goal Percentage', display_name: 'FG%', sort_order: '1' } },
                { stat: { stat_id: 9007006, name: 'Free Throws Made / Attempted', display_name: 'FTM/A', sort_order: '1', is_only_display_stat: '1' } },
                { stat: { stat_id: 8, name: 'Free Throw Percentage', display_name: 'FT%', sort_order: '1' } },
                { stat: { stat_id: 10, name: '3-point Shots Made', display_name: '3PTM', sort_order: '1' } },
                { stat: { stat_id: 12, name: 'Points Scored', display_name: 'PTS', sort_order: '1' } },
                { stat: { stat_id: 13, name: 'Offensive Rebounds', display_name: 'OREB', sort_order: '1' } },
                { stat: { stat_id: 14, name: 'Defensive Rebounds', display_name: 'DREB', sort_order: '1' } },
                { stat: { stat_id: 16, name: 'Assists', display_name: 'AST', sort_order: '1' } },
                { stat: { stat_id: 17, name: 'Steals', display_name: 'ST', sort_order: '1' } },
                { stat: { stat_id: 18, name: 'Blocked Shots', display_name: 'BLK', sort_order: '1' } },
                { stat: { stat_id: 20, name: 'Assist/Turnover Ratio', display_name: 'A/T', sort_order: '1' } },
              ],
            },
            roster_positions: [
              { roster_position: { position: 'G', position_type: 'P', count: 1 } },
              { roster_position: { position: 'F', position_type: 'P', count: 1 } },
              { roster_position: { position: 'C', position_type: 'P', count: 1 } },
              { roster_position: { position: 'Util', position_type: 'P', count: 3 } },
              { roster_position: { position: 'BN', count: 9 } },
              { roster_position: { position: 'IL', count: 2 } },
            ],
          },
        ],
      },
    ],
  },
};

const playersRaw = {
  fantasy_content: {
    league: [
      { league_key: '466.l.1234' },
      {
        players: {
          '0': {
            player: [
              [
                { player_key: '466.p.5583' },
                { player_id: '5583' },
                { name: { full: 'Nikola Jokić', first: 'Nikola', last: 'Jokić' } },
                { editorial_team_abbr: 'Den' },
                { display_position: 'C' },
                { eligible_positions: [{ position: 'C' }, { position: 'Util' }] },
              ],
              {
                player_stats: {
                  coverage_type: 'season',
                  season: '2025',
                  stats: [
                    { stat: { stat_id: '0', value: '70' } },
                    { stat: { stat_id: '2', value: '2450' } },
                    { stat: { stat_id: '9004003', value: '770/1350' } },
                    { stat: { stat_id: '5', value: '.570' } },
                    { stat: { stat_id: '9007006', value: '420/510' } },
                    { stat: { stat_id: '8', value: '.824' } },
                    { stat: { stat_id: '10', value: '91' } },
                    { stat: { stat_id: '12', value: '2051' } },
                    { stat: { stat_id: '13', value: '210' } },
                    { stat: { stat_id: '14', value: '658' } },
                    { stat: { stat_id: '16', value: '686' } },
                    { stat: { stat_id: '17', value: '105' } },
                    { stat: { stat_id: '18', value: '56' } },
                    { stat: { stat_id: '19', value: '231' } },
                    { stat: { stat_id: '20', value: '2.97' } },
                  ],
                },
              },
            ],
          },
          '1': {
            player: [
              [
                { player_key: '466.p.6014' },
                { player_id: '6014' },
                { name: { full: 'Shai Gilgeous-Alexander' } },
                { editorial_team_abbr: 'OKC' },
                { display_position: 'PG' },
                { eligible_positions: [{ position: 'PG' }, { position: 'G' }, { position: 'Util' }] },
              ],
              { draft_analysis: { average_pick: '2.1', average_round: '1.0', average_cost: '78.3', percent_drafted: '1.00' } },
            ],
          },
          count: 2,
        },
      },
    ],
  },
};

const teamsRaw = {
  fantasy_content: {
    league: [
      { league_key: '466.l.1234' },
      {
        teams: {
          '0': { team: [[{ team_key: '466.l.1234.t.1' }, { team_id: '1' }, { name: 'Craig' }, { is_owned_by_current_login: '1' }, { managers: [{ manager: { nickname: 'craig' } }] }]] },
          '1': { team: [[{ team_key: '466.l.1234.t.2' }, { team_id: '2' }, { name: 'Alice' }, { managers: [{ manager: { nickname: 'alice' } }] }]] },
          count: 2,
        },
      },
    ],
  },
};

const draftRaw = {
  fantasy_content: {
    league: [
      { league_key: '466.l.1234' },
      {
        draft_results: {
          '0': { draft_result: { pick: 1, round: 1, cost: '72', team_key: '466.l.1234.t.2', player_key: '466.p.5583' } },
          '1': { draft_result: { pick: 2, round: 1, cost: '60', team_key: '466.l.1234.t.1', player_key: '466.p.6014' } },
          '2': { draft_result: { pick: 3, round: 1, cost: '3', team_key: '466.l.1234.t.1', player_key: '466.p.9999' } },
          count: 3,
        },
      },
    ],
  },
};

function fakeClient(responses: Record<string, unknown>): YahooClient {
  return {
    get: async (resource) => {
      for (const [k, v] of Object.entries(responses)) if (resource.includes(k)) return unwrap(v as never);
      throw new Error(`no fake response for ${resource}`);
    },
    getRaw: async () => null,
  };
}

describe('unwrap', () => {
  it('merges arrays of objects, lists indexed collections, and keeps repeated keys as arrays', () => {
    const u = unwrap(playersRaw as never) as never;
    const players = asArray(dig(u, 'fantasy_content.league.players'));
    expect(players).toHaveLength(2);
    const stats = asArray(dig(players[0] as never, 'player.player_stats.stats.stat'));
    expect(stats).toHaveLength(15);
    expect(dig(players[0] as never, 'player.name.full')).toBe('Nikola Jokić');
    expect(asArray(dig(players[0] as never, 'player.eligible_positions.position'))).toEqual(['C', 'Util']);
  });
});

describe('api parsing', () => {
  it('parses settings', async () => {
    const s = await getSettings(fakeClient({ settings: settingsRaw }), '466.l.1234');
    expect(s.league.name).toBe('Old Timers');
    expect(s.is_auction_draft).toBe(true);
    expect(s.stat_categories.map((c) => c.display_name)).toContain('A/T');
    expect(s.stat_categories.find((c) => c.stat_id === '9004003')!.is_only_display_stat).toBe(true);
    expect(s.roster_positions.find((p) => p.position === 'BN')!.count).toBe(9);
  });

  it('parses players with stats and draft analysis', () => {
    const ps = parsePlayersPage(unwrap(playersRaw as never));
    expect(ps[0]!.name).toBe('Nikola Jokić');
    expect(ps[0]!.team).toBe('DEN');
    expect(ps[0]!.positions).toEqual(['C']);
    expect(ps[0]!.stats['9004003']).toBe('770/1350');
    expect(ps[1]!.draft_analysis!.average_cost).toBeCloseTo(78.3);
    expect(ps[1]!.positions).toEqual(['PG', 'G']);
  });

  it('parses teams and draft results', async () => {
    const teams = await getTeams(fakeClient({ teams: teamsRaw }), '466.l.1234');
    expect(teams.map((t) => t.name)).toEqual(['Craig', 'Alice']);
    expect(teams[0]!.is_owned_by_current_login).toBe(true);
    const results = await getDraftResults(fakeClient({ draftresults: draftRaw }), '466.l.1234');
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ pick: 1, cost: 72, team_key: '466.l.1234.t.2' });
  });
});

describe('yahoo stats -> projections', () => {
  it('splits composite columns and converts totals to per game', async () => {
    const s = await getSettings(fakeClient({ settings: settingsRaw }), '466.l.1234');
    const cats = [...s.stat_categories, { stat_id: '0', name: 'Games Played', display_name: 'GP', sort_order: '1', is_only_display_stat: true }, { stat_id: '2', name: 'Minutes Played', display_name: 'MIN', sort_order: '1', is_only_display_stat: true }, { stat_id: '19', name: 'Turnovers', display_name: 'TO', sort_order: '0', is_only_display_stat: true }];
    const ps = parsePlayersPage(unwrap(playersRaw as never));
    const conv = yahooPlayersToProjections(ps, cats, { totals: true });
    expect(conv.headers).toContain('FGM');
    expect(conv.headers).toContain('FGA');
    const j = conv.projections.find((p) => p.id === 'nikola-jokic')!;
    expect(j.yahooKey).toBe('466.p.5583');
    expect(j.gp).toBe(70);
    expect(j.fgm).toBeCloseTo(11);
    expect(j.fga).toBeCloseTo(1350 / 70);
    expect(j.ftm).toBeCloseTo(6);
    expect(j.pts).toBeCloseTo(2051 / 70);
    expect(j.oreb).toBeCloseTo(3);
    expect(j.tov).toBeCloseTo(3.3);
    expect(j.mpg).toBeCloseTo(35);
    expect(j.positions).toEqual(['C']);
    const sga = conv.projections.find((p) => p.id === 'shai-gilgeous-alexander')!;
    expect(sga.market?.avgCost).toBeCloseTo(78.3);
  });
});

describe('composite stat headers', () => {
  it('derives attempts from Yahoo\'s "FGM/A" names and passes explicit pairs through', () => {
    expect(compositeHeaders('FGM/A')).toEqual(['FGM', 'FGA']);
    expect(compositeHeaders('FTM/A')).toEqual(['FTM', 'FTA']);
    expect(compositeHeaders('3PTM/A')).toEqual(['3PTM', '3PTA']);
    expect(compositeHeaders('FGM/FGA')).toEqual(['FGM', 'FGA']);
    expect(compositeHeaders('A/T')).toEqual(['A', 'T']);
    expect(compositeHeaders('PTS')).toBeUndefined();
  });
});

describe('oauth and access errors', () => {
  it('sends no scope unless YAHOO_SCOPE is set', () => {
    const saved = { id: process.env.YAHOO_CLIENT_ID, secret: process.env.YAHOO_CLIENT_SECRET, scope: process.env.YAHOO_SCOPE };
    process.env.YAHOO_CLIENT_ID = 'test-id';
    process.env.YAHOO_CLIENT_SECRET = 'test-secret';
    delete process.env.YAHOO_SCOPE;
    try {
      const u = new URL(authUrl());
      expect(u.searchParams.get('redirect_uri')).toBe('oob');
      expect(u.searchParams.has('scope')).toBe(false);
      process.env.YAHOO_SCOPE = 'fspt-w';
      expect(new URL(authUrl()).searchParams.get('scope')).toBe('fspt-w');
    } finally {
      for (const [k, v] of [['YAHOO_CLIENT_ID', saved.id], ['YAHOO_CLIENT_SECRET', saved.secret], ['YAHOO_SCOPE', saved.scope]] as const) {
        if (v == null) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it('explains the unapproved-app 403', () => {
    // Trimmed from a real response, 2026-10-15.
    const body = JSON.stringify({ error: { 'xml:lang': 'en-us', 'yahoo:uri': '/fantasy/v2/game/nba?format=json', description: 'This application is not authorized to perform this action.', detail: '' } });
    expect(accessHint(403, body)).toContain('sports.yahoo.com/developer/access');
    expect(accessHint(401, 'oauth_problem="additional_authorization_required"')).toContain('entitlement');
    expect(accessHint(404, 'not found')).toBe('');
  });
});

describe('config from settings', () => {
  it('maps categories and roster slots', async () => {
    const s = await getSettings(fakeClient({ settings: settingsRaw }), '466.l.1234');
    const base: LeagueConfig = { teams: 10, budget: 200, categories: ['pts'], rosterSlots: [{ slot: 'Util', count: 1 }], slotEligibility: { Util: ['*'], G: ['PG', 'SG', 'G'] } };
    const { config, unmapped } = configFromSettings(s, base);
    expect(unmapped).toEqual([]);
    expect(config.teams).toBe(12);
    expect(config.categories).toEqual(['fgm', 'fg_pct', 'ft_pct', 'tpm', 'pts', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'ato']);
    expect(config.rosterSlots).toEqual([
      { slot: 'G', count: 1 }, { slot: 'F', count: 1 }, { slot: 'C', count: 1 }, { slot: 'Util', count: 3 }, { slot: 'BN', count: 9 }, { slot: 'IL', count: 2 },
    ]);
    expect(config.slotEligibility.IL).toEqual(['*']);
    expect(config.slotEligibility.G).toEqual(['PG', 'SG', 'G']);
  });
});

describe('draft sync', () => {
  const config: LeagueConfig = {
    teams: 2, budget: 200,
    categories: ['pts'],
    rosterSlots: [{ slot: 'Util', count: 3 }],
    slotEligibility: { Util: ['*'] },
  };

  it('links teams by name, then falls back to order', async () => {
    const teams = await getTeams(fakeClient({ teams: teamsRaw }), '466.l.1234');
    const byName = newDraft(config, { teamNames: ['alice', 'CRAIG'] });
    expect(linkTeams(byName, teams)).toEqual({ linked: 2, unmatched: [] });
    expect(byName.teams[0]!.yahooTeamKey).toBe('466.l.1234.t.2');
    const byOrder = newDraft(config, { teamNames: ['Team 1', 'Team 2'] });
    expect(linkTeams(byOrder, teams).linked).toBe(2);
    expect(byOrder.teams[0]!.name).toBe('Craig');
  });

  it('applies results once, matching players by key then by name', async () => {
    const results = await getDraftResults(fakeClient({ draftresults: draftRaw }), '466.l.1234');
    const state = newDraft(config, { teamNames: ['Craig', 'Alice'] });
    state.teams[0]!.yahooTeamKey = '466.l.1234.t.1';
    state.teams[1]!.yahooTeamKey = '466.l.1234.t.2';
    const players = new Map([
      ['466.p.5583', { player_key: '466.p.5583', name: 'Nikola Jokić' }],
      ['466.p.6014', { player_key: '466.p.6014', name: 'Shai Gilgeous-Alexander' }],
    ]);
    const projections = [
      { id: 'nikola-jokic', name: 'Nikola Jokic', positions: ['C'], gp: 70, mpg: 35, fgm: 0, fga: 0, ftm: 0, fta: 0, tpm: 0, pts: 29, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0 },
      { id: 'shai-gilgeous-alexander', name: 'Shai Gilgeous-Alexander', positions: ['PG'], gp: 70, mpg: 35, fgm: 0, fga: 0, ftm: 0, fta: 0, tpm: 0, pts: 29, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, yahooKey: '466.p.6014' },
    ];
    const r = applyDraftResults(state, results, players, projections, 3);
    expect(r.added).toBe(2);
    expect(r.skipped).toEqual([{ pick: 3, reason: 'unknown player 466.p.9999' }]);
    expect(state.picks.map((p) => [p.playerId, p.teamId, p.price, p.source, p.yahooPick])).toEqual([
      ['nikola-jokic', '2', 72, 'yahoo', 1],
      ['shai-gilgeous-alexander', '1', 60, 'yahoo', 2],
    ]);
    // Second run adds nothing new.
    players.set('466.p.9999', { player_key: '466.p.9999', name: 'Rookie Nobody' });
    const again = applyDraftResults(state, results, players, projections, 3);
    expect(again.added).toBe(1);
    expect(state.picks[2]!.playerName).toBe('Rookie Nobody');
    expect(applyDraftResults(state, results, players, projections, 3).added).toBe(0);
  });
});
