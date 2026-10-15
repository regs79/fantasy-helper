import type { Command } from 'commander';
import path from 'node:path';
import { loadConfig, loadProjections, paths, readJsonOr, saveProjections, writeJson } from '../data.js';
import { getDraftResults, getGame, getPlayers, getSettings, getTeams, getUserLeagues, type YahooSettings } from '../yahoo/api.js';
import { createClient } from '../yahoo/client.js';
import { configFromSettings } from '../yahoo/config.js';
import { authorizeInteractive } from '../yahoo/oauth.js';
import { yahooPlayersToProjections } from '../yahoo/projections.js';
import { currentLeagueKey, syncDraftFromYahoo, type LeagueInfoFile } from '../yahoo/sync.js';
import { loadSession, saveDraftState } from '../draft/session.js';
import { fmt, table } from './table.js';

export function registerYahooCommands(program: Command): void {
  const yahoo = program.command('yahoo').description('Yahoo Fantasy API: auth, league settings, players, draft sync');
  const leagueOpt = ['-l, --league <idOrKey>', 'league id (number) or full key; defaults to data/yahoo/league.json or YAHOO_LEAGUE_ID'] as const;

  yahoo
    .command('auth')
    .description('Authorize this app with your Yahoo account (OAuth2, paste-the-code flow)')
    .action(() => authorizeInteractive());

  yahoo
    .command('leagues')
    .description('List your NBA leagues for the current season')
    .action(async () => {
      const client = createClient({ cacheRaw: true });
      const game = await getGame(client);
      console.log(`Game ${game.game_key} (${game.code} ${game.season})`);
      const leagues = await getUserLeagues(client, game.game_key);
      console.log(table(['ID', 'Key', 'Name', 'Teams', 'Draft'], leagues.map((l) => [l.league_id, l.league_key, l.name, l.num_teams, l.draft_status])));
      if (leagues.length === 1) {
        const info: LeagueInfoFile = { league_key: leagues[0]!.league_key, name: leagues[0]!.name, game_key: game.game_key };
        await writeJson(path.join(paths.yahooDir(), 'league.json'), info);
        console.log(`Saved as the default league in ${path.join(paths.yahooDir(), 'league.json')}`);
      } else {
        console.log('Pick one with: ./fh yahoo use <id>');
      }
    });

  yahoo
    .command('use')
    .description('Set the default league')
    .argument('<idOrKey>')
    .action(async (ref: string) => {
      const client = createClient();
      const key = await currentLeagueKey(client, ref);
      await writeJson(path.join(paths.yahooDir(), 'league.json'), { league_key: key } satisfies LeagueInfoFile);
      console.log(`Default league: ${key}`);
    });

  yahoo
    .command('settings')
    .description('Fetch league settings: categories, roster, draft type')
    .option(...leagueOpt)
    .option('--write-config', 'rewrite config/league.json from these settings')
    .action(async (opts) => {
      const client = createClient({ cacheRaw: true });
      const key = await currentLeagueKey(client, opts.league);
      const s = await getSettings(client, key);
      await writeJson(path.join(paths.yahooDir(), 'settings.json'), s);
      console.log(`${s.league.name} (${key}): ${s.league.num_teams} teams, draft ${s.draft_type}${s.is_auction_draft ? ' (auction)' : ''}${s.budget != null ? `, budget $${s.budget}` : ''}`);
      console.log(table(['Stat id', 'Display', 'Name', 'Display only'], s.stat_categories.map((c) => [c.stat_id, c.display_name, c.name, c.is_only_display_stat ? 'yes' : ''])));
      console.log(table(['Slot', 'Count', 'Type'], s.roster_positions.map((p) => [p.position, p.count, p.position_type])));
      const base = await loadConfig();
      const { config, unmapped } = configFromSettings(s, base);
      if (unmapped.length) console.log(`warning: categories with no engine mapping: ${unmapped.join(', ')}`);
      console.log(`Engine categories: ${config.categories.join(', ')}`);
      console.log(`Roster: ${config.rosterSlots.map((r) => `${r.slot}x${r.count}`).join(' ')}`);
      if (opts.writeConfig) {
        await writeJson(process.env.LEAGUE_CONFIG ?? path.resolve('config/league.json'), config);
        console.log('Wrote config/league.json');
      } else {
        console.log('Pass --write-config to update config/league.json.');
      }
    });

  yahoo
    .command('teams')
    .description('List teams in the league')
    .option(...leagueOpt)
    .action(async (opts) => {
      const client = createClient({ cacheRaw: true });
      const key = await currentLeagueKey(client, opts.league);
      const teams = await getTeams(client, key);
      await writeJson(path.join(paths.yahooDir(), 'teams.json'), teams);
      console.log(table(['Key', 'Name', 'Manager', 'Me'], teams.map((t) => [t.team_key, t.name, t.manager, t.is_owned_by_current_login ? '*' : ''])));
    });

  yahoo
    .command('players')
    .description('Pull players with last-season stats and draft analysis into data/yahoo/players.json')
    .option(...leagueOpt)
    .option('--season <year>', 'stats season, e.g. 2025 for 2025-26 (default: previous season)')
    .option('--stat-type <type>', 'season (totals) or average_season (per game)', 'season')
    .option('--max <n>', 'max players to pull', '450')
    .option('--status <s>', 'Yahoo status filter: A, T, ALL')
    .option('--no-draft-analysis', 'skip the draft_analysis pull (halves the requests)')
    .option('--as-projections', 'also write data/projections.json so the board uses these as projections')
    .action(async (opts) => {
      const client = createClient({ cacheRaw: false });
      const key = await currentLeagueKey(client, opts.league);
      const game = await getGame(client);
      const season = opts.season ?? String(Number(game.season) - 1);
      const settings = (await readJsonOr<YahooSettings | null>(path.join(paths.yahooDir(), 'settings.json'), null)) ?? (await getSettings(client, key));
      console.log(`Pulling up to ${opts.max} players from ${key}, stats ${opts.statType} ${season}${opts.draftAnalysis ? ' + draft analysis' : ''}...`);
      const players = await getPlayers(client, key, {
        season,
        statType: opts.statType,
        max: Number(opts.max),
        status: opts.status,
        draftAnalysis: opts.draftAnalysis,
        onPage: (n) => process.stdout.write(`\r  ${n} players`),
      });
      console.log();
      await writeJson(path.join(paths.yahooDir(), 'players-raw.json'), players);
      const conv = yahooPlayersToProjections(players, settings.stat_categories, { totals: opts.statType === 'season', source: `yahoo-${season}` });
      for (const w of conv.warnings) console.log(`warning: ${w}`);
      console.log('Stat columns: ' + conv.headers.join(', '));
      const file = { source: `yahoo-${season}`, importedAt: new Date().toISOString(), warnings: conv.warnings, projections: conv.projections };
      await writeJson(path.join(paths.yahooDir(), 'players.json'), file);
      console.log(`Wrote ${conv.projections.length} players to ${path.join(paths.yahooDir(), 'players.json')}`);
      console.log(
        table(
          ['Player', 'Pos', 'GP', 'PTS', 'OREB', 'DREB', 'AST', 'FGM', 'FGA', 'Avg $'],
          conv.projections.slice(0, 8).map((p) => [p.name, p.positions.join('/'), p.gp, fmt(p.pts), fmt(p.oreb), fmt(p.dreb), fmt(p.ast), fmt(p.fgm), fmt(p.fga), p.market?.avgCost ?? '']),
        ),
      );
      if (opts.asProjections) {
        await saveProjections(file);
        console.log(`Also wrote ${paths.projections()}`);
      }
    });

  yahoo
    .command('market')
    .description('Attach Yahoo average auction cost to the current projections (matched by name)')
    .action(async () => {
      const yahooFile = await readJsonOr<{ projections: { id: string; market?: unknown; yahooKey?: string }[] } | null>(path.join(paths.yahooDir(), 'players.json'), null);
      if (!yahooFile) throw new Error('Run ./fh yahoo players first');
      const current = await loadProjections();
      const byId = new Map(yahooFile.projections.map((p) => [p.id, p]));
      let n = 0;
      for (const p of current.projections) {
        const y = byId.get(p.id);
        if (y) {
          p.market = y.market as typeof p.market;
          p.yahooKey = y.yahooKey;
          n++;
        }
      }
      await saveProjections(current);
      console.log(`Matched ${n} of ${current.projections.length} projections to Yahoo players`);
    });

  yahoo
    .command('draft')
    .description('Show Yahoo draft results as they stand')
    .option(...leagueOpt)
    .action(async (opts) => {
      const client = createClient({ cacheRaw: true });
      const key = await currentLeagueKey(client, opts.league);
      const results = await getDraftResults(client, key);
      console.log(table(['Pick', 'Round', 'Cost', 'Team', 'Player'], results.map((r) => [r.pick, r.round, r.cost ?? '', r.team_key, r.player_key])));
      console.log(`${results.length} picks`);
    });

  yahoo
    .command('sync')
    .description('Pull Yahoo draft results into the local draft')
    .option(...leagueOpt)
    .action(async (opts) => {
      const s = await loadSession();
      const client = createClient();
      const leagueKey = opts.league ? await currentLeagueKey(client, opts.league) : undefined;
      const r = await syncDraftFromYahoo(s.state, s.projections, s.config, { client, leagueKey });
      await saveDraftState(s.state);
      console.log(`Added ${r.added} of ${r.total} Yahoo picks (league ${r.leagueKey})`);
      for (const sk of r.skipped) console.log(`  skipped pick ${sk.pick}: ${sk.reason}`);
    });

  yahoo
    .command('raw')
    .description('GET any API resource and print the unwrapped JSON (debugging)')
    .argument('<resource>', 'e.g. league/466.l.12345/settings')
    .option('--as-is', 'print exactly what Yahoo returned')
    .action(async (resource: string, opts) => {
      const client = createClient({ cacheRaw: true });
      const data = opts.asIs ? await client.getRaw(resource) : await client.get(resource);
      console.log(JSON.stringify(data, null, 2));
    });
}
