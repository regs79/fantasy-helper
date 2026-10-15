import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { paths } from '../data.js';
import { getAccessToken, refreshToken } from './oauth.js';
import { readJson } from '../data.js';
import type { Token } from './oauth.js';
import { unwrap, type Json } from './normalize.js';

const BASE = 'https://fantasysports.yahooapis.com/fantasy/v2/';

export interface YahooClient {
  /** GET a resource path (without the base URL) and return the unwrapped JSON. */
  get(resource: string): Promise<Json>;
  /** Same, but the raw response as Yahoo sent it. */
  getRaw(resource: string): Promise<Json>;
}

export interface ClientOptions {
  /** Save every raw response under data/yahoo/raw/ for debugging. */
  cacheRaw?: boolean;
  /** Minimum ms between requests. */
  throttleMs?: number;
}

export function createClient(opts: ClientOptions = {}): YahooClient {
  let last = 0;
  const throttle = opts.throttleMs ?? 250;

  async function request(resource: string, retry = true): Promise<Json> {
    const wait = last + throttle - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const url = BASE + resource.replace(/^\//, '') + (resource.includes('?') ? '&' : '?') + 'format=json';
    const token = await getAccessToken();
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (res.status === 401 && retry) {
      await refreshToken(await readJson<Token>(paths.yahooToken()));
      return request(resource, false);
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`Yahoo ${res.status} for ${resource}: ${text.slice(0, 400)}`);
    const json = JSON.parse(text) as Json;
    if (opts.cacheRaw) {
      const file = path.join(paths.yahooDir(), 'raw', resource.replace(/[^a-z0-9]+/gi, '_').slice(0, 150) + '.json');
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(json, null, 2));
    }
    return json;
  }

  return {
    getRaw: (resource) => request(resource),
    get: async (resource) => unwrap(await request(resource)),
  };
}
