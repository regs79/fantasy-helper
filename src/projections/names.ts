const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

/** Lowercase, strip accents, punctuation and generational suffixes, so names from different sources match. */
export function normalizeName(name: string): string {
  const parts = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  while (parts.length > 1 && SUFFIXES.has(parts[parts.length - 1]!)) parts.pop();
  return parts.join(' ');
}

export function slug(name: string): string {
  return normalizeName(name).replace(/\s+/g, '-');
}
