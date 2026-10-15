import { categoryDefs, stat } from '../engine/categories.js';
import { maxBid, priceRemaining } from '../engine/dollars.js';
import type { LeagueConfig, PlayerValue, PricedPlayer, Projection, ValueResult } from '../engine/types.js';
import { applyPunts, draftSlotsPerTeam } from '../engine/values.js';
import type { DraftPick, DraftState, DraftTeam } from './store.js';

export interface BoardPlayer extends PricedPlayer {
  /** Price with the full budget and empty rosters, for reference. */
  basePrice: number;
  drafted?: { teamId: string; teamName: string; price: number; n: number };
  /** Headline per-game numbers for display. */
  line: Record<string, number>;
  gp: number;
  mpg: number;
  market?: Projection['market'];
}

export interface BoardTeam extends DraftTeam {
  spent: number;
  remaining: number;
  picks: number;
  openSlots: number;
  maxBid: number;
  /** Slot name -> player name, in config order, "" when empty. */
  lineup: { slot: string; playerId?: string; playerName?: string }[];
  /** Category key -> sum of z over this team's drafted players. */
  catZ: Record<string, number>;
  /** Category key -> rank among teams (1 = best), only once the team has a pick. */
  catRank: Record<string, number>;
  value: number;
}

export interface Board {
  updatedAt: string;
  config: { teams: number; budget: number; slotsPerTeam: number; categories: { key: string; label: string }[] };
  punts: string[];
  pricing: {
    money: number;
    slots: number;
    replacement: number;
    dollarsPerVar: number;
    /** Ratio of current dollars-per-VAR to the pre-draft figure. >1 means prices are inflated. */
    inflation: number;
    spent: number;
    picks: number;
  };
  players: BoardPlayer[];
  teams: BoardTeam[];
  me?: BoardTeam & { profile: { key: string; label: string; z: number; rank: number; raw: number; display: string }[] };
  recentPicks: (DraftPick & { teamName: string })[];
}

