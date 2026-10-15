import Fastify from 'fastify';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { loadConfig, loadProjections, paths, saveProjections } from '../data.js';
import { computeValues } from '../engine/values.js';
import { draftSlotsPerTeam } from '../engine/values.js';
import type { LeagueConfig, Projection, ValueResult } from '../engine/types.js';
import { addPick, buildBoard, newDraft, removePick, setMe, setPunts, undoPick, type DraftState } from '../draft/index.js';
import { findPlayer, loadDraftState, saveDraftState } from '../draft/session.js';
import { importCsvText } from '../projections/index.js';

interface Cache {
  config?: LeagueConfig;
  projections?: Projection[];
  projectionsMtime?: number;
  values?: ValueResult;
}

const cache: Cache = {};

/** Reload projections and values when the file on disk changes. */
async function loadValues(): Promise<{ config: LeagueConfig; projections: Projection[]; values: ValueResult }> {
  const config = cache.config ?? (cache.config = await loadConfig());
  const file = paths.projections();
  const mtime = existsSync(file) ? (await stat(file)).mtimeMs : 0;
  if (!cache.values || cache.projectionsMtime !== mtime) {
    const { projections } = existsSync(file) ? await loadProjections() : { projections: [] as Projection[] };
    cache.projections = projections;
    cache.values = computeValues(projections, config);
    cache.projectionsMtime = mtime;
  }
  return { config, projections: cache.projections!, values: cache.values! };
}

/** Serialize state mutations so two quick POSTs cannot clobber each other. */
let chain: Promise<unknown> = Promise.resolve();
function mutate<T>(fn: (state: DraftState) => Promise<T> | T): Promise<T> {
  const next = chain.then(async () => {
    const state = await loadDraftState();
    const result = await fn(state);
    await saveDraftState(state);
    return result;
  });
  chain = next.catch(() => undefined);
  return next;
}

async function currentBoard() {
  const { config, projections, values } = await loadValues();
  let state: DraftState;
  if (existsSync(paths.draft())) state = await loadDraftState();
  else state = newDraft(config);
  return { board: buildBoard({ state, projections, values, config }), hasDraft: existsSync(paths.draft()), hasProjections: projections.length > 0 };
}

export async function startServer(opts: { port: number; host: string }): Promise<void> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' } });
  app.addContentTypeParser('text/csv', { parseAs: 'string' }, (_req, body, done) => done(null, body));
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  const htmlPath = new URL('./public/index.html', import.meta.url);
  app.get('/', async (_req, reply) => {
    reply.type('text/html').send(await readFile(htmlPath, 'utf8'));
  });

  app.get('/api/board', async () => {
    const { board, hasDraft, hasProjections } = await currentBoard();
    return { ...board, hasDraft, hasProjections };
  });

  app.post<{ Body: { player?: string; playerId?: string; playerName?: string; teamId: string; price: number; new?: boolean } }>(
    '/api/pick',
    async (req, reply) => {
      const { config, projections } = await loadValues();
      const body = req.body;
      try {
        const pick = await mutate((state) => {
          let playerId = body.playerId;
          let playerName = body.playerName ?? body.player ?? '';
          if (!playerId && !body.new) {
            const p = findPlayer(projections, body.player ?? playerName);
            playerId = p.id;
            playerName = p.name;
          } else if (playerId) {
            playerName = projections.find((p) => p.id === playerId)?.name ?? playerName;
          }
          return addPick(state, { playerId, playerName, teamId: String(body.teamId), price: Number(body.price) }, draftSlotsPerTeam(config));
        });
        return { ok: true, pick };
      } catch (err) {
        reply.code(400);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  app.post<{ Body: { n?: number } }>('/api/undo', async (req, reply) => {
    const pick = await mutate((state) => (req.body?.n ? removePick(state, Number(req.body.n)) : undoPick(state)));
    if (!pick) {
      reply.code(400);
      return { ok: false, error: 'Nothing to undo' };
    }
    return { ok: true, pick };
  });

  app.post<{ Body: { punts: string[] } }>('/api/punts', async (req, reply) => {
    const { config } = await loadValues();
    const punts = (req.body?.punts ?? []).map(String);
    const bad = punts.filter((p) => !config.categories.includes(p));
    if (bad.length) {
      reply.code(400);
      return { ok: false, error: `Unknown categories: ${bad.join(', ')}` };
    }
    await mutate((state) => setPunts(state, punts));
    return { ok: true, punts };
  });

  app.post<{ Body: { teamId: string } }>('/api/me', async (req) => {
    const team = await mutate((state) => setMe(state, String(req.body.teamId)));
    return { ok: true, team };
  });

  app.post<{ Body: { teamId: string; name: string } }>('/api/team', async (req, reply) => {
    try {
      const team = await mutate((state) => {
        const t = state.teams.find((x) => x.id === String(req.body.teamId));
        if (!t) throw new Error('Unknown team');
        t.name = String(req.body.name).trim() || t.name;
        return t;
      });
      return { ok: true, team };
    } catch (err) {
      reply.code(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  app.post<{ Body: { teams?: string[]; me?: string; force?: boolean } }>('/api/draft/new', async (req, reply) => {
    if (existsSync(paths.draft()) && !req.body?.force) {
      reply.code(400);
      return { ok: false, error: 'A draft already exists; pass force to replace it' };
    }
    const { config } = await loadValues();
    const state = newDraft(config, { teamNames: req.body?.teams, me: req.body?.me });
    await saveDraftState(state);
    return { ok: true };
  });

  app.post<{ Body: string; Querystring: { source?: string; totals?: string } }>('/api/projections', async (req, reply) => {
    try {
      const result = importCsvText(String(req.body), {
        source: req.query.source ?? 'upload',
        totals: req.query.totals === 'true' ? true : req.query.totals === 'false' ? false : 'auto',
      });
      await saveProjections({ source: req.query.source ?? 'upload', importedAt: new Date().toISOString(), warnings: result.warnings, projections: result.projections });
      return { ok: true, count: result.projections.length, warnings: result.warnings, mapping: result.mapping };
    } catch (err) {
      reply.code(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  app.post('/api/sync', async (_req, reply) => {
    try {
      const { syncDraftFromYahoo } = await import('../yahoo/sync.js');
      const { config, projections } = await loadValues();
      const result = await mutate((state) => syncDraftFromYahoo(state, projections, config));
      return { ok: true, ...result };
    } catch (err) {
      reply.code(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  await app.listen({ port: opts.port, host: opts.host });
  console.log(`Draft board at http://${opts.host === '0.0.0.0' ? 'localhost' : opts.host}:${opts.port}`);
}
