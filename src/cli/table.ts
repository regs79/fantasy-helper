/** Render rows as a padded text table. Numbers are right-aligned. */
export function table(headers: string[], rows: (string | number)[][]): string {
  const cells = rows.map((r) => r.map((c) => (typeof c === 'number' ? fmt(c) : String(c ?? ''))));
  const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((r) => r[i]?.length ?? 0)));
  const isNum = headers.map((_, i) => rows.length > 0 && rows.every((r) => typeof r[i] === 'number'));
  const line = (r: string[]) => r.map((c, i) => (isNum[i] ? c.padStart(widths[i]!) : c.padEnd(widths[i]!))).join('  ');
  return [line(headers), widths.map((w) => '-'.repeat(w)).join('  '), ...cells.map(line)].join('\n');
}

export function fmt(n: number, digits = 1): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(digits);
}

export function money(n: number): string {
  return `$${Math.round(n)}`;
}
