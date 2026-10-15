/**
 * Yahoo's JSON is XML translated mechanically: arrays of single-key objects,
 * objects with "0","1",... keys plus "count", and nested wrappers. `unwrap`
 * turns that into ordinary nested objects. Repeated keys become arrays, so
 * use `asArray` on anything that can have one or many entries.
 */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

function isPlainObject(v: unknown): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isIndexedCollection(o: Record<string, Json>): boolean {
  const keys = Object.keys(o);
  if (keys.length === 0) return false;
  return keys.every((k) => /^\d+$/.test(k) || k === 'count') && keys.some((k) => /^\d+$/.test(k));
}

export function unwrap(node: Json): Json {
  if (Array.isArray(node)) {
    const items = node.map(unwrap);
    if (items.length > 0 && items.every(isPlainObject)) {
      const merged: Record<string, Json> = {};
      for (const item of items as Record<string, Json>[]) {
        for (const [k, v] of Object.entries(item)) {
          if (k in merged) {
            const existing = merged[k];
            merged[k] = Array.isArray(existing) && (existing as Json[]).length && !Array.isArray(item[k]) ? [...(existing as Json[]), v] : [existing as Json, v];
          } else {
            merged[k] = v;
          }
        }
      }
      return merged;
    }
    return items;
  }
  if (isPlainObject(node)) {
    if (isIndexedCollection(node)) {
      return Object.keys(node)
        .filter((k) => /^\d+$/.test(k))
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => unwrap(node[k]!));
    }
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(node)) out[k] = unwrap(v);
    return out;
  }
  return node;
}

export function asArray<T = Json>(v: unknown): T[] {
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v]) as T[];
}

/** Walk a path like "fantasy_content.league.players" through unwrapped JSON. */
export function dig(node: Json, path: string): Json {
  let cur: Json = node;
  for (const part of path.split('.')) {
    if (!part) continue;
    if (Array.isArray(cur)) {
      const idx = Number(part);
      cur = Number.isInteger(idx) ? (cur[idx] ?? null) : ((cur.find((x) => isPlainObject(x) && part in x) as Record<string, Json> | undefined)?.[part] ?? null);
    } else if (isPlainObject(cur)) {
      cur = cur[part] ?? null;
    } else {
      return null;
    }
  }
  return cur;
}
