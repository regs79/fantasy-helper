import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, paths, readJson, readJsonOr, writeJson } from '../data.js';
import type { LeagueConfig, Projection } from '../engine/types.js';
import { draftSlotsPerTeam } from '../engine/values.js';
import { addPick, type DraftState } from '../draft/store.js';
import { normalizeName, slug } from '../projections/names.js';
import { getDraftResults, getGame, getPlayersByKeys, getTeams, resolveLeagueKey, type YahooDraftResult, type YahooPlayer, type YahooTeam } from './api.js';
import { createClient, type YahooClient } from './client.js';

export interface SyncResult {
  added: number;
  skipped: { pick: number; reason: string }[];
  total: number;
}

export interface PlayerRef {
  player_key: string;
  name: string;
}

/**
 * Pure core of the sync: apply Yahoo draft results to the draft state.
 * Teams are matched by stored Yahoo key; players by Yahoo key on the
 * projections, then by normalized name, else recorded by name only.
 */
export function applyDraftResults(
  state: DraftState,
  results: YahooDraftResult[],
  players: Map<string, PlayerRef>,
  projections: Projection[],
  slotsPerTeam: number,
): SyncResult {
  const done = new Set(state.picks.filter((p) => p.yahooPick != null).map((p) => p.yahooPick));
  const teamByKey = new Map(state.teams.filter((t) => t.yahooTeamKey).map((t) => [t.yahooTeamKey!, t]));
  const projByKey = new Map(projections.filter((p) => p.yahooKey).map((p) => [p.yahooKey!, p]));
  const projByName = new Map(projections.map((p) => [normalizeName(p.name), p]));
  const result: SyncResult = { added: 0, skipped: [], total: results.length };
  for (const r of results) {
    if (done.has(r.pick)) continue;
    const team = teamByKey.get(r.team_key);
    if (!team) {
      result.skipped.push({ pick: r.pick, reason: `no local team for ${r.team_key}` });
      continue;
    }
    const ref = players.get(r.player_key);
    const proj = projByKey.get(r.player_key) ?? (ref ? projByName.get(normalizeName(ref.name)) : undefined);
    const playerName = proj?.name ?? ref?.name;
    if (!playerName) {
      result.skipped.push({ pick: r.pick, reason: `unknown player ${r.player_key}` });
      continue;
    }
    try {
      addPick(
        state,
        { playerId: proj?.id ?? slug(playerName), playerName, teamId: team.id, price: Math.round(r.cost ?? 0), source: 'yahoo', yahooPick: r.pick },
        slotsPerTeam,
      );
      result.added++;
    } catch (err) {
      result.skipped.push({ pick: r.pick, reason: (err as Error).message });
    }
  }
  return result;
}

/** Pair local teams with Yahoo teams: by stored key, then by name, then by order. */
export function linkTeams(state: DraftState, yahooTeams: YahooTeam[]): { linked: number; unmatched: string[] } {
  const used = new Set(state.teams.map((t) => t.yahooTeamKey).filter(Boolean));
  let linked = 0;
  const unmatched: string[] = [];
  for (const t of state.teams) {
    if (t.yahooTeamKey) {
      linked++;
      continue;
    }
    const byName = yahooTeams.find((y) => !used.has(y.team_key) && normalizeName(y.name) === normalizeName(t.name));
    if (byName) {
      t.yahooTeamKey = byName.team_key;
      used.add(byName.team_key);
      linked++;
    }
  }
  // Order fallback only when nothing matched by name and counts agree.
  if (linked === 0 && state.teams.length === yahooTeams.length) {
    state.teams.forEach((t, i) => {
      t.yahooTeamKey = yahooTeams[i]!.team_key;
      t.name = yahooTeams[i]!.name;
    });
    linked = state.teams.length;
  }
  for (const t of state.teams) if (!t.yahooTeamKey) unmatched.push(t.name);
  return { linked, unmatched };
}

export interface LeagueInfoFile {
  league_key: string;
  name?: string;
  game_key?: string;
}

export async function currentLeagueKey(client: YahooClient, override?: string): Promise<string> {
  if (override) return override.includes('.l.') ? override : resolveLeagueKey(client, override, (await getGame(client)).game_key);
  const saved = await readJsonOr<LeagueInfoFile | null>(path.join(paths.yahooDir(), 'league.json'), null);
  if (saved?.league_key) return saved.league_key;
  const env = process.env.YAHOO_LEAGUE_ID;
  const game = await getGame(client);
  return resolveLeagueKey(client, env, game.game_key);
}

export async function loadPlayerCache(): Promise<Map<string, PlayerRef>> {
  const file = path.join(paths.yahooDir(), 'players-raw.json');
  const list = await readJsonOr<YahooPlayer[]>(file, []);
  return new Map(list.map((p) => [p.player_key, { player_key: p.player_key, name: p.name }]));
}

/** Full sync against the live API: used by the board's Sync button and `fh yahoo sync`. */
export async function syncDraftFromYahoo(
  state: DraftState,
  projections: Projection[],
  config: LeagueConfig,
  deps: { client?: YahooClient; leagueKey?: string } = {},
): Promise<SyncResult & { leagueKey: string }> {
  const client = deps.client ?? createClient();
  const leagueKey = deps.leagueKey ?? state.yahooLeagueKey ?? (await currentLeagueKey(client));
  state.yahooLeagueKey = leagueKey;
  if (state.teams.some((t) => !t.yahooTeamKey)) {
    const { unmatched } = linkTeams(state, await getTeams(client, leagueKey));
    if (unmatched.length) console.warn(`Teams not linked to Yahoo: ${unmatched.join(', ')}`);
  }
  const results = await getDraftResults(client, leagueKey);
  const players = await loadPlayerCache();
  const missing = [...new Set(results.map((r) => r.player_key))].filter((k) => !players.has(k));
  if (missing.length) {
    for (const p of await getPlayersByKeys(client, leagueKey, missing)) players.set(p.player_key, { player_key: p.player_key, name: p.name });
    const file = path.join(paths.yahooDir(), 'players-raw.json');
    if (existsSync(file)) {
      const list = await readJson<YahooPlayer[]>(file);
      const have = new Set(list.map((p) => p.player_key));
      for (const k of missing) {
        const ref = players.get(k);
        if (ref && !have.has(k)) list.push({ player_key: k, player_id: k.split('.').pop() ?? '', name: ref.name, team: '', positions: [], stats: {} });
      }
      await writeJson(file, list);
    }
  }
  const result = applyDraftResults(state, results, players, projections, draftSlotsPerTeam(await Promise.resolve(config ?? loadConfig())));
  return { ...result, leagueKey };
}
