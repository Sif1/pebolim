// Career check: plays several seasons with four human clubs (a giant, a mid-table side and a small club in Brazil,
// plus a mid-table English side) run by a sensible manager (the AI coach in matches, automatic line-ups, automatic
// contract renewals, sells to generous AI bids), and reports what a player would live through: results, the
// board's patience, money, the squad's strength, the market, the news, and how the wider world evolves.
//   npx tsx tools/career.ts [seasons] [seed] [--mix] [--active]
//   --mix     four clubs drawn from the seed (a Brazilian top-6 side, a Série A side, a Série B/C side, a European side)
//   --active  the manager also plays the market (free agents, listed players, auctions, pre-contracts), runs the
//             youth team, invests in the training centre and takes a clearly bigger job when one is offered
// Every round the state is checked for broken invariants (orphans, NaN, impossible tables…), printed as BUG lines.
import { coachRanking } from '../src/engine/coaches';
import { readFileSync } from 'node:fs';
import { finishDate, simulateBackground } from '../src/engine/advance';
import { createManager, PRE_CONTRACT_FROM, runCommand } from '../src/engine/commands';
import { tcClubCost, wageBudget } from '../src/engine/economy';
import { refusesClub, wageDemand } from '../src/engine/transfers';
import { juniorsOf } from '../src/engine/youth';
import { MatchSim, type MatchResult } from '../src/engine/match/core';
import { prepareMatchday } from '../src/engine/matchday';
import { Rng } from '../src/engine/rng';
import type { Club, GameState, Manager, Player } from '../src/engine/types';
import { age, playerValue, squadOf } from '../src/engine/util';
import { createWorld } from '../src/engine/world';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const posArgs = args.filter((a) => !a.startsWith('--'));
const SEASONS = Number(posArgs[0] ?? 4);
const SEED = posArgs[1] ?? 'career-1';
const ACTIVE = flags.has('--active');
const MIX = flags.has('--mix');
const db = JSON.parse(readFileSync('public/db/base.json', 'utf8'));
const realNames = new Set<string>(db.players.map((p: { name: string }) => p.name));
const s: GameState = createWorld(db, { name: 'career', seed: SEED });
const rng0 = new Rng(s.meta.rng);

const byPower = (lg: string) => Object.values(s.clubs).filter((c) => c.league === lg).sort((a, b) => b.power - a.power);
const pr = Rng.fromSeed(`picks:${SEED}`);
const euro = pr.pick(['ENG1', 'ESP1', 'ITA1', 'GER1', 'FRA1']);
const picks: [string, Club][] = MIX
  ? [
      ['gigante BRA1', byPower('BRA1')[pr.int(0, 5)]],
      ['médio BRA1', byPower('BRA1')[pr.int(7, 15)]],
      ['pequeno BRA2/3', byPower(pr.chance(0.5) ? 'BRA2' : 'BRA3')[pr.int(6, 17)]],
      [`médio ${euro}`, byPower(euro)[pr.int(4, 14)]],
    ]
  : [
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
  /** active manager: signings (fee, name), pre-contracts, youth promotions, job moves, things needing attention */
  signed: string[];
  spent: number;
  pre: number;
  promoted: number;
  moved: string[];
  attention: number;
  attentionMax: number;
  tries: number;
  refusals: string[];
  /** deadline-day bids received */
  late: number;
  invest: number;
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
    signed: [],
    spent: 0,
    pre: 0,
    promoted: 0,
    moved: [],
    attention: 0,
    attentionMax: 0,
    tries: 0,
    refusals: [],
    late: 0,
    invest: 0,
    clubId: c?.id ?? null,
    goal: c?.board.goal ?? null,
  };
};

const prevSquad = new Map<string, Set<number>>();
const prevClub = new Map<string, number>();
/** juniors ever seen at a human club, and the highest player id before the round (new ids = generated players) */
const promotedIds = new Set<number>();
let maxPid = 0;
const mi = (v: number) => `${(v / 1e6).toFixed(1)}`;
const world: string[] = [];

