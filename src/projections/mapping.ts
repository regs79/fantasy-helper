import type { Projection } from '../engine/types.js';
import { slug } from './names.js';

/** Fields the importer can fill. Ratio fields are inputs that derive made/attempted when needed. */
export type ImportField =
  | 'name' | 'team' | 'positions'
  | 'gp' | 'mpg'
  | 'fgm' | 'fga' | 'fg_pct'
  | 'ftm' | 'fta' | 'ft_pct'
  | 'tpm' | 'pts'
  | 'oreb' | 'dreb' | 'reb'
  | 'ast' | 'stl' | 'blk' | 'tov';

export type Mapping = Partial<Record<ImportField, string>>;

/** Header aliases, compared after normalizeHeader(). Order matters: first match wins. */
const ALIASES: Record<ImportField, string[]> = {
  name: ['player', 'name', 'playername', 'fullname', 'playerfullname'],
  team: ['team', 'tm', 'teamabbr', 'teamabbreviation', 'nbateam'],
  positions: ['pos', 'position', 'positions', 'eligiblepositions', 'eligible'],
  gp: ['gp', 'g', 'games', 'gamesplayed', 'gms'],
  mpg: ['mpg', 'min', 'mins', 'minutes', 'mp', 'm', 'minpg'],
  fgm: ['fgm', 'fgmade', 'fieldgoalsmade', 'fgmpg', 'fg'],
  fga: ['fga', 'fgatt', 'fgattempts', 'fieldgoalattempts', 'fgapg'],
  fg_pct: ['fgpct', 'fgp', 'fgpercent', 'fieldgoalpct', 'fieldgoalpercentage', 'fgpercentage'],
  ftm: ['ftm', 'ftmade', 'freethrowsmade', 'ftmpg', 'ft'],
  fta: ['fta', 'ftatt', 'ftattempts', 'freethrowattempts', 'ftapg'],
  ft_pct: ['ftpct', 'ftp', 'ftpercent', 'freethrowpct', 'freethrowpercentage', 'ftpercentage'],
  tpm: ['3pm', '3ptm', '3p', '3pt', 'tpm', 'threes', '3s', '3pmade', 'fg3m', '3pg', '3ptmade', 'threesmade', '3pointersmade', '3ppg'],
  pts: ['pts', 'points', 'ppg', 'pt'],
  oreb: ['oreb', 'orb', 'or', 'offreb', 'offensiverebounds', 'orpg', 'oreb_pg', 'offrebounds'],
  dreb: ['dreb', 'drb', 'dr', 'defreb', 'defensiverebounds', 'drpg', 'defrebounds'],
  reb: ['reb', 'trb', 'rebounds', 'totalrebounds', 'rpg', 'r', 'treb', 'rebs'],
  ast: ['ast', 'assists', 'apg', 'a', 'asts'],
  stl: ['stl', 'st', 'steals', 'spg', 's', 'stls'],
  blk: ['blk', 'bs', 'blocks', 'bpg', 'b', 'blks'],
  tov: ['tov', 'to', 'turnovers', 'topg', 'tos', 'turnover'],
};

