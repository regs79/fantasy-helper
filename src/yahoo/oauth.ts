import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { paths, readJson, writeJson } from '../data.js';

const AUTH_URL = 'https://api.login.yahoo.com/oauth2/request_auth';
const TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';

export interface Token {
  access_token: string;
  refresh_token: string;
  token_type: string;
  /** Epoch ms when the access token expires. */
  expires_at: number;
}

function credentials(): { id: string; secret: string } {
  const id = process.env.YAHOO_CLIENT_ID;
  const secret = process.env.YAHOO_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Set YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET in .env (see .env.example)');
  return { id, secret };
}

export function authUrl(): string {
  const { id } = credentials();
  // No scope by default: Yahoo then grants whatever the app was registered
  // with. Asking for fspt-r explicitly fails with invalid_scope on an app
  // registered as Fantasy Sports read/write (fspt-w), so only send a scope
  // when YAHOO_SCOPE is set.
  const q = new URLSearchParams({ client_id: id, redirect_uri: 'oob', response_type: 'code', language: 'en-us' });
  if (process.env.YAHOO_SCOPE) q.set('scope', process.env.YAHOO_SCOPE);
  return `${AUTH_URL}?${q}`;
}

async function tokenRequest(params: Record<string, string>): Promise<Token> {
  const { id, secret } = credentials();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
    },
    body: new URLSearchParams({ redirect_uri: 'oob', ...params }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Yahoo token request failed (${res.status}): ${text.slice(0, 300)}`);
  const json = JSON.parse(text) as { access_token: string; refresh_token: string; token_type: string; expires_in: number };
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    token_type: json.token_type,
    expires_at: Date.now() + (json.expires_in - 60) * 1000,
  };
}

export async function exchangeCode(code: string): Promise<Token> {
  const token = await tokenRequest({ grant_type: 'authorization_code', code: code.trim() });
  await writeJson(paths.yahooToken(), token);
  return token;
}

export async function refreshToken(token: Token): Promise<Token> {
  const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: token.refresh_token });
  await writeJson(paths.yahooToken(), fresh);
  return fresh;
}

/** Return a valid access token, refreshing when it is about to expire. */
export async function getAccessToken(): Promise<string> {
  const file = paths.yahooToken();
  if (!existsSync(file)) throw new Error(`No Yahoo token at ${file}. Run: ./fh yahoo auth`);
  let token = await readJson<Token>(file);
  if (Date.now() >= token.expires_at) token = await refreshToken(token);
  return token.access_token;
}

/** Interactive CLI flow: print the URL, read the code from stdin. */
export async function authorizeInteractive(): Promise<void> {
  console.log('1. Open this URL in a browser and approve access:');
  console.log();
  console.log(`   ${authUrl()}`);
  console.log();
  console.log('2. Yahoo shows a short code. Paste it here.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const code = await rl.question('Code: ');
  rl.close();
  if (!code.trim()) throw new Error('No code entered');
  await exchangeCode(code);
  console.log(`Saved token to ${paths.yahooToken()}`);
}