/** An active manager's round between matches: job moves, the market, pre-contracts, the youth team, investment. */
function activeTurn(m: Manager, c: Club, t: Track, year: number) {
  const better = m.offers
    .map((o) => s.clubs[o.clubId])
    .filter((x) => x && x.rep >= c.rep + 12)
    .sort((a, b) => b.rep - a.rep)[0];
  if (better) {
    const from = c.short;
    if (runCommand(s, m.id, { c: 'acceptJob', clubId: better.id }).ok) {
      t.moved.push(`${from}→${better.short}`);
      return;
    }
  }
  const squad = squadOf(s, c.id).sort((a, b) => b.str - a.str);
  const bar = squad[Math.min(squad.length - 1, 6)]?.str ?? 60;
  const room = wageBudget(s, c) - squad.reduce((a, p) => a + p.wage, 0) * 12;
  const cal = s.calendar[s.meta.date];
  if (cal?.window && s.meta.date % 2 === 0 && squad.length < 30) {
    const mine = new Set(Object.values(s.bids).filter((b) => b.buyer === c.id && b.status === 'pendente').map((b) => b.player));
    const cost = (p: Player) => (p.clubId == null ? 0 : (p.salePrice ?? Math.round((p.auction?.min ?? 0) * 1.05)));
    const pick = Object.values(s.players)
      .filter(
        (p) =>
          !p.junior &&
          !p.loan &&
          p.clubId !== c.id &&
          !mine.has(p.id) &&
          p.str > bar + 1 &&
          age(p, year) <= 31 &&
          (p.clubId == null || p.salePrice != null || p.auction != null) &&
          cost(p) <= c.balance * 0.6 &&
          !refusesClub(s, p, c) &&
          wageDemand(s, p, c) * 1.05 * 12 <= room,
      )
      .sort((a, b) => (b.str - bar) / (1 + cost(b) / 1e6) - (a.str - bar) / (1 + cost(a) / 1e6))[0];
    if (pick) {
      const wage = Math.round(wageDemand(s, pick, c) * 1.05);
      const r =
        pick.auction && pick.clubId != null
          ? runCommand(s, m.id, { c: 'auctionBid', pid: pick.id, amount: cost(pick) })
          : runCommand(s, m.id, { c: 'bid', pid: pick.id, kind: 'compra', fee: cost(pick), wage, years: 3 });
      if (r.ok) t.tries++;
      else t.refusals.push(r.msg);
    }
  }
  if (s.meta.date >= PRE_CONTRACT_FROM && t.pre < 2 && s.meta.date % 3 === 0) {
    const p = Object.values(s.players)
      .filter(
        (p) =>
          p.clubId != null &&
          p.clubId !== c.id &&
          !p.junior &&
          !p.pre &&
          !p.loan &&
          p.contractEnd === year &&
          p.str > bar + 2 &&
          age(p, year) <= 30 &&
          // the player card says when he won't come
          !refusesClub(s, p, c) &&
          wageDemand(s, p, c) * 12 <= room,
      )
      .sort((a, b) => b.str - a.str)[0];
    if (p) {
      const r = runCommand(s, m.id, { c: 'preContract', pid: p.id, wage: wageDemand(s, p, c), years: 3 });
      if (r.ok) t.pre++;
      else t.refusals.push(r.msg);
    }
  }
  for (const j of juniorsOf(s, c.id)) {
    const a = age(j, year);
    if (a >= 18 && j.stars >= 3 && squad.length < 30) {
      if (runCommand(s, m.id, { c: 'promoteYouth', pid: j.id }).ok) t.promoted++;
    } else if (a >= 19 && j.stars <= 1) runCommand(s, m.id, { c: 'releaseYouth', pid: j.id });
  }
  if (c.tc.level < 5 && c.tc.building <= 0 && c.balance > 3 * tcClubCost(c)) {
    if (runCommand(s, m.id, { c: 'upgradeTC' }).ok) t.invest++;
  }
}