export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/%/g, 'pct')
    .replace(/three/g, '3')
    .replace(/\bper game\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Guess which header holds each field. Explicit overrides win. */
export function autoMap(headers: string[], overrides: Mapping = {}): Mapping {
  const byNorm = new Map<string, string>();
  for (const h of headers) if (!byNorm.has(normalizeHeader(h))) byNorm.set(normalizeHeader(h), h);
  const used = new Set<string>(Object.values(overrides).filter((v): v is string => !!v));
  const mapping: Mapping = { ...overrides };
  for (const field of Object.keys(ALIASES) as ImportField[]) {
    if (mapping[field]) continue;
    for (const alias of ALIASES[field]) {
      const h = byNorm.get(alias);
      if (h && !used.has(h)) {
        mapping[field] = h;
        used.add(h);
        break;
      }
    }
  }
  return mapping;
}

export function parseMappingArgs(args: string[]): Mapping {
  const m: Mapping = {};
  for (const a of args) {
    const eq = a.indexOf('=');
    if (eq < 0) throw new Error(`Bad --map "${a}", expected field=Header`);
    const field = a.slice(0, eq).trim() as ImportField;
    if (!(field in ALIASES)) throw new Error(`Unknown field "${field}" in --map. Fields: ${Object.keys(ALIASES).join(', ')}`);
    m[field] = a.slice(eq + 1).trim();
  }
  return m;
}

/** Parse "12.3", "1,234", "48.5%", ".485", "8.1/15.8", "0.512 (8.1/15.8)". */
export function parseCell(raw: string | undefined): { value?: number; num?: number; den?: number } {
  if (raw == null) return {};
  const s = raw.trim();
  if (!s || s === '-' || s === '—') return {};
  const frac = s.match(/(-?\d*\.?\d+)\s*\/\s*(-?\d*\.?\d+)/);
  const out: { value?: number; num?: number; den?: number } = {};
  if (frac) {
    out.num = Number(frac[1]);
    out.den = Number(frac[2]);
  }
  const lead = s.replace(/\(.*\)/, '').replace(/,/g, '').replace(/%/g, '').trim();
  const n = Number(lead);
  if (lead && Number.isFinite(n)) out.value = n;
  else if (frac && out.den) out.value = out.num! / out.den;
  return out;
}

function pct(v: number | undefined): number | undefined {
  if (v == null) return undefined;
  return v > 1 ? v / 100 : v;
}

export function parsePositions(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .toUpperCase()
    .split(/[,/|;\s-]+/)
    .map((p) => p.trim())
    .filter((p) => p && p !== 'UTIL');
}

/** Default share of rebounds that are offensive, by position, when no reference split is available. */
export function defaultOrebShare(positions: string[]): number {
  if (positions.includes('C')) return 0.3;
  if (positions.includes('PF')) return 0.26;
  if (positions.includes('SF') || positions.includes('F')) return 0.22;
  if (positions.length === 0) return 0.22;
  return 0.16;
}

export interface BuildOptions {
  mapping: Mapping;
  /** Divide counting stats by gp. 'auto' decides from the size of the numbers. */
  totals?: boolean | 'auto';
  source?: string;
  /** Default games played when the file has none. */
  defaultGp?: number;
  /** Player id (slug or name) -> fraction of rebounds that are offensive. */
  orebShare?: Record<string, number>;
}

export interface BuildResult {
  projections: Projection[];
  warnings: string[];
  mapping: Mapping;
  totals: boolean;
}

/** Turn mapped CSV rows into projections, deriving missing stats where possible. */
export function buildProjections(rows: Record<string, string>[], opts: BuildOptions): BuildResult {
  const { mapping } = opts;
  const warnings: string[] = [];
  const missing: string[] = [];
  if (!mapping.name) throw new Error('No player name column found; pass --map name=<Header>');
  const get = (row: Record<string, string>, f: ImportField) => (mapping[f] ? parseCell(row[mapping[f]!]) : {});

  const has = (f: ImportField) => !!mapping[f];
  if (!has('fgm') && !(has('fga') && has('fg_pct'))) missing.push('fgm (or fga + fg%)');
  if (!has('fga') && !(has('fgm') && has('fg_pct'))) missing.push('fga (or fgm + fg%)');
  if (!has('ftm') && !(has('fta') && has('ft_pct'))) missing.push('ftm (or fta + ft%)');
  if (!has('fta') && !(has('ftm') && has('ft_pct'))) missing.push('fta (or ftm + ft%)');
  for (const f of ['tpm', 'pts', 'ast', 'stl', 'blk', 'tov'] as const) if (!has(f)) missing.push(f);
  if (!has('oreb') && !has('dreb') && !has('reb')) missing.push('reb (or oreb + dreb)');
  if (missing.length) warnings.push(`Missing columns (treated as 0): ${missing.join(', ')}`);
  if (!has('gp')) warnings.push(`No games-played column; using ${opts.defaultGp ?? 70} for everyone`);
  if (has('reb') && !(has('oreb') && has('dreb'))) {
    warnings.push(
      has('oreb') || has('dreb')
        ? 'Deriving the other rebound split from REB'
        : 'Only total REB found; splitting OREB/DREB by reference share (or position default)',
    );
  }

  // Pre-pass: decide totals vs per game.
  const firstStats = rows.slice(0, 50).map((r) => get(r, 'pts').value ?? 0);
  const avgPts = firstStats.reduce((a, b) => a + b, 0) / Math.max(1, firstStats.length);
  const totals = opts.totals === 'auto' || opts.totals === undefined ? avgPts > 60 : opts.totals;
  if (totals && !has('gp')) warnings.push('Stats look like season totals but there is no GP column; cannot convert to per game');

  const projections: Projection[] = [];
  for (const row of rows) {
    const name = (row[mapping.name] ?? '').trim();
    if (!name) continue;
    const positions = parsePositions(mapping.positions ? row[mapping.positions] : undefined);
    const team = mapping.team ? row[mapping.team]?.trim().toUpperCase() || undefined : undefined;
    const gpCell = get(row, 'gp').value;
    const gp = gpCell && gpCell > 0 ? gpCell : (opts.defaultGp ?? 70);
    const div = totals && gpCell && gpCell > 0 ? gpCell : 1;
    const num = (f: ImportField) => {
      const v = get(row, f).value;
      return v == null ? undefined : v / div;
    };

    const fgCell = get(row, 'fg_pct');
    const ftCell = get(row, 'ft_pct');
    let fgm = num('fgm') ?? (fgCell.num != null ? fgCell.num / div : undefined);
    let fga = num('fga') ?? (fgCell.den != null ? fgCell.den / div : undefined);
    const fgPct = pct(fgCell.value);
    if (fgm == null && fga != null && fgPct != null) fgm = fga * fgPct;
    if (fga == null && fgm != null && fgPct) fga = fgm / fgPct;
    let ftm = num('ftm') ?? (ftCell.num != null ? ftCell.num / div : undefined);
    let fta = num('fta') ?? (ftCell.den != null ? ftCell.den / div : undefined);
    const ftPct = pct(ftCell.value);
    if (ftm == null && fta != null && ftPct != null) ftm = fta * ftPct;
    if (fta == null && ftm != null && ftPct) fta = ftm / ftPct;

    let oreb = num('oreb');
    let dreb = num('dreb');
    const reb = num('reb');
    if (reb != null) {
      if (oreb == null && dreb != null) oreb = Math.max(0, reb - dreb);
      else if (dreb == null && oreb != null) dreb = Math.max(0, reb - oreb);
      else if (oreb == null && dreb == null) {
        const id = slug(name);
        const share = opts.orebShare?.[id] ?? opts.orebShare?.[name] ?? defaultOrebShare(positions);
        oreb = reb * share;
        dreb = reb - oreb;
      }
    }

    projections.push({
      id: slug(name),
      name,
      team,
      positions,
      gp,
      mpg: num('mpg') ?? 0,
      fgm: fgm ?? 0,
      fga: fga ?? 0,
      ftm: ftm ?? 0,
      fta: fta ?? 0,
      tpm: num('tpm') ?? 0,
      pts: num('pts') ?? 0,
      oreb: oreb ?? 0,
      dreb: dreb ?? 0,
      ast: num('ast') ?? 0,
      stl: num('stl') ?? 0,
      blk: num('blk') ?? 0,
      tov: num('tov') ?? 0,
      source: opts.source,
    });
  }

  const ids = new Set<string>();
  for (const p of projections) {
    if (ids.has(p.id)) warnings.push(`Duplicate player "${p.name}"; later row wins on id ${p.id}`);
    ids.add(p.id);
  }
  return { projections, warnings, mapping, totals };
}
