import { rankTitle } from './coaches';
import { slotsFor, spread } from './calendar';
import type { Rng } from './rng';
import type { Club, CompConfig, Competition, Fixture, GameState, Stage, TableRow, Tie } from './types';
import { addNews, emptyRow, sortTable } from './util';

// ---------- fixtures ----------

/** Circle-method round robin. Returns rounds of [home, away] pairs. */
export function roundRobin(clubs: number[], legs: 1 | 2, rng: Rng): [number, number][][] {
  const arr = rng.shuffle([...clubs]);
  if (arr.length % 2 === 1) arr.push(-1);
  const n = arr.length;
  const rounds: [number, number][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < n / 2; i++) {
      const t1 = arr[i];
      const t2 = arr[n - 1 - i];
      if (t1 === -1 || t2 === -1) continue;
      pairs.push((r + i) % 2 === 0 ? [t1, t2] : [t2, t1]);
    }
    rounds.push(pairs);
    // rotate all but the first
    arr.splice(1, 0, arr.pop()!);
  }
  if (legs === 2) {
    const second = rounds.map((rd) => rd.map(([h, a]) => [a, h] as [number, number]));
    return [...rounds, ...second];
  }
  return rounds;
}

function addFixture(state: GameState, comp: string, date: number, home: number, away: number, extra: Partial<Fixture> = {}): number {
  const id = state.meta.next.fixture++;
  state.fixtures[id] = {
    id,
    comp,
    date,
    home,
    away,
    hg: null,
    ag: null,
    pens: null,
    stage: null,
    tie: null,
    leg: 1,
    group: null,
    round: 0,
    goals: [],
    att: 0,
    ...extra,
  };
  return id;
}

export function stageName(clubs: number): string {
  switch (clubs) {
    case 2:
      return 'Final';
    case 4:
      return 'Semifinal';
    case 8:
      return 'Quartas de final';
    case 16:
      return 'Oitavas de final';
    case 32:
      return 'Segunda fase';
    case 64:
      return 'Primeira fase';
    default:
      return 'Fase preliminar';
  }
}

// ---------- entrants ----------

const leagueLevel = (state: GameState, c: Club) => (c.league ? (state.comps[c.league]?.cfg.level ?? state.config.find((x) => x.id === c.league)?.level ?? 5) : 9);

function rankedLeague(state: GameState, leagueId: string): number[] {
  const prev = state.prev.ranks[leagueId];
  if (prev && prev.length) return prev;
  // first season: rank by reputation
  return Object.values(state.clubs)
    .filter((c) => c.league === leagueId)
    .sort((a, b) => b.rep - a.rep)
    .map((c) => c.id);
}

