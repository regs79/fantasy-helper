import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { paths } from '../data.js';
import { getAccessToken, refreshToken } from './oauth.js';
import { readJson } from '../data.js';
import type { Token } from './oauth.js';
import { unwrap, type Json } from './normalize.js';

const BASE = 'https://fantasysports.yahooapis.com/fantasy/v2/';

/**
 * Since 2026-07 Yahoo gates the Fantasy API behind an approval program: an
 * unapproved app gets this 403 on every endpoint even though OAuth succeeds.
 * Nothing in the token or request fixes it; see README "Yahoo".
 */
export function accessHint(status: number, body: string): string {
  if (status === 403 && /not authorized to perform this action/i.test(body)) {
    return (
      '\n\nThe token is fine; this Yahoo app is not approved for the Fantasy Sports API. ' +
      'Apply at https://sports.yahoo.com/developer/access/ and, once approved, submit the Client ID at ' +
      'https://sports.yahoo.com/developer/application-confirmation/ (see README, Yahoo).'
    );
  }
  if (status === 401 && /additional_authorization_required/i.test(body)) {
    return '\n\nThis Yahoo app has no Fantasy Sports entitlement (new apps cannot select it); see README, Yahoo.';
  }
  return '';
}

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
    if (!res.ok) throw new Error(`Yahoo ${res.status} for ${resource}: ${text.slice(0, 400)}${accessHint(res.status, text)}`);
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
