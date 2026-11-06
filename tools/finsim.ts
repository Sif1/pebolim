// Are clubs economically viable? Plays several seasons with only AI clubs and reports, per league and season,
// balances relative to yearly income, how many clubs are in the red, and where the money comes from.
//   npx tsx tools/finsim.ts [seasons] [seed]
import { readFileSync } from 'node:fs';
import { finishDate, simulateBackground } from '../src/engine/advance';
import { expectedTickets } from '../src/engine/economy';
import { prepareMatchday } from '../src/engine/matchday';
import { Rng } from '../src/engine/rng';
import type { Club, GameState, Ledger } from '../src/engine/types';
import { squadOf } from '../src/engine/util';
import { createWorld } from '../src/engine/world';

const SEASONS = Number(process.argv[2] ?? 3);
const db = JSON.parse(readFileSync('public/db/base.json', 'utf8'));
const s: GameState = createWorld(db, { name: 'fin', seed: process.argv[3] ?? 'fin-1' });
const LEAGUES = ['BRA1', 'BRA2', 'BRA3', 'ENG1', 'ENG2', 'ESP1', 'ITA1', 'GER1', 'FRA1', 'ARG1', 'URU1'];
const present = new Set<string>();

const med = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : 0;
};
const mi = (v: number) => (v / 1e6).toFixed(1);
const yearlyWages = (c: Club) => squadOf(s, c.id).reduce((a, p) => a + p.wage, 0) * 12;

function report(label: string, ledgers?: Map<number, Ledger>) {
  console.log(`\n=== ${label} ===`);
  console.log(
    'league  clubs  med.balance  bal/income  in red  deep red  wages/income  richest     poorest' +
      (ledgers ? '   in: tickets/spons+tv/prizes/sales  out: wages/upkeep/travel/buys/works (% of income)' : ''),
  );
  for (const lg of LEAGUES) {
    const clubs = Object.values(s.clubs).filter((c) => c.league === lg);
    if (!clubs.length) continue;
    const ratio = clubs.map((c) => c.balance / Math.max(1, c.baseIncome));
    const red = clubs.filter((c) => c.balance < 0).length;
    const deep = clubs.filter((c) => c.balance < -0.25 * c.baseIncome).length;
    const wi = clubs.map((c) => yearlyWages(c) / Math.max(1, c.baseIncome));
    const rich = clubs.reduce((a, c) => (c.balance > a.balance ? c : a));
    const poor = clubs.reduce((a, c) => (c.balance < a.balance ? c : a));
    let split = '';
    if (ledgers) {
      // the season's ledger (it resets when the next season starts, so the caller passes the last one)
      const t = { tickets: 0, base: 0, prizes: 0, sales: 0, wages: 0, upkeep: 0, travel: 0, buys: 0, works: 0 };
      for (const c of clubs) {
        const l = ledgers.get(c.id);
        if (!l) continue;
        t.tickets += l.tickets;
        t.base += l.sponsors + l.tv;
        t.prizes += l.prizes;
        t.sales += l.sales;
        t.wages += l.wages;
        t.upkeep += l.upkeep;
        t.travel += l.travel;
        t.buys += l.purchases;
        t.works += l.works;
      }
      const inc = t.tickets + t.base + t.prizes + t.sales || 1;
      const pct = (v: number) => Math.round((v / inc) * 100) + '%';
      split = `   in ${[t.tickets, t.base, t.prizes, t.sales].map(pct).join('/')}  out ${[t.wages, t.upkeep, t.travel, t.buys, t.works].map(pct).join('/')}`;
    }
    console.log(
      `${lg.padEnd(7)} ${String(clubs.length).padStart(5)}  ${mi(med(clubs.map((c) => c.balance))).padStart(10)}  ${med(ratio).toFixed(2).padStart(10)}  ${String(red).padStart(6)}  ${String(deep).padStart(8)}  ${med(wi).toFixed(2).padStart(12)}  ${rich.short.padEnd(4)} ${mi(rich.balance).padStart(6)}  ${poor.short.padEnd(4)} ${mi(poor.balance).padStart(6)}${split}`,
    );
  }
}

report(`start of ${s.meta.season}`);
let expected = new Map(Object.values(s.clubs).map((c) => [c.id, expectedTickets(s, c)]));
const ticketBias = (ledgers: Map<number, Ledger>) => {
  const out: string[] = [];
  for (const lg of LEAGUES) {
    const r = Object.values(s.clubs)
      .filter((c) => c.league === lg && expected.get(c.id))
      .map((c) => (ledgers.get(c.id)?.tickets ?? 0) / expected.get(c.id)!);
    out.push(`${lg} ${med(r).toFixed(2)}`);
  }
  console.log('tickets actual/expected:', out.join('  '));
};
for (let k = 0; k < SEASONS; k++) {
  const season = s.meta.season;
  let last = new Map<number, Ledger>();
  let guard = 0;
  while (s.meta.season === season && guard++ < 120) {
    last = new Map(Object.values(s.clubs).map((c) => [c.id, { ...c.ledger }]));
    const rng = new Rng(s.meta.rng);
    const plan = prepareMatchday(s, rng, present);
    s.meta.rng = rng.state();
    finishDate(s, Object.values(simulateBackground(plan)), present);
  }
  report(`after season ${season}`, last);
  ticketBias(last);
  expected = new Map(Object.values(s.clubs).map((c) => [c.id, expectedTickets(s, c)]));
}