function entrants(state: GameState, cfg: CompConfig, rng: Rng, usedCont: Set<number>): number[] {
  const clubs = Object.values(state.clubs);
  if (cfg.kind === 'league') return clubs.filter((c) => c.league === cfg.id).map((c) => c.id);
  const out: number[] = [];
  const add = (id: number | undefined) => {
    if (id == null || out.includes(id)) return;
    if (cfg.scope === 'continental' && usedCont.has(id)) return;
    out.push(id);
  };
  for (const rule of cfg.entrants ?? []) {
    if ('state' in rule) {
      clubs
        .filter((c) => c.estadual === rule.state)
        .sort((a, b) => leagueLevel(state, a) - leagueLevel(state, b) || b.rep - a.rep)
        .forEach((c) => add(c.id));
    } else if ('from' in rule) {
      const ranked = cfg.scope === 'continental' ? rankedLeague(state, rule.from) : clubs.filter((c) => c.league === rule.from).map((c) => c.id);
      const slice = rule.pos ? ranked.slice(rule.pos[0] - 1, rule.pos[1]) : ranked;
      slice.forEach(add);
    } else if ('winner' in rule) {
      add(state.prev.winners[rule.winner]);
    } else if ('pool' in rule) {
      clubs
        .filter((c) => c.country === rule.pool && !c.league && !c.contOnly)
        .sort((a, b) => b.rep - a.rep)
        .slice(0, rule.n)
        .forEach((c) => add(c.id));
    } else if ('contOnly' in rule) {
      const need = (cfg.size ?? 32) - out.length;
      const pool = clubs
        .filter((c) => c.contOnly && c.continent === rule.contOnly && !out.includes(c.id) && !usedCont.has(c.id))
        .map((c) => ({ id: c.id, k: c.rep + rng.range(-8, 8) }))
        .sort((a, b) => b.k - a.k);
      pool.slice(0, rule.n ?? need).forEach((x) => add(x.id));
    }
  }
  if (cfg.size && out.length > cfg.size) out.length = cfg.size;
  if (cfg.scope === 'continental' && cfg.size && out.length < cfg.size) {
    // top up with the best remaining league clubs of the continent
    clubs
      .filter((c) => c.continent === cfg.continent && c.league && !out.includes(c.id) && !usedCont.has(c.id) && leagueLevel(state, c) === 1)
      .sort((a, b) => b.rep - a.rep)
      .slice(0, cfg.size - out.length)
      .forEach((c) => add(c.id));
  }
  if (cfg.scope === 'continental') out.forEach((id) => usedCont.add(id));
  return out;
}

// ---------- season creation ----------

export function createSeasonComps(state: GameState, rng: Rng) {
  state.comps = {};
  const usedCont = new Set<number>();
  for (const cfg of state.config) {
    const clubs = entrants(state, cfg, rng, usedCont);
    if (clubs.length < 2) continue;
    const comp: Competition = {
      id: cfg.id,
      cfg,
      clubs,
      table: {},
      groups: [],
      stages: [],
      stageIdx: -1,
      dates: [],
      champion: null,
      finished: false,
    };
    state.comps[cfg.id] = comp;
    if (cfg.kind === 'league') setupLeague(state, comp, rng);
    else if (cfg.kind === 'groups') setupGroups(state, comp, rng);
    else setupCup(state, comp, rng);
  }
}

function setupLeague(state: GameState, comp: Competition, rng: Rng) {
  const rounds = roundRobin(comp.clubs, comp.cfg.legs ?? 2, rng);
  const slots = slotsFor(state.calendar, comp.cfg.tracks);
  comp.dates = spread(slots, rounds.length);
  for (const id of comp.clubs) comp.table[id] = emptyRow();
  rounds.forEach((pairs, r) => {
    const date = comp.dates[Math.min(r, comp.dates.length - 1)];
    for (const [h, a] of pairs) addFixture(state, comp.id, date, h, a, { round: r + 1 });
  });
}

function koPlan(n: number, cfg: CompConfig, available: number): { size: number; legs: (1 | 2)[] } {
  let size = 2;
  while (size < n) size *= 2;
  const legs: (1 | 2)[] = [];
  for (let c = size; c >= 2; c /= 2) {
    if (c === 2) legs.push(cfg.finalLegs ?? 1);
    else legs.push(cfg.twoLegFrom && c <= cfg.twoLegFrom ? 2 : (cfg.koLegs ?? 1));
  }
  // too many dates: make the earliest two-legged rounds single-legged
  let total = legs.reduce((a, b) => a + b, 0);
  for (let i = 0; i < legs.length && total > available; i++) {
    if (legs[i] === 2) {
      legs[i] = 1;
      total--;
    }
  }
  return { size, legs };
}

