// Career check: plays several seasons with four human clubs (a giant, a mid-table side and a small club in Brazil,
// plus a mid-table English side) run by a sensible manager (the AI coach in matches, automatic line-ups, automatic
// contract renewals, sells to generous AI bids), and reports what a player would live through: results, the
// board's patience, money, the squad's strength, the market, the news, and how the wider world evolves.
//   npx tsx tools/career.ts [seasons] [seed]
import { readFileSync } from 'node:fs';
import { finishDate, simulateBackground } from '../src/engine/advance';
import { createManager, runCommand } from '../src/engine/commands';
import { wageBudget } from '../src/engine/economy';
import { MatchSim, type MatchResult } from '../src/engine/match/core';
import { prepareMatchday } from '../src/engine/matchday';
import { Rng } from '../src/engine/rng';
import type { Club, GameState, Manager } from '../src/engine/types';
import { age, playerValue, squadOf } from '../src/engine/util';
import { createWorld } from '../src/engine/world';

const SEASONS = Number(process.argv[2] ?? 4);
const db = JSON.parse(readFileSync('public/db/base.json', 'utf8'));
const realNames = new Set<string>(db.players.map((p: { name: string }) => p.name));
const s: GameState = createWorld(db, { name: 'career', seed: process.argv[3] ?? 'career-1' });
const rng0 = new Rng(s.meta.rng);

const byPower = (lg: string) => Object.values(s.clubs).filter((c) => c.league === lg).sort((a, b) => b.power - a.power);
const picks: [string, Club][] = [
  ['gigante BRA1', byPower('BRA1')[0]],
  ['médio BRA1', byPower('BRA1')[9]],
  ['pequeno BRA3', byPower('BRA3')[12]],
  ['médio ENG1', byPower('ENG1')[10]],
];
const humans: { label: string; m: Manager }[] = picks.map(([label, c]) => ({ label, m: createManager(s, rng0, label, c.id) }));
s.meta.rng = rng0.state();
const present = new Set(humans.map((h) => h.m.id));
for (const h of humans) runCommand(s, h.m.id, { c: 'setAutoRenewAll', on: true });

interface Track {
  confMin: number;
  bids: number;
  sold: number;
  soldFee: number;
  injuries: number;
  news: number;
  matches: number;
  fitSum: number;
  fitN: number;
  fitMin: number;
  opportunities: number;
  oppDates: number;
  startStr: number;
  startBal: number;
  youth: number;
  youthStars: number[];
  fired: string | null;
  /** the club and the board's objective at the start of the season */
  clubId: number | null;
  goal: string | null;
}
const top14 = (c: Club) => {
  const sq = squadOf(s, c.id).sort((a, b) => b.str - a.str).slice(0, 14);
  return sq.reduce((a, p) => a + p.str, 0) / Math.max(1, sq.length);
};
const clubOf = (m: Manager) => (m.clubId != null ? s.clubs[m.clubId] : null);
const newTrack = (m: Manager): Track => {
  const c = clubOf(m);
  return {
    confMin: 100,
    bids: 0,
    sold: 0,
    soldFee: 0,
    injuries: 0,
    news: 0,
    matches: 0,
    fitSum: 0,
    fitN: 0,
    fitMin: 100,
    opportunities: 0,
    oppDates: 0,
    startStr: c ? top14(c) : 0,
    startBal: c?.balance ?? 0,
    youth: 0,
    youthStars: [],
    fired: null,
    clubId: c?.id ?? null,
    goal: c?.board.goal ?? null,
  };
};

