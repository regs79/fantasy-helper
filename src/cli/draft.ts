import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { loadConfig, paths } from '../data.js';
import { draftSlotsPerTeam } from '../engine/values.js';
import { addPick, buildBoard, findTeam, newDraft, removePick, setMe, setPunts, undoPick } from '../draft/index.js';
import { findPlayer, loadDraftState, loadSession, saveDraftState } from '../draft/session.js';
import { fmt, money, table } from './table.js';

export function registerDraftCommands(program: Command): void {
  const draft = program.command('draft').description('Draft state: picks, budgets, board');

  draft
    .command('new')
    .description('Start a new draft (writes data/draft.json)')
    .option('-t, --teams <names>', 'comma-separated team names (defaults to Team 1..N)')
    .option('--me <team>', 'which team is mine')
    .option('--yahoo', 'take team names (and which one is mine) from the Yahoo league')
    .option('-f, --force', 'overwrite an existing draft')
    .action(async (opts) => {
      if (existsSync(paths.draft()) && !opts.force) throw new Error(`${paths.draft()} exists; pass --force to start over`);
      const config = await loadConfig();
      let teamNames = opts.teams ? String(opts.teams).split(',').map((s) => s.trim()) : undefined;
      let me: string | undefined = opts.me;
      let yahooTeams: { team_key: string; name: string; is_owned_by_current_login: boolean }[] | undefined;
      let leagueKey: string | undefined;
      if (opts.yahoo) {
        const { createClient } = await import('../yahoo/client.js');
        const { getTeams } = await import('../yahoo/api.js');
        const { currentLeagueKey } = await import('../yahoo/sync.js');
        const client = createClient();
        leagueKey = await currentLeagueKey(client);
        yahooTeams = await getTeams(client, leagueKey);
        teamNames = yahooTeams.map((t) => t.name);
        me ??= yahooTeams.find((t) => t.is_owned_by_current_login)?.name;
      }
      const state = newDraft(config, { teamNames, me });
      if (yahooTeams) {
        state.yahooLeagueKey = leagueKey;
        state.teams.forEach((t, i) => (t.yahooTeamKey = yahooTeams![i]!.team_key));
      }
      await saveDraftState(state);
      console.log(`New draft: ${state.teams.length} teams x $${config.budget}, ${draftSlotsPerTeam(config)} slots each.`);
      console.log(state.teams.map((t) => `${t.id}=${t.name}${t.isMe ? ' (me)' : ''}`).join(', '));
    });

  draft
    .command('me')
    .description('Set which team is mine')
    .argument('<team>')
    .action(async (team: string) => {
      const state = await loadDraftState();
      const t = setMe(state, team);
      await saveDraftState(state);
      console.log(`You are ${t.name}`);
    });

  draft
    .command('rename')
    .description('Rename a team')
    .argument('<team>')
    .argument('<name>')
    .action(async (team: string, name: string) => {
      const state = await loadDraftState();
      const t = findTeam(state, team);
      t.name = name;
      await saveDraftState(state);
      console.log(`Team ${t.id} is now ${t.name}`);
    });

  draft
    .command('pick')
    .description('Record a pick: player, team, price')
    .argument('<player>', 'player name (partial ok) or id')
    .argument('<team>', 'team id, name, or prefix')
    .argument('<price>', 'winning bid in dollars')
    .option('--new', 'player is not in the projections; record by name')
    .action(async (player: string, team: string, price: string, opts) => {
      const s = await loadSession();
      const t = findTeam(s.state, team);
      let playerId: string | undefined;
      let playerName = player;
      if (!opts.new) {
        const p = findPlayer(s.projections, player);
        playerId = p.id;
        playerName = p.name;
      }
      const pick = addPick(s.state, { playerId, playerName, teamId: t.id, price: Number(price) }, draftSlotsPerTeam(s.config));
      await saveDraftState(s.state);
      const board = buildBoard(s);
      const bt = board.teams.find((x) => x.id === t.id)!;
      console.log(`#${pick.n} ${pick.playerName} -> ${t.name} for ${money(pick.price)}. ${t.name}: ${money(bt.remaining)} left, ${bt.openSlots} slots, max bid ${money(bt.maxBid)}. Inflation ${fmt(board.pricing.inflation, 2)}x`);
    });

  draft
    .command('undo')
    .description('Remove the last pick (or pick number N)')
    .argument('[n]')
    .action(async (n?: string) => {
      const state = await loadDraftState();
      const pick = n ? removePick(state, Number(n)) : undoPick(state);
      if (!pick) throw new Error('Nothing to undo');
      await saveDraftState(state);
      console.log(`Removed #${pick.n} ${pick.playerName} (${money(pick.price)})`);
    });

  draft
    .command('punt')
    .description('Set punted categories (comma-separated, or "none")')
    .argument('<cats>')
    .action(async (cats: string) => {
      const config = await loadConfig();
      const state = await loadDraftState();
      const list = cats === 'none' ? [] : cats.split(',').map((c) => c.trim()).filter(Boolean);
      for (const c of list) if (!config.categories.includes(c)) throw new Error(`Unknown category "${c}". League categories: ${config.categories.join(', ')}`);
      setPunts(state, list);
      await saveDraftState(state);
      console.log(`Punting: ${list.length ? list.join(', ') : 'nothing'}`);
    });

  draft
    .command('board')
    .description('Print the board: top remaining players, team budgets, my profile')
    .option('-n, --top <n>', 'remaining players to show', '40')
    .option('-q, --search <text>', 'filter remaining players by name')
    .action(async (opts) => {
      const s = await loadSession();
      const board = buildBoard(s);
      const defs = board.config.categories;
      console.log(
        `Picks ${board.pricing.picks}/${board.config.teams * board.config.slotsPerTeam}. Spent ${money(board.pricing.spent)}, ${money(board.pricing.money)} left for ${board.pricing.slots} slots. Inflation ${fmt(board.pricing.inflation, 2)}x. Punting: ${board.punts.join(', ') || 'nothing'}.`,
      );
      console.log();
      console.log(
        table(
          ['Team', 'Left', 'Slots', 'Max', 'Value', ...defs.map((d) => d.label)],
          board.teams.map((t) => [t.name + (t.isMe ? ' *' : ''), t.remaining, t.openSlots, t.maxBid, fmt(t.value, 1), ...defs.map((d) => (t.picks ? fmt(t.catZ[d.key] ?? 0, 1) : '-'))]),
        ),
      );
      console.log();
      if (board.me) {
        console.log(`My roster (${board.me.name}):`);
        console.log(board.me.lineup.map((l) => `${l.slot}: ${l.playerName ?? '-'}`).join('  '));
        console.log(table(['Cat', 'z', 'Rank', 'Total'], board.me.profile.map((c) => [c.label, fmt(c.z, 1), c.rank || '-', c.display])));
        console.log();
      }
      let remaining = board.players.filter((p) => !p.drafted);
      if (opts.search) {
        const q = String(opts.search).toLowerCase();
        remaining = remaining.filter((p) => p.name.toLowerCase().includes(q));
      }
      console.log(
        table(
          ['#', 'Player', 'Pos', '$', 'Base', 'Value', ...defs.map((d) => d.label)],
          remaining.slice(0, Number(opts.top)).map((p) => [p.rank, p.name, p.positions.join('/'), Math.round(p.price), Math.round(p.basePrice), fmt(p.value, 1), ...defs.map((d) => fmt(p.z[d.key] ?? 0, 1))]),
        ),
      );
      if (board.recentPicks.length) {
        console.log();
        console.log('Recent: ' + board.recentPicks.slice(0, 5).map((p) => `#${p.n} ${p.playerName} ${p.teamName} ${money(p.price)}`).join(' | '));
      }
    });

  draft
    .command('picks')
    .description('List every pick so far')
    .action(async () => {
      const state = await loadDraftState();
      const names = new Map(state.teams.map((t) => [t.id, t.name]));
      console.log(table(['#', 'Player', 'Team', '$', 'Src'], state.picks.map((p) => [p.n, p.playerName, names.get(p.teamId) ?? p.teamId, p.price, p.source])));
    });
}
