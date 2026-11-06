// How lively is the transfer market? Plays one season with two human clubs that list players, and counts
// AI listings, loans, auctions and sales.   npx tsx tools/marketsim.ts
import { readFileSync } from 'node:fs';
import { finishDate, simulateBackground } from '../src/engine/advance';
import { createManager, runCommand } from '../src/engine/commands';
import { prepareMatchday } from '../src/engine/matchday';
import { Rng } from '../src/engine/rng';
import type { GameState } from '../src/engine/types';
import { playerValue, squadOf } from '../src/engine/util';
import { createWorld } from '../src/engine/world';

const db = JSON.parse(readFileSync('public/db/base.json', 'utf8'));
const s: GameState = createWorld(db, { name: 'mkt', seed: process.argv[2] ?? 'mkt-1' });
const rng = new Rng(s.meta.rng);
const [ca, cb] = Object.values(s.clubs).filter((c) => c.league === 'BRA1');
const a = createManager(s, rng, 'A', ca.id);
createManager(s, rng, 'B', cb.id);
s.meta.rng = rng.state();
const season = s.meta.season;
// A lists three fringe players aged 30 or under: one at value, one at 1.5x value, one (young) for loan
const fringe = squadOf(s, ca.id)
  .filter((p) => season - p.birth <= 30)
  .sort((x, y) => x.str - y.str);
const loanee = fringe.find((p) => season - p.birth <= 23) ?? fringe[0];
const [fair, pricey] = fringe.filter((p) => p !== loanee).slice(6, 8);
runCommand(s, a.id, { c: 'setSale', pid: fair.id, price: playerValue(fair, season) });
runCommand(s, a.id, { c: 'setSale', pid: pricey.id, price: playerValue(pricey, season) * 1.5 });
runCommand(s, a.id, { c: 'setLoanList', pid: loanee.id, months: 6 });
const seen = { sale: new Set<number>(), loan: new Set<number>(), auction: new Set<number>() };
const present = new Set<string>();
let dates = 0;
while (s.meta.season === season && dates < 90) {
  for (const p of Object.values(s.players)) {
    if (p.salePrice != null) seen.sale.add(p.id);
    if (p.loanListed) seen.loan.add(p.id);
    if (p.auction) seen.auction.add(p.id);
  }
  const r = new Rng(s.meta.rng);
  const plan = prepareMatchday(s, r, present);
  s.meta.rng = r.state();
  finishDate(s, Object.values(simulateBackground(plan)), present);
  dates++;
}
const news = s.news.map((n) => n.text);
const count = (re: RegExp) => news.filter((t) => re.test(t)).length;
console.log(`${dates} dates played`);
console.log(`AI listings seen: ${seen.sale.size} for sale, ${seen.loan.size} for loan, ${seen.auction.size} auctions`);
console.log(`news: ${count(/emprestado por/)} loans, ${count(/Leilão: .* arrematado/)} auctions sold, ${count(/ninguém deu/)} auctions unsold, ${count(/é contratado pelo/)} transfers`);
for (const [label, p] of [['fair price', fair], ['1.5x price', pricey], ['loan 6m', loanee]] as const) {
  const where = p.clubId === ca.id ? 'still at A' : `moved to ${p.clubId != null ? s.clubs[p.clubId].name : 'nowhere'}`;
  console.log(`A's ${label} (${p.name}, ${p.pos} ${Math.round(p.str)}): ${where}${p.loan ? ' (on loan)' : ''}`);
}
const bids = Object.values(s.bids).filter((b) => b.seller === ca.id || b.seller === cb.id);
console.log(`AI bids received by the two humans: ${bids.length}`);
for (const t of news.filter((t) => /Leilão|emprestado por/.test(t)).slice(0, 8)) console.log('  ·', t);
