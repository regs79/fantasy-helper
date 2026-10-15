import type { LeagueConfig } from '../engine/types.js';
import { normalizeName, slug } from '../projections/names.js';

export interface DraftTeam {
  id: string;
  name: string;
  budget: number;
  isMe?: boolean;
  yahooTeamKey?: string;
}

export interface DraftPick {
  n: number;
  playerId: string;
  playerName: string;
  teamId: string;
  price: number;
  at: string;
  source: 'manual' | 'yahoo';
  /** Yahoo pick number, used to de-duplicate synced results. */
  yahooPick?: number;
}

export interface DraftState {
  version: 1;
  createdAt: string;
  updatedAt: string;
  teams: DraftTeam[];
  picks: DraftPick[];
  punts: string[];
  yahooLeagueKey?: string;
}

export function newDraft(config: LeagueConfig, opts: { teamNames?: string[]; me?: string } = {}): DraftState {
  const names = opts.teamNames?.length
    ? opts.teamNames
    : Array.from({ length: config.teams }, (_, i) => `Team ${i + 1}`);
  if (names.length !== config.teams) {
    throw new Error(`League config has ${config.teams} teams but ${names.length} names were given`);
  }
  const teams: DraftTeam[] = names.map((name, i) => ({ id: String(i + 1), name: name.trim(), budget: config.budget }));
  const now = new Date().toISOString();
  const state: DraftState = { version: 1, createdAt: now, updatedAt: now, teams, picks: [], punts: [] };
  if (opts.me) setMe(state, opts.me);
  return state;
}

export function setMe(state: DraftState, team: string): DraftTeam {
  const t = findTeam(state, team);
  for (const other of state.teams) other.isMe = other.id === t.id;
  return t;
}

export function myTeam(state: DraftState): DraftTeam | undefined {
  return state.teams.find((t) => t.isMe);
}

/** Find a team by id, 1-based index, exact name, or unique name prefix / substring. */
export function findTeam(state: DraftState, ref: string): DraftTeam {
  const q = ref.trim();
  const byId = state.teams.find((t) => t.id === q);
  if (byId) return byId;
  const n = normalizeName(q);
  const exact = state.teams.find((t) => normalizeName(t.name) === n);
  if (exact) return exact;
  const partial = state.teams.filter((t) => normalizeName(t.name).includes(n));
  if (partial.length === 1) return partial[0]!;
  if (partial.length > 1) throw new Error(`"${ref}" matches several teams: ${partial.map((t) => t.name).join(', ')}`);
  throw new Error(`No team "${ref}". Teams: ${state.teams.map((t) => `${t.id}=${t.name}`).join(', ')}`);
}

export function teamSpent(state: DraftState, teamId: string): number {
  return state.picks.filter((p) => p.teamId === teamId).reduce((s, p) => s + p.price, 0);
}

export function teamPickCount(state: DraftState, teamId: string): number {
  return state.picks.filter((p) => p.teamId === teamId).length;
}

export interface AddPickInput {
  playerId?: string;
  playerName: string;
  teamId: string;
  price: number;
  source?: 'manual' | 'yahoo';
  yahooPick?: number;
}

/** Validate and append a pick. Throws on an already-drafted player, overspend, or full roster. */
export function addPick(state: DraftState, input: AddPickInput, slotsPerTeam: number): DraftPick {
  const team = state.teams.find((t) => t.id === input.teamId);
  if (!team) throw new Error(`Unknown team id ${input.teamId}`);
  const playerId = input.playerId ?? slug(input.playerName);
  const dup = state.picks.find((p) => p.playerId === playerId);
  if (dup) {
    const owner = state.teams.find((t) => t.id === dup.teamId)?.name ?? dup.teamId;
    throw new Error(`${dup.playerName} was already drafted by ${owner} for $${dup.price} (pick ${dup.n})`);
  }
  if (!Number.isInteger(input.price) || input.price < 0) throw new Error(`Price must be a whole number of dollars, got ${input.price}`);
  const open = slotsPerTeam - teamPickCount(state, team.id);
  if (open <= 0) throw new Error(`${team.name} has no open roster slots`);
  const remaining = team.budget - teamSpent(state, team.id);
  const maxBid = remaining - (open - 1);
  if (input.price > maxBid) {
    throw new Error(`${team.name} can bid at most $${maxBid} ($${remaining} left, ${open} slots to fill)`);
  }
  const pick: DraftPick = {
    n: state.picks.length + 1,
    playerId,
    playerName: input.playerName,
    teamId: team.id,
    price: input.price,
    at: new Date().toISOString(),
    source: input.source ?? 'manual',
    ...(input.yahooPick != null ? { yahooPick: input.yahooPick } : {}),
  };
  state.picks.push(pick);
  state.updatedAt = pick.at;
  return pick;
}

export function undoPick(state: DraftState): DraftPick | undefined {
  const pick = state.picks.pop();
  if (pick) state.updatedAt = new Date().toISOString();
  return pick;
}

export function removePick(state: DraftState, n: number): DraftPick | undefined {
  const idx = state.picks.findIndex((p) => p.n === n);
  if (idx < 0) return undefined;
  const [pick] = state.picks.splice(idx, 1);
  state.picks.forEach((p, i) => (p.n = i + 1));
  state.updatedAt = new Date().toISOString();
  return pick;
}

export function setPunts(state: DraftState, punts: string[]): void {
  state.punts = [...new Set(punts)];
  state.updatedAt = new Date().toISOString();
}