/** Broken invariants: things that should never happen, whatever the players do. */
const bugsSeen = new Set<string>();
function checkState(where: string) {
  const out: string[] = [];
  const bad = (k: string, msg: string) => {
    if (bugsSeen.has(k)) return;
    bugsSeen.add(k);
    out.push(msg);
  };
  const nums = (o: object, keys: string[]) => keys.some((k) => !Number.isFinite((o as Record<string, number>)[k]));
  for (const p of Object.values(s.players)) {
    if (p.clubId != null && !s.clubs[p.clubId]) bad(`orphan:${p.id}`, `jogador ${p.name} num clube inexistente ${p.clubId}`);
    if (nums(p, ['str', 'fitness', 'morale', 'wage', 'pot', 'stars'])) bad(`nan:${p.id}`, `jogador ${p.name} com número inválido`);
    if (p.fitness < 0 || p.fitness > 100.001) bad(`fit:${p.id}`, `jogador ${p.name} com energia ${p.fitness}`);
    if (p.clubId != null && !p.junior && p.contractEnd < s.meta.season) {
      const c = s.clubs[p.clubId];
      bad(`ctr:${p.id}`, `jogador ${p.name} com contrato vencido em ${p.contractEnd} (${s.meta.season}) · ${c?.name} liga ${c?.league ?? '—'}${c?.managerId ? ' HUMANO' : ''}${p.loan ? ' emprestado' : ''} id ${p.id}`);
    }
    if (p.loan && (p.clubId == null || !s.clubs[p.loan.from])) bad(`loan:${p.id}`, `empréstimo inválido de ${p.name}`);
    // juniors left at a club whose manager moved on wait for the season end, but never past 20
    if (p.junior && (p.clubId == null || age(p, s.meta.season) > 20)) bad(`jun:${p.id}`, `júnior ${p.name} sem clube ou com mais de 20 anos`);
    if (p.pre && (!s.clubs[p.pre.club] || p.pre.club === p.clubId)) bad(`pre:${p.id}`, `pré-contrato inválido de ${p.name}`);
    if (p.str > 99.5 || p.str < 1) bad(`str:${p.id}`, `força fora da escala: ${p.name} ${p.str}`);
  }
  for (const c of Object.values(s.clubs)) {
    if (!Number.isFinite(c.balance)) bad(`bal:${c.id}`, `${c.name} com caixa inválido`);
    if (c.board.conf < 0 || c.board.conf > 100 || !Number.isFinite(c.board.conf)) bad(`conf:${c.id}`, `${c.name} com confiança ${c.board.conf}`);
    if ((c.fans ?? 60) < 0 || (c.fans ?? 60) > 100) bad(`fans:${c.id}`, `${c.name} com torcida ${c.fans}`);
    if (c.managerId && s.managers[c.managerId]?.clubId !== c.id) bad(`mgr:${c.id}`, `${c.name} aponta para técnico que não está nele`);
    if (c.league || c.contOnly) {
      const sq = squadOf(s, c.id);
      if (sq.length < 16) bad(`small:${c.id}:${s.meta.season}`, `${c.name} com só ${sq.length} jogadores`);
      if (sq.filter((p) => p.pos === 'GOL').length < 1) bad(`gk:${c.id}:${s.meta.season}`, `${c.name} sem goleiro`);
      const nums2 = sq.map((p) => p.num).filter((n) => n > 0);
      if (new Set(nums2).size !== nums2.length) bad(`num:${c.id}:${s.meta.season}`, `${c.name} com números de camisa repetidos`);
      for (const id of [...c.lineup.xi, ...c.lineup.bench]) {
        if (id != null && s.players[id]?.clubId !== c.id) bad(`lu:${c.id}:${s.meta.season}`, `${c.name} com escalação apontando para jogador de fora`);
      }
    }
  }
  for (const m of Object.values(s.managers)) {
    if (m.clubId != null && s.clubs[m.clubId]?.managerId !== m.id) bad(`m:${m.id}`, `técnico ${m.name} num clube que não o reconhece`);
  }
  for (const comp of Object.values(s.comps)) {
    for (const [cid, r] of Object.entries(comp.table ?? {})) {
      if (r.p !== r.w + r.d + r.l || r.pts !== 3 * r.w + r.d) bad(`tbl:${comp.cfg.id}:${cid}:${s.meta.season}`, `tabela ${comp.cfg.id} incoerente para ${s.clubs[Number(cid)]?.name}`);
    }
  }
  for (const b of Object.values(s.bids)) {
    if (!s.players[b.player] && (b.status === 'pendente' || b.status === 'contraproposta')) bad(`bid:${b.id}`, `proposta ${b.id} em aberto para jogador inexistente`);
    if (b.late && b.status === 'pendente' && (b.season < s.meta.season || s.meta.date > b.date)) bad(`late:${b.id}`, `proposta de última hora ${b.id} ainda aberta depois do fechamento`);
    if (b.status === 'pendente' && b.seller != null && !s.calendar[s.meta.date]?.window && s.meta.settings.windows) bad(`win:${b.id}`, `proposta ${b.id} aberta com a janela fechada`);
  }
  for (const [k, r] of Object.entries(s.h2h ?? {})) {
    if (r.some((x) => !Number.isFinite(x) || x < 0)) bad(`h2h:${k}`, `retrospecto ${k} inválido`);
  }
  for (const c of Object.values(s.clubs)) {
    // coaches: every club without a human has its own AI coach, and the coach knows it
    if (c.managerId && c.coachId != null) bad(`coachh:${c.id}`, `${c.name} com técnico humano e técnico da IA ao mesmo tempo`);
    if (!c.managerId && (c.league || c.contOnly)) {
      const co = c.coachId != null ? s.coaches?.[c.coachId] : undefined;
      if (!co) bad(`coach0:${c.id}`, `${c.name} sem técnico`);
      else if (co.clubId !== c.id) bad(`coachx:${c.id}`, `técnico ${co.name} não reconhece o ${c.name}`);
    }
    if (c.pitch != null && !(c.pitch >= 0 && c.pitch <= 100)) bad(`pitch:${c.id}`, `gramado inválido no ${c.name}: ${c.pitch}`);
    const u = c.board.ult;
    if (!u) continue;
    if (!c.managerId) bad(`ult:${c.id}:${s.meta.season}`, `${c.name} com ultimato e sem técnico humano`);
    if (u.played > u.games || u.pts > u.played * 3 || u.need < 1 || u.need > u.games * 3) bad(`ultv:${c.id}:${s.meta.season}`, `ultimato inválido no ${c.name}: ${JSON.stringify(u)}`);
  }
  for (const msg of out) console.log(`BUG [${where}] ${msg}`);
}
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
      // what needs the manager's attention this round
      const att =
        Object.values(s.bids).filter((b) => (b.seller === c.id || b.buyer === c.id) && b.status === 'pendente').length +
        h.m.offers.length +
        squadOf(s, c.id).filter((p) => starters.has(p.id) && (p.injury > 0 || Object.values(p.ban ?? {}).some((x) => x > 0))).length;
      t.attention += att;
      t.attentionMax = Math.max(t.attentionMax, att);
      if (ACTIVE) {
        activeTurn(h.m, c, t, year);
        if (!clubOf(h.m) || clubOf(h.m)!.id !== c.id) continue;
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
    for (const p of Object.values(s.players)) {
      if (p.junior) promotedIds.add(p.id);
      if (p.id > maxPid) maxPid = p.id;
    }
    const pidBefore = maxPid;
    finishDate(s, Object.values(results), present);
    checkState(`${s.meta.season}/${s.meta.date}`);
    for (const h of humans) {
      const c = clubOf(h.m);
      if (!c) continue;
      const t = tracks.get(h.m.id)!;
      const ids = new Set(squadOf(s, c.id).map((p) => p.id));
      const prev = prevSquad.get(h.m.id);
      if (prev && prevClub.get(h.m.id) === c.id) {
        for (const id of ids) {
          const p = s.players[id];
          if (!prev.has(id) && !p.junior && !promotedIds.has(id)) {
            t.signed.push(`${p.name} ${p.str.toFixed(0)}${id > pidBefore ? ' (gerado)' : ''}`);
          }
        }
      }
      prevSquad.set(h.m.id, ids);
      prevClub.set(h.m.id, c.id);
    }
    for (const n of s.news.filter((n) => n.id >= newsSeen)) {
      for (const h of humans) {
        const c = clubOf(h.m);
        const t = tracks.get(h.m.id)!;
        if (n.to === h.m.id || (c && n.clubs.includes(c.id))) {
          t.news++;
          if (n.kind === 'injury') t.injuries++;
          if (n.text.startsWith('Proposta de última hora')) t.late++;
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
      `    ${t.matches} jogos · atenção ${(t.attention / 78).toFixed(1)}/rodada (máx ${t.attentionMax}) · energia média dos 14 ${(t.fitSum / Math.max(1, t.fitN)).toFixed(0)}% (pior rodada ${t.fitMin.toFixed(0)}%) · ${t.injuries} lesões · ${t.bids} propostas da IA (${t.sold} vendas, ${mi(t.soldFee)} mi) · ${(t.opportunities / Math.max(1, t.oppDates)).toFixed(1)} reforços acessíveis por rodada de janela · ${young.length} jovens da base (${young.map((p) => p.stars).join(',') || '—'}★) · ${t.news} notícias (${(t.news / 78).toFixed(1)}/rodada)`,
    );
    const rv = s.reviews?.find((r) => r.season === year && r.manager === h.m.id);
    if (c && !rv && !t.fired) console.log(`BUG [${year}] sem retrospectiva para ${h.m.name}`);
    const dby = h.m.rec?.derbies;
    if (rv)
      console.log(
        `    retrospectiva: ${rv.pos ?? '—'}º/${rv.of} ${rv.met ? 'objetivo cumprido' : 'objetivo perdido'} · ${rv.record.slice(0, 3).join('-')} · craque ${rv.best?.name ?? '—'} · artilheiro ${rv.scorer ? `${rv.scorer.name} ${rv.scorer.goals}` : '—'} · contratação ${rv.signing?.name ?? '—'} · copas ${rv.cups.map((x) => `${x.comp}:${x.reached}`).join(' ') || '—'} · seleção ${rv.team.length} · clássicos na carreira ${dby ? dby.join('-') : '—'} · ${t.late} propostas de última hora`,
      );
    if (ACTIVE || t.signed.length)
      console.log(
        `    mercado: ${t.tries} lances · chegaram ${t.signed.length ? t.signed.join(', ') : '—'} · ${t.pre} pré-contratos · ${t.promoted} da base promovidos · ${t.invest} obras no CT${t.moved.length ? ` · trocou ${t.moved.join(', ')}` : ''}${t.refusals.length ? ` · recusas: ${[...new Set(t.refusals)].slice(0, 3).join(' | ')}` : ''}`,
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
  const deadline = s.news
    .filter((n) => n.season === year && n.text.startsWith('Fechamento da janela'))
    .map((n) => n.text.match(/(\d+) negócio/)?.[1] ?? '?')
    .join('+');
  const line = `${year}: campeões ${champs.join(' ')} | top100 força média ${(top.reduce((a, p) => a + p.str, 0) / 100).toFixed(1)}, reais ${top.filter((p) => realNames.has(p.name)).length}/100 | força média BRA1 ${lgStr('BRA1')} ENG1 ${lgStr('ENG1')} ESP1 ${lgStr('ESP1')} BRA3 ${lgStr('BRA3')} | livres ${Object.values(s.players).filter((p) => p.clubId == null).length} | fechamentos ${deadline || '—'} | técnicos ${coachRanking(s).slice(0, 3).map((r) => `${r.name}${r.human ? '*' : ''} ${r.rec.pts.toFixed(0)}`).join(', ')} · trocas ${s.news.filter((n) => n.season === year && / demite /.test(n.text)).length} · gramados ruins ${Object.values(s.clubs).filter((c) => c.league && (c.pitch ?? 80) < 60).length}`;
  world.push(line);
  console.log(line);
}
console.log('\nMundo, temporada a temporada:');
for (const w of world) console.log('  ' + w);