const LINE_KEYS = ['pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'fg_pct', 'ft_pct', 'ato'] as const;

function lineOf(p: Projection): Record<string, number> {
  return {
    pts: p.pts,
    reb: p.oreb + p.dreb,
    oreb: p.oreb,
    dreb: p.dreb,
    ast: p.ast,
    stl: p.stl,
    blk: p.blk,
    tpm: p.tpm,
    fgm: p.fgm,
    fga: p.fga,
    ftm: p.ftm,
    fta: p.fta,
    tov: p.tov,
    fg_pct: p.fga > 0 ? p.fgm / p.fga : 0,
    ft_pct: p.fta > 0 ? p.ftm / p.fta : 0,
    ato: p.tov > 0 ? p.ast / p.tov : p.ast,
  };
}

/** Order active slots most-restrictive first so a C goes to C before Util. */
function slotOrder(config: LeagueConfig): string[] {
  const out: string[] = [];
  for (const s of config.rosterSlots) for (let i = 0; i < s.count; i++) out.push(s.slot);
  const restrict = (slot: string) => {
    const el = config.slotEligibility[slot] ?? ['*'];
    return el.includes('*') ? 99 : el.length;
  };
  const isBench = (slot: string) => restrict(slot) === 99 && /^(BN|IL|IR|NA)/i.test(slot);
  return out
    .map((slot, i) => ({ slot, i }))
    .sort((a, b) => Number(isBench(a.slot)) - Number(isBench(b.slot)) || restrict(a.slot) - restrict(b.slot) || a.i - b.i)
    .map((x) => x.slot);
}

export function assignLineup(
  config: LeagueConfig,
  players: { id: string; name: string; positions: string[] }[],
): BoardTeam['lineup'] {
  const slots = slotOrder(config).map((slot) => ({ slot, playerId: undefined as string | undefined, playerName: undefined as string | undefined }));
  const eligible = (slot: string, positions: string[]) => {
    const el = config.slotEligibility[slot] ?? ['*'];
    if (el.includes('*')) return true;
    return positions.some((p) => el.includes(p));
  };
  // Greedy: players with fewer eligible slots go first.
  const ordered = [...players].sort(
    (a, b) => slots.filter((s) => eligible(s.slot, a.positions)).length - slots.filter((s) => eligible(s.slot, b.positions)).length,
  );
  for (const p of ordered) {
    const slot = slots.find((s) => !s.playerId && eligible(s.slot, p.positions));
    if (slot) {
      slot.playerId = p.id;
      slot.playerName = p.name;
    }
  }
  // Present in config order.
  const configOrder = config.rosterSlots.flatMap((s) => Array.from({ length: s.count }, () => s.slot));
  const used = new Set<number>();
  return configOrder.map((slot) => {
    const idx = slots.findIndex((s, i) => s.slot === slot && !used.has(i));
    used.add(idx);
    return slots[idx]!;
  });
}

export interface BoardInputs {
  state: DraftState;
  projections: Projection[];
  values: ValueResult;
  config: LeagueConfig;
}

/** Everything the draft page shows, computed from the current state. Pure. */
export function buildBoard({ state, projections, values, config }: BoardInputs): Board {
  const defs = categoryDefs(config.categories);
  const slotsPerTeam = draftSlotsPerTeam(config);
  const punted = applyPunts(values, state.punts, config.categories);
  const projById = new Map(projections.map((p) => [p.id, p]));
  const teamById = new Map(state.teams.map((t) => [t.id, t]));
  const draftedIds = new Set(state.picks.map((p) => p.playerId));

  const totalSlots = config.teams * slotsPerTeam;
  const totalMoney = state.teams.reduce((s, t) => s + t.budget, 0);
  const spent = state.picks.reduce((s, p) => s + p.price, 0);
  const base = priceRemaining(punted.players, { slots: totalSlots, money: totalMoney });
  const basePrice = new Map(base.players.map((p) => [p.id, p.price]));
  const live = priceRemaining(punted.players, {
    slots: totalSlots - state.picks.length,
    money: totalMoney - spent,
    drafted: draftedIds,
  });
  const valueById = new Map(punted.players.map((p) => [p.id, p]));

  const toBoardPlayer = (v: PricedPlayer, drafted?: BoardPlayer['drafted']): BoardPlayer => {
    const proj = projById.get(v.id);
    return {
      ...v,
      basePrice: basePrice.get(v.id) ?? 1,
      drafted,
      line: proj ? lineOf(proj) : {},
      gp: proj?.gp ?? 0,
      mpg: proj?.mpg ?? 0,
      market: proj?.market,
    };
  };

  const players: BoardPlayer[] = live.players.map((v) => toBoardPlayer(v));
  for (const pick of state.picks) {
    const v: PlayerValue = valueById.get(pick.playerId) ?? {
      id: pick.playerId,
      name: pick.playerName,
      positions: [],
      z: {},
      contrib: {},
      value: 0,
      rank: 0,
      inPool: false,
    };
    players.push(
      toBoardPlayer(
        { ...v, price: 0, var: 0 },
        { teamId: pick.teamId, teamName: teamById.get(pick.teamId)?.name ?? pick.teamId, price: pick.price, n: pick.n },
      ),
    );
  }

  const teams: BoardTeam[] = state.teams.map((t) => {
    const picks = state.picks.filter((p) => p.teamId === t.id);
    const tSpent = picks.reduce((s, p) => s + p.price, 0);
    const open = slotsPerTeam - picks.length;
    const catZ: Record<string, number> = {};
    for (const d of defs) catZ[d.key] = 0;
    let value = 0;
    const roster = picks.map((p) => {
      const v = valueById.get(p.playerId);
      if (v) {
        for (const d of defs) catZ[d.key]! += v.z[d.key] ?? 0;
        value += v.value;
      }
      return { id: p.playerId, name: p.playerName, positions: v?.positions ?? projById.get(p.playerId)?.positions ?? [] };
    });
    return {
      ...t,
      spent: tSpent,
      remaining: t.budget - tSpent,
      picks: picks.length,
      openSlots: open,
      maxBid: maxBid(t.budget - tSpent, open),
      lineup: assignLineup(config, roster),
      catZ,
      catRank: {},
      value,
    };
  });
  // Category ranks among teams that have drafted someone.
  const active = teams.filter((t) => t.picks > 0);
  for (const d of defs) {
    const sorted = [...active].sort((a, b) => b.catZ[d.key]! - a.catZ[d.key]!);
    sorted.forEach((t, i) => (t.catRank[d.key] = i + 1));
  }

  const meTeam = teams.find((t) => t.isMe);
  let me: Board['me'];
  if (meTeam) {
    const myPicks = state.picks.filter((p) => p.teamId === meTeam.id).map((p) => projById.get(p.playerId)).filter((p): p is Projection => !!p);
    const profile = defs.map((d) => {
      let raw = 0;
      let display = '';
      if (d.kind === 'counting') {
        raw = myPicks.reduce((s, p) => s + stat(p, d.stat), 0);
        display = raw.toFixed(1);
      } else {
        const num = myPicks.reduce((s, p) => s + stat(p, d.num), 0);
        const den = myPicks.reduce((s, p) => s + stat(p, d.den), 0);
        raw = den > 0 ? num / den : 0;
        display = d.key === 'ato' ? raw.toFixed(2) : (raw * 100).toFixed(1) + '%';
      }
      return { key: d.key, label: d.label, z: meTeam.catZ[d.key] ?? 0, rank: meTeam.catRank[d.key] ?? 0, raw, display };
    });
    me = { ...meTeam, profile };
  }

  const recentPicks = [...state.picks]
    .slice(-10)
    .reverse()
    .map((p) => ({ ...p, teamName: teamById.get(p.teamId)?.name ?? p.teamId }));

  return {
    updatedAt: state.updatedAt,
    config: { teams: config.teams, budget: config.budget, slotsPerTeam, categories: defs.map((d) => ({ key: d.key, label: d.label })) },
    punts: state.punts,
    pricing: {
      money: live.money,
      slots: live.slots,
      replacement: live.replacement,
      dollarsPerVar: live.dollarsPerVar,
      inflation: base.dollarsPerVar > 0 ? live.dollarsPerVar / base.dollarsPerVar : 1,
      spent,
      picks: state.picks.length,
    },
    players,
    teams,
    me,
    recentPicks,
  };
}

export { LINE_KEYS };
