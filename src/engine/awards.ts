// Monthly awards and the small stories of a season: player, young player and manager of the month in each
// country, hat-tricks, goal milestones and winning streaks.
import type { MatchResult } from './match/core';
import type { Club, Fixture, GameState } from './types';
import { addNews, age } from './util';
import { AWARD_PTS, inCharge, rankAward } from './coaches';
import { objectiveDelta } from './review';

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const COUNTRY_TXT: Record<string, string> = {
  BRA: 'no Brasil',
  ENG: 'na Inglaterra',
  ESP: 'na Espanha',
  ITA: 'na Itália',
  GER: 'na Alemanha',
  FRA: 'na França',
  ARG: 'na Argentina',
  URU: 'no Uruguai',
};

/** Top-division league of each country, by competition id. */
function topLeagues(state: GameState): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of state.config) if (c.kind === 'league' && c.level === 1 && c.country) m.set(c.id, c.country);
  return m;
}

/** Countries where some human manager's club plays: the small stories are only told there. */
function humanCountries(state: GameState): Set<string> {
  const out = new Set<string>();
  for (const c of Object.values(state.clubs)) if (c.managerId && c.country) out.add(c.country);
  return out;
}

/** Add one match's numbers to the month's tallies (top-division players only), and tell its stories. */
export function tallyMatch(state: GameState, f: Fixture, r: MatchResult, formBefore: [string, string]) {
  const leagues = topLeagues(state);
  const home = state.clubs[f.home];
  const away = state.clubs[f.away];
  const tally = (state.monthly ??= { month: state.calendar[state.meta.date]?.month ?? 1, players: {} }).players;
  for (const [pidS, st] of Object.entries(r.players)) {
    const p = state.players[Number(pidS)];
    const club = p?.clubId != null ? state.clubs[p.clubId] : null;
    if (!p || !club?.league || !leagues.has(club.league)) continue;
    const t = (tally[p.id] ??= [0, 0, 0, 0]);
    t[0]++;
    t[1] += Math.round((st.rt ?? 6) * 10);
    t[2] += st.goals;
    t[3] += st.ast;
  }
  // stories, only where humans play
  const here = humanCountries(state);
  if (!here.has(home.country ?? '') && !here.has(away.country ?? '')) return;
  for (const [pidS, st] of Object.entries(r.players)) {
    const p = state.players[Number(pidS)];
    if (!p || p.clubId == null) continue;
    const club = state.clubs[p.clubId];
    // top-division players and the humans' own players
    if (!club.managerId && !(club.league && leagues.has(club.league))) continue;
    if (st.goals >= 3) {
      const score = `${home.short} ${f.hg} x ${f.ag} ${away.short}`;
      addNews(state, 'award', `${st.goals >= 4 ? `${st.goals} gols` : 'Hat-trick'} de ${p.name} (${club.name}) no ${score}.`, [club.id]);
    }
    const before = p.s.goals - st.goals;
    const mark = [10, 20, 30, 40, 50].find((m) => before < m && p.s.goals >= m);
    if (mark && club.league && leagues.has(club.league)) addNews(state, 'award', `${p.name} chega a ${mark} gols na temporada pelo ${club.name}.`, [club.id]);
  }
  // streaks: told once, the match they reach five
  [home, away].forEach((club, i) => {
    if (!club.league || !leagues.has(club.league) || club.form === formBefore[i]) return;
    if (club.form === 'VVVVV') addNews(state, 'award', `${club.name} emenda cinco vitórias seguidas.`, [club.id]);
    else if (club.form === 'DDDDD') addNews(state, 'award', `Crise no ${club.name}: cinco derrotas seguidas.`, [club.id]);
  });
}

/** True when the date just played is the last one of its month (or of the season). */
export function monthEnds(state: GameState): boolean {
  const cur = state.calendar[state.meta.date];
  const next = state.calendar[state.meta.date + 1];
  return !!cur && (!next || next.month !== cur.month);
}

