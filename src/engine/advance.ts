import { boardAfterMatch, boardChecks, boardFinanceCheck } from './board';
import { applyFixtureToTables, progressComps } from './competitions';
import { dailyPlayers } from './development';
import { attendance, dailyFinances } from './economy';
import { MatchSim, type MatchResult, type MatchSetup } from './match/core';
import type { MatchdayPlan } from './matchday';
import { Rng } from './rng';
import { endSeason } from './season';
import { aiTransfers, expireBids } from './transfers';
import type { GameState } from './types';
import { addNews, squadIndex } from './util';

export function simulateSetup(setup: MatchSetup): MatchResult {
  return new MatchSim(setup).runToEnd();
}

/** Simulate every non-live fixture of a plan. */
export function simulateBackground(plan: MatchdayPlan): Record<number, MatchResult> {
  const out: Record<number, MatchResult> = {};
  for (const s of plan.setups) if (!plan.live.includes(s.fixtureId)) out[s.fixtureId] = simulateSetup(s);
  return out;
}

function banLength(rng: Rng): number {
  const r = rng.next();
  return r < 0.7 ? 1 : r < 0.95 ? 2 : 3;
}

/** Write match results into the state (tables, players, money, board). */
export function applyResults(state: GameState, results: MatchResult[], rng: Rng): Set<number> {
  const played = new Set<number>();
  const idx = squadIndex(state);
  for (const r of results) {
    const f = state.fixtures[r.fixtureId];
    if (!f || f.hg != null) continue;
    f.hg = r.hg;
    f.ag = r.ag;
    f.pens = r.pens;
    f.goals = r.goals;
    f.reds = [r.stats[0].red, r.stats[1].red];
    const home = state.clubs[f.home];
    const gate = attendance(state, f, rng);
    f.att = gate.total;
    home.balance += gate.revenue;
    home.ledger.tickets += gate.revenue;
    applyFixtureToTables(state, f);

    // suspensions already being served in this competition
    for (const p of [...(idx.get(f.home) ?? []), ...(idx.get(f.away) ?? [])]) {
      if ((p.ban[f.comp] ?? 0) > 0 && !r.players[p.id]) p.ban[f.comp]--;
    }
    for (const [pidS, st] of Object.entries(r.players)) {
      const p = state.players[Number(pidS)];
      if (!p) continue;
      played.add(p.id);
      p.s.apps++;
      p.c.apps++;
      p.s.goals += st.goals;
      p.c.goals += st.goals;
      p.s.ast += st.ast;
      p.s.rt += Math.round((st.rt ?? 6) * 10);
      p.fitness = st.fitness;
      if (st.inj > 0) {
        p.injury = Math.max(p.injury, st.inj);
        const c = p.clubId != null ? state.clubs[p.clubId] : null;
        if (c?.managerId) addNews(state, 'injury', `${p.name} se lesionou e fica fora por ${st.inj} jogo(s).`, [c.id], c.managerId);
      }
      if (st.red) {
        p.s.red++;
        p.ban[f.comp] = banLength(rng);
      } else if (st.yel > 0) {
        p.s.yel += st.yel;
        p.yel[f.comp] = (p.yel[f.comp] ?? 0) + st.yel;
        if (p.yel[f.comp] >= 3) {
          p.yel[f.comp] = 0;
          p.ban[f.comp] = 1;
        }
      }
    }
    // morale and form
    for (const side of [0, 1] as const) {
      const club = state.clubs[side === 0 ? f.home : f.away];
      const gf = side === 0 ? r.hg : r.ag;
      const ga = side === 0 ? r.ag : r.hg;
      const res = gf > ga ? 'V' : gf === ga ? 'E' : 'D';
      club.form = (club.form + res).slice(-5);
      const dm = res === 'V' ? 4 : res === 'E' ? 0 : -4;
      for (const pidS of Object.keys(r.players)) {
        const p = state.players[Number(pidS)];
        if (p && p.clubId === club.id) p.morale = Math.max(10, Math.min(100, p.morale + dm + (r.players[p.id].goals > 0 ? 3 : 0)));
      }
    }
    boardAfterMatch(state, f);
  }
  return played;
}

/**
 * Finish the current date: apply results, progress competitions, daily updates, AI market,
 * then move to the next date (or the next season).
 */
export function finishDate(state: GameState, results: MatchResult[], present: Set<string>) {
  const rng = new Rng(state.meta.rng);
  const played = applyResults(state, results, rng);
  progressComps(state, rng);
  dailyPlayers(state, rng, played);
  const wages = new Map<number, number>();
  for (const id in state.players) {
    const p = state.players[id];
    if (p.clubId != null) wages.set(p.clubId, (wages.get(p.clubId) ?? 0) + p.wage);
  }
  dailyFinances(state, wages);
  for (const c of Object.values(state.clubs)) boardFinanceCheck(c);
  boardChecks(state, rng, present);
  aiTransfers(state, rng);
  expireBids(state);
  state.meta.date++;
  if (state.meta.date >= state.calendar.length) endSeason(state, rng, present);
  state.meta.rng = rng.state();
}
