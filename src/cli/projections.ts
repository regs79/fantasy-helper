import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { loadConfig, loadProjections, paths, readJson, saveProjections } from '../data.js';
import { computeValues, priceRemaining, poolSize, categoryDefs } from '../engine/index.js';
import { importCsvFile, parseMappingArgs } from '../projections/index.js';
import { fmt, table } from './table.js';

interface OrebRef {
  projections?: { id: string; oreb: number; dreb: number }[];
}

/** Build id -> OREB share from a saved projections file (e.g. the Yahoo last-season pull). */
async function orebShareFrom(file: string): Promise<Record<string, number>> {
  const ref = await readJson<OrebRef>(file);
  const out: Record<string, number> = {};
  for (const p of ref.projections ?? []) {
    const reb = p.oreb + p.dreb;
    if (reb > 0) out[p.id] = p.oreb / reb;
  }
  return out;
}

export function registerProjectionCommands(program: Command): void {
  program
    .command('import')
    .description('Import a projections CSV into data/projections.json')
    .argument('<csv>', 'path to the CSV file')
    .option('-m, --map <field=Header...>', 'override a column mapping, e.g. --map tpm=3PTM', [])
    .option('--totals', 'treat stats as season totals (divide by GP)')
    .option('--per-game', 'treat stats as per game (skip auto-detection)')
    .option('-s, --source <name>', 'label for this projection source')
    .option('--default-gp <n>', 'games played to assume when the file has none', '70')
    .option('--oreb-ref <file>', 'projections JSON to take OREB/DREB splits from (default: data/yahoo/players.json if present)')
    .option('--dry-run', 'show the mapping and first rows without writing')
    .action(async (csv: string, opts) => {
      const mapping = parseMappingArgs(opts.map as string[]);
      const refFile = opts.orebRef ?? (existsSync(paths.yahooDir() + '/players.json') ? paths.yahooDir() + '/players.json' : undefined);
      const orebShare = refFile ? await orebShareFrom(refFile) : undefined;
      const result = await importCsvFile(csv, {
        mapping,
        totals: opts.totals ? true : opts.perGame ? false : 'auto',
        source: opts.source,
        defaultGp: Number(opts.defaultGp),
        orebShare,
      });
      console.log(`Headers: ${result.headers.join(', ')}`);
      console.log('Mapping:');
      for (const [field, header] of Object.entries(result.mapping)) console.log(`  ${field.padEnd(10)} <- ${header}`);
      if (result.totals) console.log('Stats treated as season totals; divided by GP.');
      if (refFile) console.log(`OREB/DREB split reference: ${refFile}`);
      for (const w of result.warnings) console.log(`warning: ${w}`);
      console.log(`${result.projections.length} players.`);
      console.log(
        table(
          ['Player', 'Pos', 'GP', 'PTS', 'OREB', 'DREB', 'AST', 'FGM', 'FGA', 'FTM', 'FTA', '3PM', 'TO'],
          result.projections.slice(0, 5).map((p) => [p.name, p.positions.join('/'), p.gp, p.pts, p.oreb, p.dreb, p.ast, p.fgm, p.fga, p.ftm, p.fta, p.tpm, p.tov]),
        ),
      );
      if (opts.dryRun) return;
      await saveProjections({
        source: opts.source ?? csv,
        importedAt: new Date().toISOString(),
        warnings: result.warnings,
        projections: result.projections,
      });
      console.log(`Wrote ${paths.projections()}`);
    });

  program
    .command('values')
    .description('Rank players by 11-cat value and pre-draft dollar price')
    .option('-p, --punt <cats>', 'comma-separated categories to punt, e.g. ft_pct,ato')
    .option('-n, --top <n>', 'rows to show', '60')
    .option('--all', 'show every player')
    .action(async (opts) => {
      const config = await loadConfig();
      const { projections, source } = await loadProjections();
      const punt = opts.punt ? String(opts.punt).split(',').map((s) => s.trim()).filter(Boolean) : [];
      const defs = categoryDefs(config.categories);
      for (const p of punt) if (!config.categories.includes(p)) throw new Error(`Unknown category "${p}". League categories: ${config.categories.join(', ')}`);
      const values = computeValues(projections, config, { punt });
      const priced = priceRemaining(values.players, { slots: poolSize(config), money: config.teams * config.budget });
      const rows = (opts.all ? priced.players : priced.players.slice(0, Number(opts.top))).map((p) => [
        p.rank,
        p.name,
        p.positions.join('/'),
        Math.round(p.price),
        fmt(p.value, 2),
        ...defs.map((d) => fmt(p.z[d.key] ?? 0, 1)),
      ]);
      console.log(`Source: ${source}. Pool ${values.pool.poolSize} of ${projections.length} players. Punting: ${punt.length ? punt.join(', ') : 'nothing'}.`);
      console.log(table(['#', 'Player', 'Pos', '$', 'Value', ...defs.map((d) => d.label)], rows));
    });
}
