import { readFile } from 'node:fs/promises';
import { parseTable } from './csv.js';
import { autoMap, buildProjections, type BuildOptions, type BuildResult, type Mapping } from './mapping.js';

export * from './csv.js';
export * from './mapping.js';
export * from './names.js';

export interface ImportOptions extends Omit<BuildOptions, 'mapping'> {
  mapping?: Mapping;
}

/** Import projections from CSV text, auto-mapping headers with optional overrides. */
export function importCsvText(text: string, opts: ImportOptions = {}): BuildResult & { headers: string[] } {
  const table = parseTable(text);
  const mapping = autoMap(table.headers, opts.mapping ?? {});
  const result = buildProjections(table.rows, { ...opts, mapping });
  return { ...result, headers: table.headers };
}

export async function importCsvFile(path: string, opts: ImportOptions = {}) {
  const text = await readFile(path, 'utf8');
  return importCsvText(text, { source: path.split('/').pop(), ...opts });
}
