import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { LeagueConfig, Projection } from './engine/types.js';

/** Where mutable state lives. Overridable so a container can mount a volume. */
export function dataDir(): string {
  return process.env.DATA_DIR ?? path.resolve('data');
}

export function configPath(): string {
  return process.env.LEAGUE_CONFIG ?? path.resolve('config/league.json');
}

export const paths = {
  projections: () => path.join(dataDir(), 'projections.json'),
  draft: () => path.join(dataDir(), 'draft.json'),
  yahooToken: () => path.join(dataDir(), 'yahoo-token.json'),
  yahooDir: () => path.join(dataDir(), 'yahoo'),
};

export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

export async function readJsonOr<T>(file: string, fallback: T): Promise<T> {
  if (!existsSync(file)) return fallback;
  return readJson<T>(file);
}

/** Atomic write: temp file then rename, so a crash mid-write never leaves half a file. */
export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await rename(tmp, file);
}

export async function loadConfig(): Promise<LeagueConfig> {
  const cfg = await readJson<LeagueConfig>(configPath());
  if (!cfg.teams || !cfg.budget || !cfg.categories?.length || !cfg.rosterSlots?.length) {
    throw new Error(`League config ${configPath()} is missing teams, budget, categories or rosterSlots`);
  }
  return cfg;
}

export interface ProjectionFile {
  source: string;
  importedAt: string;
  warnings: string[];
  projections: Projection[];
}

export async function loadProjections(): Promise<ProjectionFile> {
  const file = paths.projections();
  if (!existsSync(file)) {
    throw new Error(`No projections at ${file}. Run: ./fh import <projections.csv> (or ./fh yahoo players)`);
  }
  return readJson<ProjectionFile>(file);
}

export async function saveProjections(file: ProjectionFile): Promise<void> {
  await writeJson(paths.projections(), file);
}