/** Hand out the month's awards in every country with a top division, then start a new tally. */
export function monthlyAwards(state: GameState) {
  const cal = state.calendar[state.meta.date];
  if (!cal) return;
  const tally = state.monthly?.players ?? {};
  const monthName = MONTHS[(cal.month - 1 + 12) % 12];
  const datesThisMonth = new Set(state.calendar.map((d, i) => (d.month === cal.month ? i : -1)).filter((i) => i >= 0));
  for (const [lid, country] of topLeagues(state)) {
    const comp = state.comps[lid];
    if (!comp) continue;
    const clubs = new Set(comp.clubs);
    // players of this league with enough games this month
    const rows = Object.entries(tally)
      .map(([pid, t]) => ({ p: state.players[Number(pid)], apps: t[0], avg: t[1] / t[0] / 10, goals: t[2], ast: t[3] }))
      .filter((x) => x.p && x.p.clubId != null && clubs.has(x.p.clubId));
    if (!rows.length) continue;
    const most = Math.max(...rows.map((x) => x.apps));
    const enough = rows.filter((x) => x.apps >= Math.max(2, Math.ceil(most * 0.6)));
    const score = (x: (typeof rows)[number]) => x.avg + (x.goals + x.ast * 0.5) * 0.04;
    const best = [...enough].sort((a, b) => score(b) - score(a))[0];
    const young = enough.filter((x) => age(x.p, state.meta.season) <= 21).sort((a, b) => score(b) - score(a))[0];
    // manager of the month: most league points per game this month
    const pts = new Map<number, { pts: number; gd: number; n: number }>();
    for (const f of Object.values(state.fixtures)) {
      if (f.comp !== lid || f.hg == null || !datesThisMonth.has(f.date)) continue;
      for (const [cid, gf, ga] of [
        [f.home, f.hg, f.ag!],
        [f.away, f.ag!, f.hg],
      ] as const) {
        const e = pts.get(cid) ?? { pts: 0, gd: 0, n: 0 };
        e.pts += gf > ga ? 3 : gf === ga ? 1 : 0;
        e.gd += gf - ga;
        e.n++;
        pts.set(cid, e);
      }
    }
    const top = [...pts.entries()].filter(([, e]) => e.n >= 2).sort((a, b) => b[1].pts / b[1].n - a[1].pts / a[1].n || b[1].gd - a[1].gd)[0];
    const parts: string[] = [];
    const involved: number[] = [];
    if (best) {
      const c = state.clubs[best.p.clubId!];
      parts.push(`craque do mês: ${best.p.name} (${c.name}, nota ${best.avg.toFixed(1)}${best.goals ? `, ${best.goals} gol${best.goals > 1 ? 's' : ''}` : ''})`);
      best.p.morale = Math.min(100, best.p.morale + 6);
      involved.push(c.id);
    }
    if (young && young.p.id !== best?.p.id) {
      const c = state.clubs[young.p.clubId!];
      parts.push(`revelação: ${young.p.name} (${c.name}, ${age(young.p, state.meta.season)} anos)`);
      young.p.morale = Math.min(100, young.p.morale + 6);
      involved.push(c.id);
    }
    if (top) {
      const c: Club = state.clubs[top[0]];
      const m = c.managerId ? state.managers[c.managerId] : null;
      const who = inCharge(state, c);
      const rec = `${top[1].pts} pts em ${top[1].n} jogos`;
      parts.push(who ? `treinador do mês: ${who.name} (${c.name}, ${rec})` : `treinador do mês: o técnico do ${c.name} (${rec})`);
      if (m) m.rep = Math.min(100, m.rep + 1);
      rankAward(state, c, AWARD_PTS.month);
      involved.push(c.id);
    }
    if (parts.length) addNews(state, 'award', `Prêmios de ${monthName} ${COUNTRY_TXT[country] ?? `(${country})`}: ${parts.join('; ')}.`, involved);
  }
  state.monthly = { month: state.calendar[state.meta.date + 1]?.month ?? 1, players: {} };
}

/**
 * Coach of the season in each top division: whoever did best against the season's objective (the champion
 * gets a little extra), announced at the season end.
 */
export function seasonCoachAwards(state: GameState, ranks: Record<string, number[]>) {
  for (const [lid, country] of topLeagues(state)) {
    const order = ranks[lid];
    if (!order?.length) continue;
    const n = order.length;
    const best = order
      .map((cid, i) => ({ club: state.clubs[cid], pos: i + 1 }))
      .filter((x) => x.club && inCharge(state, x.club))
      .map((x) => ({ ...x, score: objectiveDelta(x.club.board.goal, x.pos, n) + (x.pos === 1 ? 6 : 0) - x.pos * 0.01 }))
      .sort((a, b) => b.score - a.score)[0];
    if (!best) continue;
    const who = inCharge(state, best.club)!;
    rankAward(state, best.club, AWARD_PTS.season);
    addNews(state, 'award', `Técnico da temporada ${COUNTRY_TXT[country] ?? `(${country})`}: ${who.name}, ${best.pos}º lugar com o ${best.club.name}.`, [best.club.id]);
  }
}
