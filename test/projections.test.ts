import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  autoMap,
  buildProjections,
  importCsvText,
  normalizeHeader,
  normalizeName,
  parseCell,
  parseCsv,
  parsePositions,
  slug,
} from '../src/projections/index.js';

describe('csv parser', () => {
  it('handles quotes, escaped quotes, and CRLF', () => {
    const rows = parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n\r\n1,2\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
      ['1', '2'],
    ]);
  });
});

describe('names', () => {
  it('normalizes accents, punctuation, and suffixes', () => {
    expect(normalizeName('Nikola Jokić')).toBe('nikola jokic');
    expect(normalizeName('Jaren Jackson Jr.')).toBe('jaren jackson');
    expect(normalizeName("De'Aaron Fox")).toBe('de aaron fox');
    expect(normalizeName('Gary Trent Jr')).toBe('gary trent');
    expect(slug('Shai Gilgeous-Alexander')).toBe('shai-gilgeous-alexander');
  });
});

describe('cells', () => {
  it('parses plain numbers, percents, and made/attempted composites', () => {
    expect(parseCell('12.3')).toEqual({ value: 12.3 });
    expect(parseCell('1,234')).toEqual({ value: 1234 });
    expect(parseCell('48.5%')).toEqual({ value: 48.5 });
    expect(parseCell('8.1/15.8')).toEqual({ value: 8.1 / 15.8, num: 8.1, den: 15.8 });
    expect(parseCell('0.512 (8.1/15.8)')).toEqual({ value: 0.512, num: 8.1, den: 15.8 });
    expect(parseCell('')).toEqual({});
    expect(parseCell('-')).toEqual({});
  });

  it('parses position lists', () => {
    expect(parsePositions('PG, SG')).toEqual(['PG', 'SG']);
    expect(parsePositions('PF/C')).toEqual(['PF', 'C']);
    expect(parsePositions('G')).toEqual(['G']);
    expect(parsePositions('')).toEqual([]);
  });
});

describe('header mapping', () => {
  it('normalizes headers', () => {
    expect(normalizeHeader('FG%')).toBe('fgpct');
    expect(normalizeHeader('3PM')).toBe('3pm');
    expect(normalizeHeader('Three Pointers Made')).toBe('3pointersmade');
    expect(normalizeHeader('TO')).toBe('to');
  });

  it('auto-maps common header styles', () => {
    const m = autoMap(['Player', 'Tm', 'Pos', 'G', 'MP', 'FG', 'FGA', 'FG%', 'FT', 'FTA', 'FT%', '3P', 'ORB', 'DRB', 'TRB', 'AST', 'STL', 'BLK', 'TOV', 'PTS']);
    expect(m).toMatchObject({
      name: 'Player', team: 'Tm', positions: 'Pos', gp: 'G', mpg: 'MP',
      fgm: 'FG', fga: 'FGA', fg_pct: 'FG%', ftm: 'FT', fta: 'FTA', ft_pct: 'FT%',
      tpm: '3P', oreb: 'ORB', dreb: 'DRB', reb: 'TRB', ast: 'AST', stl: 'STL', blk: 'BLK', tov: 'TOV', pts: 'PTS',
    });
  });

  it('explicit overrides win and are not reused', () => {
    const m = autoMap(['Name', 'Threes', 'TO'], { tpm: 'Threes' });
    expect(m.tpm).toBe('Threes');
    expect(m.tov).toBe('TO');
    expect(m.name).toBe('Name');
  });
});

describe('building projections', () => {
  it('derives made from attempts and percent, and splits REB by position', () => {
    const r = importCsvText(
      'Player,Pos,GP,PTS,REB,AST,STL,BLK,3PM,FG%,FGA,FT%,FTA,TO\nBig Man,C,70,20,10,2,1,2,0,60,10,70,4,2\nPoint God,PG,80,15,5,9,1.5,0.2,2,45,12,90,3,3\n',
    );
    expect(r.warnings.some((w) => w.includes('Only total REB'))).toBe(true);
    const [big, pg] = r.projections;
    expect(big!.fgm).toBeCloseTo(6);
    expect(big!.ftm).toBeCloseTo(2.8);
    expect(big!.oreb).toBeCloseTo(3);
    expect(big!.dreb).toBeCloseTo(7);
    expect(pg!.oreb).toBeCloseTo(0.8);
    expect(pg!.dreb).toBeCloseTo(4.2);
    expect(pg!.id).toBe('point-god');
    expect(r.totals).toBe(false);
  });

  it('uses a reference OREB share when given', () => {
    const r = importCsvText('Player,REB\nSome Guy,10\n', { orebShare: { 'some-guy': 0.4 } });
    expect(r.projections[0]!.oreb).toBeCloseTo(4);
    expect(r.projections[0]!.dreb).toBeCloseTo(6);
  });

  it('derives attempts from made and percent, and reads composite FGM/FGA cells', () => {
    const r = importCsvText('Player,FGM,FG%,FT%,OREB,DREB\nA,5,50%,8/10,1,2\n');
    const p = r.projections[0]!;
    expect(p.fga).toBeCloseTo(10);
    expect(p.ftm).toBeCloseTo(8);
    expect(p.fta).toBeCloseTo(10);
  });

  it('converts season totals to per game when GP is present', () => {
    const r = importCsvText('Player,GP,PTS,OREB,DREB,AST\nA,80,2000,80,400,400\n');
    expect(r.totals).toBe(true);
    expect(r.projections[0]!.pts).toBeCloseTo(25);
    expect(r.projections[0]!.ast).toBeCloseTo(5);
    expect(r.projections[0]!.gp).toBe(80);
  });

  it('respects an explicit totals=false', () => {
    const r = importCsvText('Player,GP,PTS\nA,80,2000\n', { totals: false });
    expect(r.projections[0]!.pts).toBe(2000);
  });

  it('fails clearly without a name column', () => {
    expect(() => buildProjections([{ X: '1' }], { mapping: {} })).toThrow(/name/);
  });

  it('imports the bundled sample', async () => {
    const text = await readFile(new URL('../samples/projections-sample.csv', import.meta.url), 'utf8');
    const r = importCsvText(text);
    expect(r.projections.length).toBeGreaterThan(40);
    const jokic = r.projections.find((p) => p.id === 'nikola-jokic')!;
    expect(jokic.fgm).toBeCloseTo(18.2 * 0.57);
    expect(jokic.oreb + jokic.dreb).toBeCloseTo(12.4);
    expect(jokic.positions).toEqual(['C']);
  });
});