function setupCup(state: GameState, comp: Competition, rng: Rng) {
  const slots = slotsFor(state.calendar, comp.cfg.tracks);
  const plan = koPlan(comp.clubs.length, comp.cfg, slots.length);
  const total = plan.legs.reduce((a, b) => a + b, 0);
  const dates = spread(slots, total);
  let k = 0;
  let clubsInStage = plan.size;
  comp.stages = plan.legs.map((legs) => {
    const st: Stage = { name: stageName(clubsInStage), legs, dates: dates.slice(k, k + legs), ties: [] };
    k += legs;
    clubsInStage /= 2;
    return st;
  });
  // seeds by division level then reputation; the best seeds receive byes
  const seeded = [...comp.clubs].sort(
    (a, b) => leagueLevel(state, state.clubs[a]) - leagueLevel(state, state.clubs[b]) || state.clubs[b].rep - state.clubs[a].rep,
  );
  const byes = plan.size - comp.clubs.length;
  const ties: Tie[] = [];
  for (let i = 0; i < byes; i++) ties.push({ a: seeded[i], b: null, fixtures: [], winner: seeded[i] });
  const rest = rng.shuffle(seeded.slice(byes));
  for (let i = 0; i + 1 < rest.length; i += 2) ties.push({ a: rest[i], b: rest[i + 1], fixtures: [], winner: null });
  comp.stageIdx = 0;
  comp.stages[0].ties = ties;
  createTieFixtures(state, comp, 0);
}

function setupGroups(state: GameState, comp: Competition, rng: Rng) {
  const cfg = comp.cfg;
  const G = cfg.groups ?? 1;
  const legs = cfg.legs ?? 2;
  const sorted = [...comp.clubs].sort((a, b) => state.clubs[b].rep - state.clubs[a].rep);
  const groups: number[][] = Array.from({ length: G }, () => []);
  if (G === 1) groups[0] = sorted;
  else {
    const perGroup = Math.ceil(sorted.length / G);
    for (let pot = 0; pot < perGroup; pot++) {
      const potClubs = rng.shuffle(sorted.slice(pot * G, pot * G + G));
      // light attempt to avoid two clubs of the same country in a group
      for (const cid of potClubs) {
        const c = state.clubs[cid];
        const open = groups.filter((g) => g.length === pot);
        const pick = open.find((g) => !g.some((x) => state.clubs[x].country === c.country)) ?? open[0] ?? groups[0];
        pick.push(cid);
      }
    }
  }
  comp.groups = groups.map((clubs, i) => ({
    name: G === 1 ? 'Classificação' : `Grupo ${String.fromCharCode(65 + i)}`,
    clubs,
    table: Object.fromEntries(clubs.map((c) => [c, emptyRow()])),
  }));
  const groupRounds = comp.groups.map((g) => roundRobin(g.clubs, legs, rng));
  const matchdays = Math.max(...groupRounds.map((r) => r.length));
  const advance = cfg.advance ?? 2;
  const koClubs = Math.max(2, Math.min(advance * G, comp.clubs.length));
  const slots = slotsFor(state.calendar, cfg.tracks);
  const plan = koPlan(koClubs, cfg, Math.max(1, slots.length - matchdays));
  const total = matchdays + plan.legs.reduce((a, b) => a + b, 0);
  const dates = spread(slots, total);
  comp.dates = dates.slice(0, matchdays);
  groupRounds.forEach((rounds, gi) => {
    rounds.forEach((pairs, r) => {
      for (const [h, a] of pairs) addFixture(state, comp.id, comp.dates[r], h, a, { group: gi, round: r + 1 });
    });
  });
  let k = matchdays;
  let clubsInStage = plan.size;
  comp.stages = plan.legs.map((l) => {
    const st: Stage = { name: stageName(clubsInStage), legs: l, dates: dates.slice(k, k + l), ties: [] };
    k += l;
    clubsInStage /= 2;
    return st;
  });
}