const mi = (v: number) => `${(v / 1e6).toFixed(1)}`;
const world: string[] = [];
for (let season = 0; season < SEASONS; season++) {
  const year = s.meta.season;
  const tracks = new Map(humans.map((h) => [h.m.id, newTrack(h.m)]));
  const known = new Map(humans.map((h) => [h.m.id, new Set(clubOf(h.m) ? squadOf(s, clubOf(h.m)!.id).map((p) => p.id) : [])]));
  let newsSeen = s.meta.next.news;
  let guard = 0;
  while (s.meta.season === year && guard++ < 120) {
    // the manager's turn: answer bids, look at the market
    for (const h of humans) {
      const c = clubOf(h.m);
      const t = tracks.get(h.m.id)!;
      if (!c) {
        // fired: take the first job offered
        if (h.m.offers.length) runCommand(s, h.m.id, { c: 'acceptJob', clubId: h.m.offers[0].clubId });
        continue;
      }
      const starters = new Set(squadOf(s, c.id).sort((a, b) => b.str - a.str).slice(0, 11).map((p) => p.id));
      for (const b of Object.values(s.bids)) {
        if (b.seller !== c.id || b.status !== 'pendente') continue;
        t.bids++;
        const p = s.players[b.player];
        const good = p && b.fee >= playerValue(p, year) * 1.25 && !starters.has(p.id);
        if (good) {
          const r = runCommand(s, h.m.id, { c: 'respondBid', bid: b.id, action: 'aceitar' });
          if (r.ok) {
            t.sold++;
            t.soldFee += b.fee;
          }
        } else runCommand(s, h.m.id, { c: 'respondBid', bid: b.id, action: 'recusar' });
      }
      // affordable upgrades on the market (listed or in auction, better than the club's median starter)
      const cal = s.calendar[s.meta.date];
      if (cal?.window) {
        const sq = squadOf(s, c.id).sort((a, b) => b.str - a.str);
        const bar = sq[Math.min(sq.length - 1, 6)]?.str ?? 60;
        const budget = c.balance * 0.5;
        t.oppDates++;
        t.opportunities += Object.values(s.players).filter(
          (p) => p.clubId !== c.id && (p.salePrice != null || p.auction) && p.str > bar && (p.salePrice ?? p.auction!.min) <= budget,
        ).length;
      }
      const sq = squadOf(s, c.id).sort((a, b) => b.str - a.str).slice(0, 14);
      for (const p of sq) {
        t.fitSum += p.fitness;
        t.fitN++;
      }
      t.fitMin = Math.min(t.fitMin, sq.reduce((a, p) => a + p.fitness, 0) / Math.max(1, sq.length));
    }
    const rng = new Rng(s.meta.rng);
    const plan = prepareMatchday(s, rng, present);
    s.meta.rng = rng.state();
    const results: Record<number, MatchResult> = simulateBackground(plan);
    for (const setup of plan.setups) {
      if (!plan.live.includes(setup.fixtureId)) continue;
      // the human sides manage like the AI coach does
      setup.home.ai = true;
      setup.away.ai = true;
      results[setup.fixtureId] = new MatchSim(setup).runToEnd();
    }
    for (const h of humans) {
      const c = clubOf(h.m);
      if (c && plan.setups.some((x) => plan.live.includes(x.fixtureId) && (x.home.clubId === c.id || x.away.clubId === c.id))) tracks.get(h.m.id)!.matches++;
    }
    finishDate(s, Object.values(results), present);
    for (const n of s.news.filter((n) => n.id >= newsSeen)) {
      for (const h of humans) {
        const c = clubOf(h.m);
        const t = tracks.get(h.m.id)!;
        if (n.to === h.m.id || (c && n.clubs.includes(c.id))) {
          t.news++;
          if (n.kind === 'injury') t.injuries++;
          if (n.kind === 'fired' && n.text.startsWith(h.m.name)) t.fired = n.text;
        }
      }
    }
    newsSeen = s.meta.next.news;
    for (const h of humans) {
      const c = clubOf(h.m);
      if (c) tracks.get(h.m.id)!.confMin = Math.min(tracks.get(h.m.id)!.confMin, c.board.conf);
    }
  }

  // season report
  console.log(`\n================ temporada ${year} ================`);
  for (const h of humans) {
    const t = tracks.get(h.m.id)!;
    const c = clubOf(h.m);
    const hist = s.history.find((x) => x.season === year);
    const lg = Object.entries(s.prev.ranks).find(([, order]) => c && order.includes(c.id));
    const pos = lg ? lg[1].indexOf(c!.id) + 1 : null;
    const titles = hist ? Object.entries(hist.champions).filter(([, cid]) => cid === c?.id).map(([comp]) => comp) : [];
    const wages = c ? squadOf(s, c.id).reduce((a, p) => a + p.wage, 0) * 12 : 0;
    const young = c ? squadOf(s, c.id).filter((p) => age(p, s.meta.season) <= 18 && !known.get(h.m.id)!.has(p.id)) : [];
    console.log(
      `${h.label.padEnd(14)} ${(c?.name ?? 'desempregado').padEnd(22)} ${lg ? `${lg[0]} ${pos}º` : '—'.padEnd(8)}${titles.length ? ` 🏆${titles.join(',')}` : ''}${t.fired ? ' [DEMITIDO]' : ''}`,
    );
    // where the season started: objective and final league position (also for a manager who lost his job)
    const c0 = t.clubId != null ? s.clubs[t.clubId] : null;
    const lg0 = c0 ? Object.entries(s.prev.ranks).find(([, order]) => order.includes(c0.id)) : null;
    const sacked = h.m.history.filter((x) => x.season === year && x.note.startsWith('Demitido')).map((x) => `${s.clubs[x.clubId]?.short}: ${x.note}`);
    console.log(
      `    início: ${c0?.name ?? '—'} · objetivo ${t.goal ?? '—'} · terminou ${lg0 ? `${lg0[0]} ${lg0[1].indexOf(c0!.id) + 1}º` : '—'}${sacked.length ? ` · ${sacked.join('; ')}` : ''}`,
    );
    console.log(
      `    diretoria mín. ${t.confMin.toFixed(0)} · fim ${c ? c.board.conf.toFixed(0) : '—'} | caixa ${mi(t.startBal)} → ${mi(c?.balance ?? 0)} mi · folha ${c ? Math.round((wages / Math.max(1, wageBudget(s, c))) * 100) : 0}% do orçamento | força top14 ${t.startStr.toFixed(1)} → ${c ? top14(c).toFixed(1) : '—'}`,
    );
    console.log(
      `    ${t.matches} jogos · energia média dos 14 ${(t.fitSum / Math.max(1, t.fitN)).toFixed(0)}% (pior rodada ${t.fitMin.toFixed(0)}%) · ${t.injuries} lesões · ${t.bids} propostas da IA (${t.sold} vendas, ${mi(t.soldFee)} mi) · ${(t.opportunities / Math.max(1, t.oppDates)).toFixed(1)} reforços acessíveis por rodada de janela · ${young.length} jovens da base (${young.map((p) => p.stars).join(',') || '—'}★) · ${t.news} notícias (${(t.news / 78).toFixed(1)}/rodada)`,
    );
  }
  // the wider world
  const hist = s.history.find((x) => x.season === year);
  const champs = ['BRA1', 'ENG1', 'ESP1', 'ITA1', 'GER1', 'FRA1', 'LIB', 'UCL'].map((id) => `${id} ${hist?.champions[id] != null ? s.clubs[hist.champions[id]].short : '—'}`);
  const all = Object.values(s.players).filter((p) => p.clubId != null);
  const top = [...all].sort((a, b) => b.str - a.str).slice(0, 100);
  const lgStr = (lg: string) => {
    const cs = Object.values(s.clubs).filter((c) => c.league === lg);
    return (cs.reduce((a, c) => a + c.power, 0) / cs.length).toFixed(1);
  };
  const line = `${year}: campeões ${champs.join(' ')} | top100 força média ${(top.reduce((a, p) => a + p.str, 0) / 100).toFixed(1)}, reais ${top.filter((p) => realNames.has(p.name)).length}/100 | força média BRA1 ${lgStr('BRA1')} ENG1 ${lgStr('ENG1')} BRA3 ${lgStr('BRA3')} | livres ${Object.values(s.players).filter((p) => p.clubId == null).length}`;
  world.push(line);
  console.log(line);
}
console.log('\nMundo, temporada a temporada:');
for (const w of world) console.log('  ' + w);
