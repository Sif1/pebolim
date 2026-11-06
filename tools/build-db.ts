// Compile data/db/*.csv + competitions.json into public/db/base.json: npm run db
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDatabase } from '../src/engine/dbcsv';
import type { CompConfig } from '../src/engine/types';

const dir = 'data/db';
const season = Number(process.env.SEASON ?? 2026);
const comps = JSON.parse(readFileSync(join(dir, 'competitions.json'), 'utf8')) as CompConfig[];

// clubs*.csv and players*.csv files are concatenated (one file per league keeps them editable)
function concat(prefix: string): string {
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.csv'))
    .sort();
  let header = '';
  const body: string[] = [];
  for (const f of files) {
    const lines = readFileSync(join(dir, f), 'utf8').replace(/^﻿/, '').split(/\r?\n/);
    if (!header) header = lines[0];
    body.push(...lines.slice(1).filter((l) => l.trim()));
  }
  console.log(`${prefix}: ${files.length} file(s), ${body.length} rows`);
  return [header, ...body].join('\n');
}

const { db, issues } = buildDatabase(concat('clubs'), concat('players'), comps, season);

// crests found by tools/fetch-crests.ts (a crest column in a clubs file wins)
const crestFile = join(dir, 'crests.csv');
if (existsSync(crestFile)) {
  const crests = new Map<string, string>();
  for (const line of readFileSync(crestFile, 'utf8').split(/\r?\n/).slice(1)) {
    const [key, url] = line.split(',');
    if (key && /^https?:\/\//.test(url ?? '')) crests.set(key, url);
  }
  let n = 0;
  for (const c of db.clubs) {
    if (!c.crest && crests.has(c.key)) c.crest = crests.get(c.key);
    if (c.crest) n++;
  }
  console.log(`crests: ${n}/${db.clubs.length} clubs`);
}
for (const w of issues.warnings) console.warn('aviso:', w);
for (const e of issues.errors) console.error('erro:', e);
if (issues.errors.length) process.exit(1);
mkdirSync('public/db', { recursive: true });
writeFileSync('public/db/base.json', JSON.stringify(db));
console.log(`public/db/base.json: ${db.clubs.length} clubs, ${db.players.length} players, ${db.comps.length} competitions`);
