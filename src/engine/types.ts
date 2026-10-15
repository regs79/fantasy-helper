/** Per-game projection for one player. Every stat is a per-game rate. */
export interface Projection {
  /** Stable id: Yahoo player key when known, otherwise a slug of the name. */
  id: string;
  name: string;
  /** NBA team abbreviation, when known. */
  team?: string;
  /** Yahoo-style positions, e.g. ["PG", "SG"]. Empty when unknown. */
  positions: string[];
  gp: number;
  mpg: number;
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
  tpm: number;
  pts: number;
  oreb: number;
  dreb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  /** Where the line came from (csv file name, "yahoo-2025", ...). */
  source?: string;
  /** Yahoo player key when known, e.g. "466.p.6014". */
  yahooKey?: string;
  /** Market anchors from Yahoo draft_analysis, when pulled. */
  market?: {
    avgCost?: number;
    avgPick?: number;
    pctDrafted?: number;
  };
}

export type StatKey =
  | 'gp' | 'mpg' | 'fgm' | 'fga' | 'ftm' | 'fta' | 'tpm' | 'pts'
  | 'oreb' | 'dreb' | 'reb' | 'ast' | 'stl' | 'blk' | 'tov';

export type CategoryDef =
  | {
      key: string;
      label: string;
      kind: 'counting';
      stat: StatKey;
      lowerIsBetter?: boolean;
    }
  | {
      key: string;
      label: string;
      kind: 'ratio';
      num: StatKey;
      den: StatKey;
      lowerIsBetter?: boolean;
    };

export interface RosterSlot {
  slot: string;
  count: number;
}

export interface LeagueConfig {
  name?: string;
  teams: number;
  budget: number;
  /** Category keys from the catalog, in display order. */
  categories: string[];
  rosterSlots: RosterSlot[];
  /** slot name -> positions that may fill it. "*" means any. */
  slotEligibility: Record<string, string[]>;
  /** 'total' scales per-game stats by gp/gpReference; 'perGame' does not. */
  basis?: 'total' | 'perGame';
  gpReference?: number;
  poolIterations?: number;
  /** Slots that do not count toward the draftable pool (e.g. IL). */
  nonDraftSlots?: string[];
}

export interface PlayerValue {
  id: string;
  name: string;
  team?: string;
  positions: string[];
  /** z-score per category key. */
  z: Record<string, number>;
  /** Raw contribution per category: counting stat or ratio impact, on the chosen basis. */
  contrib: Record<string, number>;
  /** Sum of z over non-punted categories. */
  value: number;
  /** Rank by value, 1 = best. */
  rank: number;
  /** True when the player was inside the draftable pool on the final iteration. */
  inPool: boolean;
}

export interface PoolStats {
  /** Category key -> mean and sd used for the z-scores. */
  cats: Record<string, { mean: number; sd: number; poolRatio?: number }>;
  poolSize: number;
}

export interface ValueResult {
  players: PlayerValue[];
  pool: PoolStats;
  punted: string[];
}

export interface PricedPlayer extends PlayerValue {
  /** Dollar price given the current (possibly mid-draft) pool and money. */
  price: number;
  /** Value above replacement, 0 when at or below replacement. */
  var: number;
}

export interface PricingResult {
  players: PricedPlayer[];
  /** Value of the replacement-level player. */
  replacement: number;
  /** Dollars available above the $1 floor. */
  allocatable: number;
  /** Total VAR across the draftable pool. */
  totalVar: number;
  /** Dollars per unit of VAR. */
  dollarsPerVar: number;
  slots: number;
  money: number;
}