function createTieFixtures(state: GameState, comp: Competition, stageIdx: number) {
  const st = comp.stages[stageIdx];
  st.ties.forEach((tie, ti) => {
    if (tie.b == null) return;
    if (st.legs === 1) {
      tie.fixtures.push(addFixture(state, comp.id, st.dates[0], tie.a, tie.b, { stage: stageIdx, tie: ti, leg: 1 }));
    } else {
      // tie.a is the better seed and hosts the second leg
      tie.fixtures.push(addFixture(state, comp.id, st.dates[0], tie.b, tie.a, { stage: stageIdx, tie: ti, leg: 1 }));
      tie.fixtures.push(addFixture(state, comp.id, st.dates[1] ?? st.dates[0], tie.a, tie.b, { stage: stageIdx, tie: ti, leg: 2 }));
    }
  });
}

// ---------- results ----------

function applyRow(row: TableRow, gf: number, ga: number) {
  row.p++;
  row.gf += gf;
  row.ga += ga;
  if (gf > ga) {
    row.w++;
    row.pts += 3;
  } else if (gf === ga) {
    row.d++;
    row.pts += 1;
  } else row.l++;
}

export function applyFixtureToTables(state: GameState, f: Fixture) {
  const comp = state.comps[f.comp];
  if (!comp || f.hg == null || f.ag == null) return;
  let table: Record<number, TableRow> | null = null;
  if (comp.cfg.kind === 'league') table = comp.table;
  else if (f.group != null) table = comp.groups[f.group]?.table ?? null;
  if (!table) return;
  table[f.home] ??= emptyRow();
  table[f.away] ??= emptyRow();
  applyRow(table[f.home], f.hg, f.ag);
  applyRow(table[f.away], f.ag, f.hg);
}

/** Winner of a knockout tie, or null if it isn't decided yet. */
export function tieWinner(state: GameState, tie: Tie): number | null {
  if (tie.b == null) return tie.a;
  const fx = tie.fixtures.map((id) => state.fixtures[id]);
  if (!fx.length || fx.some((f) => f.hg == null)) return null;
  let ga = 0;
  let gb = 0;
  for (const f of fx) {
    if (f.home === tie.a) {
      ga += f.hg!;
      gb += f.ag!;
    } else {
      gb += f.hg!;
      ga += f.ag!;
    }
  }
  if (ga !== gb) return ga > gb ? tie.a : tie.b;
  const last = fx[fx.length - 1];
  if (last.pens) return last.pens[0] > last.pens[1] ? last.home : last.away;
  return tie.a;
}

/** Aggregate from earlier legs, as seen from fixture f's home/away, if f must produce a winner. */
export function deciderFor(state: GameState, f: Fixture): { aggHome: number; aggAway: number } | null {
  if (f.stage == null || f.tie == null) return null;
  const comp = state.comps[f.comp];
  const st = comp?.stages[f.stage];
  if (!st) return null;
  if (st.legs === 1) return { aggHome: 0, aggAway: 0 };
  if (f.leg !== 2) return null;
  const tie = st.ties[f.tie];
  const first = state.fixtures[tie.fixtures[0]];
  if (first.hg == null) return { aggHome: 0, aggAway: 0 };
  // first leg was played at f.away's ground
  return { aggHome: first.ag!, aggAway: first.hg! };
}

