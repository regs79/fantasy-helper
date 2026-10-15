import { existsSync } from 'node:fs';
import { loadConfig, loadProjections, paths, readJson, writeJson } from '../data.js';
import { computeValues } from '../engine/values.js';
import type { LeagueConfig, Projection, ValueResult } from '../engine/types.js';
import { normalizeName } from '../projections/names.js';
import type { DraftState } from './store.js';

export interface Session {
  config: LeagueConfig;
  projections: Projection[];
  values: ValueResult;
  state: DraftState;
}

export async function loadDraftState(): Promise<DraftState> {
  const file = paths.draft();
  if (!existsSync(file)) throw new Error(`No draft at ${file}. Run: ./fh draft new`);
  return readJson<DraftState>(file);
}

export async function saveDraftState(state: DraftState): Promise<void> {
  await writeJson(paths.draft(), state);
}

/** Load config, projections, values, and draft state together. */
export async function loadSession(opts: { requireDraft?: boolean } = {}): Promise<Session> {
  const config = await loadConfig();
  const { projections } = await loadProjections();
  const values = computeValues(projections, config);
  let state: DraftState;
  if (existsSync(paths.draft())) state = await readJson<DraftState>(paths.draft());
  else if (opts.requireDraft === false) state = { version: 1, createdAt: '', updatedAt: '', teams: [], picks: [], punts: [] };
  else throw new Error(`No draft at ${paths.draft()}. Run: ./fh draft new`);
  return { config, projections, values, state };
}

export interface PlayerMatch {
  id: string;
  name: string;
  team?: string;
  positions: string[];
}

/** Find a player by id, exact name, name prefix, or substring. Throws when ambiguous. */
export function findPlayer<T extends PlayerMatch>(players: T[], query: string): T {
  const q = query.trim();
  const byId = players.find((p) => p.id === q);
  if (byId) return byId;
  const matches = searchPlayers(players, q);
  if (matches.length === 1) return matches[0]!;
  const n = normalizeName(q);
  const exact = matches.filter((p) => normalizeName(p.name) === n);
  if (exact.length === 1) return exact[0]!;
  if (matches.length === 0) throw new Error(`No player matches "${query}"`);
  throw new Error(`"${query}" matches several players: ${matches.slice(0, 6).map((p) => p.name).join(', ')}`);
}

/** Rank matches: exact, then prefix, then every query word found, then substring. */
export function searchPlayers<T extends PlayerMatch>(players: T[], query: string, limit = 50): T[] {
  const n = normalizeName(query);
  if (!n) return players.slice(0, limit);
  const words = n.split(' ');
  const scored: { p: T; score: number }[] = [];
  for (const p of players) {
    const name = normalizeName(p.name);
    let score = 0;
    if (name === n) score = 4;
    else if (name.startsWith(n)) score = 3;
    else if (words.every((w) => name.split(' ').some((part) => part.startsWith(w)))) score = 2;
    else if (name.includes(n)) score = 1;
    if (score) scored.push({ p, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.p);
}
