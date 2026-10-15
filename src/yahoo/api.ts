import type { YahooClient } from './client.js';
import { asArray, dig, type Json } from './normalize.js';

type Obj = Record<string, Json>;
const obj = (v: Json | undefined): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: Json | undefined): string => (v == null ? '' : String(v));
const num = (v: Json | undefined): number => (v == null || v === '' ? 0 : Number(v));

export interface YahooGame {
  game_key: string;
  season: string;
  code: string;
}

export async function getGame(client: YahooClient, code = 'nba'): Promise<YahooGame> {
  const g = obj(dig(await client.get(`game/${code}`), 'fantasy_content.game'));
  return { game_key: str(g.game_key), season: str(g.season), code: str(g.code) };
}

export interface YahooLeague {
  league_key: string;
  league_id: string;
  name: string;
  num_teams: number;
  draft_status: string;
  season: string;
}

function leagueFrom(l: Obj): YahooLeague {
  return {
    league_key: str(l.league_key),
    league_id: str(l.league_id),
    name: str(l.name),
    num_teams: num(l.num_teams),
    draft_status: str(l.draft_status),
    season: str(l.season),
  };
}

export async function getUserLeagues(client: YahooClient, gameKey: string): Promise<YahooLeague[]> {
  const data = await client.get(`users;use_login=true/games;game_keys=${gameKey}/leagues`);
  const games = asArray<Json>(dig(data, 'fantasy_content.users.0.user.games'));
  const out: YahooLeague[] = [];
  for (const g of games) {
    for (const l of asArray<Json>(dig(obj(g), 'game.leagues'))) out.push(leagueFrom(obj(dig(obj(l), 'league'))));
  }
  return out;
}

/** Resolve a league reference: a full key, a numeric id (needs the game key), or the only league. */
export async function resolveLeagueKey(client: YahooClient, ref: string | undefined, gameKey: string): Promise<string> {
  if (ref && ref.includes('.l.')) return ref;
  if (ref && /^\d+$/.test(ref)) return `${gameKey}.l.${ref}`;
  const leagues = await getUserLeagues(client, gameKey);
  if (leagues.length === 1) return leagues[0]!.league_key;
  if (leagues.length === 0) throw new Error('No leagues found for this Yahoo account in the current NBA game');
  throw new Error(`Several leagues; pass --league <id>: ${leagues.map((l) => `${l.league_id}=${l.name}`).join(', ')}`);
}

export interface YahooStatCategory {
  stat_id: string;
  name: string;
  display_name: string;
  sort_order: string;
  is_only_display_stat: boolean;
}

export interface YahooRosterPosition {
  position: string;
  position_type: string;
  count: number;
}

export interface YahooSettings {
  league: YahooLeague;
  draft_type: string;
  is_auction_draft: boolean;
  /** Auction budget per team when Yahoo exposes it; else undefined. */
  budget?: number;
  stat_categories: YahooStatCategory[];
  roster_positions: YahooRosterPosition[];
  raw: Json;
}

export async function getSettings(client: YahooClient, leagueKey: string): Promise<YahooSettings> {
  const data = await client.get(`league/${leagueKey}/settings`);
  const league = obj(dig(data, 'fantasy_content.league'));
  const settings = obj(league.settings);
  const stats = asArray<Json>(dig(settings, 'stat_categories.stats.stat')).map((s) => {
    const o = obj(s);
    return {
      stat_id: str(o.stat_id),
      name: str(o.name),
      display_name: str(o.display_name),
      sort_order: str(o.sort_order),
      is_only_display_stat: str(o.is_only_display_stat) === '1',
    };
  });
  const positions = asArray<Json>(dig(settings, 'roster_positions.roster_position')).map((p) => {
    const o = obj(p);
    return { position: str(o.position), position_type: str(o.position_type), count: num(o.count) };
  });
  const budgetRaw = settings.auction_budget ?? settings.max_budget ?? settings.draft_budget ?? league.auction_budget;
  return {
    league: leagueFrom(league),
    draft_type: str(settings.draft_type),
    is_auction_draft: str(settings.is_auction_draft) === '1' || str(settings.draft_type) === 'auction',
    budget: budgetRaw != null && budgetRaw !== '' ? num(budgetRaw) : undefined,
    stat_categories: stats,
    roster_positions: positions,
    raw: data,
  };
}

export interface YahooTeam {
  team_key: string;
  team_id: string;
  name: string;
  manager: string;
  is_owned_by_current_login: boolean;
}

export async function getTeams(client: YahooClient, leagueKey: string): Promise<YahooTeam[]> {
  const data = await client.get(`league/${leagueKey}/teams`);
  return asArray<Json>(dig(data, 'fantasy_content.league.teams')).map((t) => {
    const o = obj(dig(obj(t), 'team'));
    const managers = asArray<Json>(dig(o, 'managers.manager'));
    const mine = str(o.is_owned_by_current_login) === '1' || managers.some((m) => str(obj(m).is_current_login) === '1');
    return {
      team_key: str(o.team_key),
      team_id: str(o.team_id),
      name: str(o.name),
      manager: managers.map((m) => str(obj(m).nickname)).filter(Boolean).join(', '),
      is_owned_by_current_login: mine,
    };
  });
}

