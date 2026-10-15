import { Command } from 'commander';
import { registerDraftCommands } from './cli/draft.js';
import { registerProjectionCommands } from './cli/projections.js';
import { registerBoardCommand } from './cli/board.js';
import { registerYahooCommands } from './cli/yahoo.js';

try {
  process.loadEnvFile?.('.env');
} catch {
  // no .env is fine
}

const program = new Command();
program
  .name('fh')
  .description('Fantasy basketball auction draft helper')
  .showHelpAfterError();

registerProjectionCommands(program);
registerDraftCommands(program);
registerBoardCommand(program);
registerYahooCommands(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`error: ${msg}`);
  process.exitCode = 1;
});
