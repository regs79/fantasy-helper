import type { PlayerValue, PricedPlayer, PricingResult } from './types.js';

export interface PricingOptions {
  /** Roster slots still to be filled across the whole league. */
  slots: number;
  /** Dollars still in the room across the whole league. */
  money: number;
  /** Players already drafted; they are excluded from the pool. */
  drafted?: Set<string>;
  /** Minimum price per slot, normally $1. */
  floor?: number;
}

/**
 * Convert values to dollars over the remaining pool.
 *
 * The top `slots` undrafted players form the pool. Replacement level is the
 * best player just outside the pool. Each slot must get at least `floor`
 * dollars, and the rest of the money is split in proportion to value above
 * replacement. Calling this after every pick with the remaining slots and
 * money is what produces inflation-adjusted prices.
 */
export function priceRemaining(values: PlayerValue[], opts: PricingOptions): PricingResult {
  const floor = opts.floor ?? 1;
  const drafted = opts.drafted ?? new Set<string>();
  const remaining = values.filter((v) => !drafted.has(v.id)).sort((a, b) => b.value - a.value);
  const slots = Math.max(0, Math.min(opts.slots, remaining.length));
  const money = Math.max(0, opts.money);

  if (slots === 0 || remaining.length === 0) {
    return {
      players: remaining.map((v) => ({ ...v, price: 0, var: 0 })),
      replacement: 0,
      allocatable: 0,
      totalVar: 0,
      dollarsPerVar: 0,
      slots,
      money,
    };
  }

  const pool = remaining.slice(0, slots);
  const replacement = remaining[slots]?.value ?? remaining[remaining.length - 1]!.value;
  const allocatable = Math.max(0, money - slots * floor);
  const vars = pool.map((v) => Math.max(0, v.value - replacement));
  const totalVar = vars.reduce((a, b) => a + b, 0);
  const dollarsPerVar = totalVar > 0 ? allocatable / totalVar : 0;

  const players: PricedPlayer[] = remaining.map((v, i) => {
    const vr = i < slots ? vars[i]! : 0;
    return { ...v, var: vr, price: i < slots ? floor + vr * dollarsPerVar : floor };
  });
  return { players, replacement, allocatable, totalVar, dollarsPerVar, slots, money };
}

/** The most a team can bid while still being able to fill its remaining slots at the floor. */
export function maxBid(remainingBudget: number, openSlots: number, floor = 1): number {
  if (openSlots <= 0) return 0;
  return Math.max(0, remainingBudget - (openSlots - 1) * floor);
}