export interface YahooPlayer {
  player_key: string;
  player_id: string;
  name: string;
  team: string;
  positions: string[];
  status?: string;
  /** stat_id -> raw value string, e.g. "0.512" or "350/720". */
  stats: Record<string, string>;
  draft_analysis?: { average_pick?: number; average_round?: number; average_cost?: number; percent_drafted?: number };
}

function playerFrom(p: Obj): YahooPlayer {
  const name = obj(p.name);
  const stats: Record<string, string> = {};
  for (const s of asArray<Json>(dig(p, 'player_stats.stats.stat'))) {
    const o = obj(s);
    stats[str(o.stat_id)] = str(o.value);
  }
  const da = p.draft_analysis ? obj(p.draft_analysis) : undefined;
  const positions = asArray<Json>(dig(p, 'eligible_positions.position')).map((x) => str(x)).filter((x) => x && x !== 'Util' && !/^(BN|IL)/.test(x));
  return {
    player_key: str(p.player_key),
    player_id: str(p.player_id),
    name: str(name.full) || `${str(name.first)} ${str(name.last)}`.trim(),
    team: str(p.editorial_team_abbr).toUpperCase(),
    positions: positions.length ? positions : str(p.display_position).split(',').map((s) => s.trim()).filter(Boolean),
    status: p.status != null ? str(p.status) : undefined,
    stats,
    draft_analysis: da
      ? {
          average_pick: da.average_pick !== '-' ? num(da.average_pick) : undefined,
          average_round: da.average_round !== '-' ? num(da.average_round) : undefined,
          average_cost: da.average_cost !== '-' ? num(da.average_cost) : undefined,
          percent_drafted: da.percent_drafted !== '-' ? num(da.percent_drafted) : undefined,
        }
      : undefined,
  };
}

export function parsePlayersPage(data: Json): YahooPlayer[] {
  const players = asArray<Json>(dig(data, 'fantasy_content.league.players'));
  return players.map((p) => playerFrom(obj(dig(obj(p), 'player'))));
}

export interface PlayersOptions {
  /** Stats season, e.g. "2025" for the 2025-26 season. */
  season?: string;
  /** "season" (totals) or "average_season" (per game). */
  statType?: string;
  /** Stop after this many players. */
  max?: number;
  /** Yahoo player status filter: A (available), T (taken), ALL. */
  status?: string;
  /** Also pull draft_analysis (second request per page). */
  draftAnalysis?: boolean;
  onPage?: (fetched: number) => void;
}

/** Pull players 25 at a time with last-season stats and (optionally) draft analysis. */
export async function getPlayers(client: YahooClient, leagueKey: string, opts: PlayersOptions = {}): Promise<YahooPlayer[]> {
  const pageSize = 25;
  const max = opts.max ?? 600;
  const statType = opts.statType ?? 'season';
  const seasonPart = opts.season ? `;season=${opts.season}` : '';
  const statusPart = opts.status ? `;status=${opts.status}` : '';
  const byKey = new Map<string, YahooPlayer>();
  for (let start = 0; start < max; start += pageSize) {
    const base = `league/${leagueKey}/players${statusPart};sort=OR;start=${start};count=${pageSize}`;
    const page = parsePlayersPage(await client.get(`${base}/stats;type=${statType}${seasonPart}`));
    if (page.length === 0) break;
    for (const p of page) byKey.set(p.player_key, p);
    if (opts.draftAnalysis) {
      for (const p of parsePlayersPage(await client.get(`${base}/draft_analysis`))) {
        const existing = byKey.get(p.player_key);
        if (existing) existing.draft_analysis = p.draft_analysis;
      }
    }
    opts.onPage?.(byKey.size);
    if (page.length < pageSize) break;
  }
  return [...byKey.values()];
}

/** Fetch specific players by key (names for draft results that are not in the cache). */
export async function getPlayersByKeys(client: YahooClient, leagueKey: string, keys: string[]): Promise<YahooPlayer[]> {
  const out: YahooPlayer[] = [];
  for (let i = 0; i < keys.length; i += 25) {
    const chunk = keys.slice(i, i + 25);
    out.push(...parsePlayersPage(await client.get(`league/${leagueKey}/players;player_keys=${chunk.join(',')}`)));
  }
  return out;
}

export interface YahooDraftResult {
  pick: number;
  round: number;
  cost?: number;
  team_key: string;
  player_key: string;
}

export async function getDraftResults(client: YahooClient, leagueKey: string): Promise<YahooDraftResult[]> {
  const data = await client.get(`league/${leagueKey}/draftresults`);
  return asArray<Json>(dig(data, 'fantasy_content.league.draft_results'))
    .map((r) => obj(dig(obj(r), 'draft_result')))
    .filter((o) => o.player_key)
    .map((o) => ({
      pick: num(o.pick),
      round: num(o.round),
      cost: o.cost != null && o.cost !== '' ? num(o.cost) : undefined,
      team_key: str(o.team_key),
      player_key: str(o.player_key),
    }))
    .sort((a, b) => a.pick - b.pick);
}
