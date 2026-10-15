import type { Command } from 'commander';

export function registerYahooCommands(program: Command): void {
  program.command('yahoo').description('Yahoo Fantasy API: auth, league settings, players, draft sync');
}
