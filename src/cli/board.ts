import type { Command } from 'commander';

export function registerBoardCommand(program: Command): void {
  program
    .command('board')
    .description('Serve the web draft board')
    .option('-p, --port <port>', 'port', process.env.PORT ?? '3000')
    .option('-H, --host <host>', 'bind address', process.env.HOST ?? '127.0.0.1')
    .action(async (opts) => {
      const { startServer } = await import('../server/index.js');
      await startServer({ port: Number(opts.port), host: String(opts.host) });
    });
}