/** Advance knockout stages and mark finished competitions. Call after a date's results are applied. */
export function progressComps(state: GameState, rng: Rng) {
  for (const comp of Object.values(state.comps)) {
    if (comp.finished) continue;
    if (comp.cfg.kind === 'league') {
      const done = !Object.values(state.fixtures).some((f) => f.comp === comp.id && f.hg == null);
      if (done) {
        comp.finished = true;
        comp.champion = sortTable(comp.table, state.clubs)[0];
        announceChampion(state, comp);
      }
      continue;
    }
    if (comp.stageIdx === -1) {
      // group stage
      const pending = Object.values(state.fixtures).some((f) => f.comp === comp.id && f.group != null && f.hg == null);
      if (pending) continue;
      drawKnockoutFromGroups(state, comp);
      continue;
    }
    const st = comp.stages[comp.stageIdx];
    const winners = st.ties.map((t) => tieWinner(state, t));
    if (winners.some((w) => w == null)) continue;
    st.ties.forEach((t, i) => (t.winner = winners[i]));
    const prize = comp.cfg.prize;
    for (const w of winners) payPrize(state, w!, prize * (0.02 + 0.04 * comp.stageIdx) * (comp.stages.length > 4 ? 0.7 : 1));
    if (comp.stageIdx === comp.stages.length - 1) {
      comp.finished = true;
      comp.champion = winners[0]!;
      payPrize(state, comp.champion, prize);
      const fin = st.ties[0];
      const runnerUp = fin.a === comp.champion ? fin.b : fin.a;
      if (runnerUp != null) payPrize(state, runnerUp, prize * 0.4);
      announceChampion(state, comp);
      continue;
    }
    const next = comp.stageIdx + 1;
    const ws = winners as number[];
    const order = comp.cfg.kind === 'cup' ? rng.shuffle([...ws]) : ws;
    const ties: Tie[] = [];
    for (let i = 0; i + 1 < order.length; i += 2) {
      const [a, b] = state.clubs[order[i]].rep >= state.clubs[order[i + 1]].rep ? [order[i], order[i + 1]] : [order[i + 1], order[i]];
      ties.push({ a, b, fixtures: [], winner: null });
    }
    comp.stageIdx = next;
    comp.stages[next].ties = ties;
    createTieFixtures(state, comp, next);
  }
}

function drawKnockoutFromGroups(state: GameState, comp: Competition) {
  const advance = comp.cfg.advance ?? 2;
  const ranked = comp.groups.map((g) => sortTable(g.table, state.clubs));
  const ties: Tie[] = [];
  if (comp.groups.length === 1) {
    const q = ranked[0].slice(0, advance);
    for (let i = 0; i < q.length / 2; i++) ties.push({ a: q[i], b: q[q.length - 1 - i], fixtures: [], winner: null });
  } else {
    const G = comp.groups.length;
    for (let g = 0; g < G; g++) {
      const w = ranked[g][0];
      const r = ranked[(g + 1) % G][1];
      if (w != null && r != null) ties.push({ a: w, b: r, fixtures: [], winner: null });
    }
  }
  comp.stageIdx = 0;
  if (!comp.stages.length) {
    comp.finished = true;
    comp.champion = ranked[0][0];
    announceChampion(state, comp);
    return;
  }
  comp.stages[0].ties = ties;
  for (const t of ties) payPrize(state, t.a, comp.cfg.prize * 0.04);
  createTieFixtures(state, comp, 0);
}

export function payPrize(state: GameState, clubId: number, amount: number) {
  const c = state.clubs[clubId];
  if (!c) return;
  const v = Math.round(amount);
  c.balance += v;
  c.ledger.prizes += v;
}

function announceChampion(state: GameState, comp: Competition) {
  if (comp.champion == null) return;
  const c = state.clubs[comp.champion];
  addNews(state, 'title', `${c.name} é campeão: ${comp.cfg.name}!`, [c.id]);
  rankTitle(state, comp.cfg, c.id);
  if (c.managerId) {
    const m = state.managers[c.managerId];
    m?.trophies.push({ season: state.meta.season, comp: comp.id, clubId: c.id });
    if (m) m.rep = Math.min(100, m.rep + (comp.cfg.scope === 'continental' ? 10 : comp.cfg.scope === 'state' ? 2 : comp.cfg.level === 1 || comp.cfg.kind === 'cup' ? 7 : 4));
  }
  c.rep = Math.min(99, c.rep + (comp.cfg.scope === 'continental' ? 3 : comp.cfg.scope === 'state' ? 0.5 : 1.5));
}

/** Competitions a club takes part in this season. */
export function compsOfClub(state: GameState, clubId: number): Competition[] {
  return Object.values(state.comps).filter((c) => c.clubs.includes(clubId));
}
