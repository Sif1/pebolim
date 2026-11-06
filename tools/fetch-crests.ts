// Finds each club's crest on Wikipedia and writes data/db/crests.csv (key, crest image URL, wiki, article title).
//   npx tsx tools/fetch-crests.ts            only clubs missing from crests.csv
//   npx tsx tools/fetch-crests.ts --force    look everything up again
//   npx tsx tools/fetch-crests.ts --only=key1,key2
// The game links to the images on Wikimedia; nothing is copied into the repository.
// A wrong or missing crest can be fixed by editing crests.csv (any image URL works); then run npm run db.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'data/db';
const OUT = join(DIR, 'crests.csv');
const UA = 'PebolimManager/1.0 (https://github.com/Sif1/pebolim; personal hobby game)';
const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');

interface Club {
  key: string;
  name: string;
  city: string;
  country: string;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function readClubs(): Club[] {
  const clubs: Club[] = [];
  for (const f of readdirSync(DIR).filter((x) => x.startsWith('clubs') && x.endsWith('.csv'))) {
    const lines = readFileSync(join(DIR, f), 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
    const head = parseCsvLine(lines[0]);
    for (const l of lines.slice(1)) {
      const r = Object.fromEntries(head.map((h, i) => [h, parseCsvLine(l)[i] ?? '']));
      clubs.push({ key: r.key, name: r.name, city: r.city, country: r.country });
    }
  }
  return clubs;
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

function readExisting(): Map<string, string[]> {
  const m = new Map<string, string[]>();
  if (!existsSync(OUT)) return m;
  const lines = readFileSync(OUT, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  for (const l of lines.slice(1)) {
    const r = parseCsvLine(l);
    m.set(r[0], r);
  }
  return m;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let last = 0;

async function api(lang: string, params: Record<string, string>): Promise<any> {
  const url = `https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams({ format: 'json', ...params });
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = 1100 - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    const text = await res.text();
    if (res.status === 429 || text.startsWith('You are making too many')) {
      await sleep(5000 * (attempt + 1));
      continue;
    }
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  return null;
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const STOP = new Set(
  'clube club futebol football fc cf sc ec ac afc fk sk cd ca cs us as ss sv vfb vfl tsg fsv bv de da do das dos del la el los las le les the and e y of sport sports esporte esportiva esportivo sociedade sociedad associacao asociacion atletico athletico recreativo regatas real calcio olympique ssc ssd acf rc rcd ud sd cp fbc sad 1 1899 1904 1909 1910 futbol city'
    .split(' '),
);

/** Distinctive words of the club name that the article title must contain. */
function tokens(name: string): string[] {
  const t = norm(name)
    .split(' ')
    .filter((w) => w.length >= 3 && !STOP.has(w));
  return t.length ? t : norm(name).split(' ').filter((w) => w.length >= 3);
}

const LOGO = /\.(svg|png|gif)$/i;
const NOT_LOGO = /(flag|bandeira|bandera|drapeau|mapa|\bmap|locator|location|estadio|stadium|stade|stadion|uniform|kit|maillot|trikot|camisa|jersey|foto|photo|torcida|panorama|team|squad|elenco)/i;

const WIKIS: Record<string, { lang: string; word: string }[]> = {
  BRA: [{ lang: 'pt', word: 'futebol' }],
  ESP: [{ lang: 'es', word: 'fútbol' }, { lang: 'pt', word: 'futebol' }],
  ITA: [{ lang: 'it', word: 'calcio' }, { lang: 'pt', word: 'futebol' }],
  FRA: [{ lang: 'fr', word: 'football' }, { lang: 'pt', word: 'futebol' }],
  GER: [{ lang: 'de', word: 'Fußball' }, { lang: 'pt', word: 'futebol' }],
};
const SPANISH = new Set(['ARG', 'URU', 'CHI', 'COL', 'PAR', 'ECU', 'PER', 'BOL', 'VEN']);

function wikisFor(country: string) {
  if (WIKIS[country]) return [...WIKIS[country], { lang: 'en', word: 'football' }];
  if (SPANISH.has(country)) return [{ lang: 'es', word: 'fútbol' }, { lang: 'pt', word: 'futebol' }, { lang: 'en', word: 'football' }];
  return [{ lang: 'pt', word: 'futebol' }, { lang: 'en', word: 'football' }, { lang: 'es', word: 'fútbol' }];
}

/** Clubs the search gets wrong (a namesake, the city, a rivalry page…): the exact article to use. */
const TITLES: Record<string, [string, string]> = {
  coritiba: ['pt', 'Coritiba Foot Ball Club'],
  americamg: ['pt', 'América Futebol Clube (Belo Horizonte)'],
  criciuma: ['pt', 'Criciúma Esporte Clube'],
  csa: ['pt', 'Centro Sportivo Alagoano'],
  voltaredonda: ['pt', 'Volta Redonda Futebol Clube'],
  itabaiana: ['pt', 'Associação Olímpica de Itabaiana'],
  maranhao: ['pt', 'Maranhão Atlético Clube'],
  boavista: ['pt', 'Boavista Sport Club'],
  horizonte: ['pt', 'Horizonte Futebol Clube'],
  uchile: ['es', 'Club Universidad de Chile'],
  guaranipar: ['es', 'Club Guaraní'],
  libertad: ['es', 'Club Libertad'],
  cuenca: ['es', 'Club Deportivo Cuenca'],
  ucv: ['es', 'Universidad Central de Venezuela Fútbol Club'],
  hearts: ['pt', 'Heart of Midlothian Football Club'],
  crvenazvezda: ['pt', 'Fudbalski Klub Crvena Zvezda'],
  villarreal: ['es', 'Villarreal Club de Fútbol'],
  crb: ['pt', 'Clube de Regatas Brasil'],
  urt: ['pt', 'União Recreativa dos Trabalhadores'],
  brasilpelotas: ['pt', 'Grêmio Esportivo Brasil'],
  guaranybage: ['pt', 'Guarany Futebol Clube (Bagé)'],
  barcelonailheus: ['pt', 'Barcelona Futebol Clube (Ilhéus)'],
  crac: ['pt', 'Clube Recreativo e Atlético Catalano'],
  nacionalpar: ['es', 'Club Nacional (Paraguay)'],
  tachira: ['es', 'Deportivo Táchira Fútbol Club'],
  vitoriasc: ['pt', 'Vitória Sport Clube'],
  aek: ['pt', 'AEK Atenas FC'],
  copenhagen: ['pt', 'FC København'],
  cadiz: ['es', 'Cádiz Club de Fútbol'],
  burgos: ['es', 'Burgos Club de Fútbol'],
  cordoba: ['es', 'Córdoba Club de Fútbol'],
  ceuta: ['es', 'Agrupación Deportiva Ceuta Fútbol Club'],
  udinese: ['it', 'Udinese Calcio'],
  reggiana: ['it', 'Associazione Calcio Reggiana 1919'],
  avellino: ['it', 'Unione Sportiva Avellino 1912'],
  wolfsburg: ['de', 'VfL Wolfsburg'],
  hamburgo: ['de', 'Hamburger SV'],
  koln: ['de', '1. FC Köln'],
  heidenheim: ['de', '1. FC Heidenheim 1846'],
  bochum: ['de', 'VfL Bochum'],
  nurnberg: ['de', '1. FC Nürnberg'],
  lyon: ['fr', 'Olympique lyonnais'],
  rennes: ['fr', 'Stade rennais football club'],
  saintetienne: ['fr', 'Association sportive de Saint-Étienne'],
  reims: ['fr', 'Stade de Reims'],
  grenoble: ['fr', 'Grenoble Foot 38'],
  laval: ['fr', 'Stade lavallois Mayenne Football Club'],
  rosariocentral: ['es', 'Club Atlético Rosario Central'],
  nacionaluru: ['es', 'Club Nacional de Football'],
  inter: ['it', 'Football Club Internazionale Milano'],
  bayern: ['de', 'FC Bayern München'],
  hertha: ['de', 'Hertha BSC'],
  arsenalsar: ['es', 'Arsenal Fútbol Club'],
  moron: ['es', 'Club Deportivo Morón'],
  liverpooluru: ['es', 'Liverpool Fútbol Club'],
  racinguru: ['es', 'Racing Club de Montevideo'],
  riverplateuru: ['es', 'Club Atlético River Plate (Uruguay)'],
  fenix: ['es', 'Centro Atlético Fénix'],
  miramar: ['es', 'Club Social y Deportivo Miramar Misiones'],
  colonuru: ['es', 'Colón Fútbol Club'],
  oriental: ['es', 'Club Atlético Oriental (La Paz)'],
};

async function byTitle(lang: string, title: string): Promise<{ url: string; wiki: string; title: string } | null> {
  const data = await api(lang, { action: 'query', titles: title, redirects: '1', prop: 'pageimages', piprop: 'thumbnail|name', pithumbsize: '120' });
  const p = Object.values<any>(data?.query?.pages ?? {})[0];
  if (!p?.thumbnail?.source) return null;
  return { url: String(p.thumbnail.source).split('?')[0], wiki: lang, title: p.title };
}

async function findCrest(c: Club): Promise<{ url: string; wiki: string; title: string } | null> {
  const fixed = TITLES[c.key];
  if (fixed) {
    // the exact article, on its own wiki and then under the same title elsewhere; never a search (a shield beats a wrong crest)
    for (const lang of [fixed[0], 'pt', 'en', 'it', 'es'].filter((l, i, a) => a.indexOf(l) === i)) {
      const r = await byTitle(lang, fixed[1]);
      if (r) return r;
    }
    return null;
  }
  const want = tokens(c.name);
  for (const w of wikisFor(c.country)) {
    for (const q of [`${c.name} ${c.city} ${w.word}`, `${c.name} ${w.word}`]) {
      const data = await api(w.lang, {
        action: 'query',
        generator: 'search',
        gsrsearch: q,
        gsrlimit: '6',
        prop: 'pageimages',
        piprop: 'thumbnail|name',
        pithumbsize: '120',
        pilimit: '6',
      });
      const pages = Object.values<any>(data?.query?.pages ?? {}).sort((a, b) => a.index - b.index);
      for (const p of pages) {
        const t = norm(p.title);
        if (!want.every((w2) => t.includes(w2))) continue;
        if (!p.pageimage || !p.thumbnail?.source || !LOGO.test(p.pageimage) || NOT_LOGO.test(p.pageimage)) continue;
        return { url: String(p.thumbnail.source).split('?')[0], wiki: w.lang, title: p.title };
      }
    }
  }
  return null;
}

const clubs = readClubs().filter((c) => !only || only.includes(c.key));
const existing = readExisting();
let found = 0;
let missing: string[] = [];
let n = 0;
for (const c of clubs) {
  n++;
  const prev = existing.get(c.key);
  if (prev && prev[1] && !force) {
    found++;
    continue;
  }
  const r = await findCrest(c);
  if (r) {
    existing.set(c.key, [c.key, r.url, r.wiki, r.title]);
    found++;
    console.log(`[${n}/${clubs.length}] ${c.name} -> ${r.wiki}: ${r.title}`);
  } else {
    // a forced re-run that finds nothing drops the old pick (it was probably the wrong one)
    if (!prev || force) existing.set(c.key, [c.key, '', '', '']);
    missing.push(c.name);
    console.log(`[${n}/${clubs.length}] ${c.name} -> (not found)`);
  }
  // save as we go so an interrupted run keeps its progress
  if (n % 10 === 0 || n === clubs.length) {
    const rows = [...existing.values()].sort((a, b) => a[0].localeCompare(b[0]));
    writeFileSync(OUT, ['key,crest,wiki,title', ...rows.map((r) => r.map(csvCell).join(','))].join('\n') + '\n');
  }
}
const rows = [...existing.values()].sort((a, b) => a[0].localeCompare(b[0]));
writeFileSync(OUT, ['key,crest,wiki,title', ...rows.map((r) => r.map(csvCell).join(','))].join('\n') + '\n');
console.log(`\n${found}/${clubs.length} clubs with a crest. Missing: ${missing.join(', ') || 'none'}`);
