// The end of a season for a human manager: a review of the club's season (where it finished, how far it went in
// the cups, the record, its player of the season, top scorer and best signing, the league's team of the season),
// plus a career record kept match by match (games, wins, goals, biggest win and defeat, derbies).
import { isDerby } from './rivals';
import type { Club, Fixture, GameState, Manager, Objective, Player, Pos, ReviewPlayer, SeasonReview } from './types';

/** Board confidence change for a final league position against the season objective. */
export function objectiveDelta(goal: Objective, pos: number, n: number): number {
  if (goal === 'titulo') return pos === 1 ? 25 : pos <= 4 ? 0 : pos <= 8 ? -15 : -35;
  if (goal === 'continental') return pos <= Math.round(n * 0.3) ? 15 : pos <= n / 2 ? -5 : -25;
  if (goal === 'meio') return pos <= n - 4 ? 8 : -30;
  if (goal === 'rebaixamento') return pos <= n - 4 ? 15 : -20;
  return pos <= 4 ? 25 : pos <= 8 ? -5 : -25;
}

/** Add a finished match to the career records of the human managers involved. */
export function recordCareer(state: GameState, f: Fixture) {
  if (f.hg == null || f.ag == null) return;
  const derby = isDerby(state, f.home, f.away);
  for (const side of [0, 1] as const) {
    const club = state.clubs[side === 0 ? f.home : f.away];
    const m = club?.managerId ? state.managers[club.managerId] : null;
    if (!m) continue;
    const gf: number = side === 0 ? f.hg : f.ag;
    const ga: number = side === 0 ? f.ag : f.hg;
    const r = (m.rec ??= { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 });
    r.p++;
    r.gf += gf;
    r.ga += ga;
    const res = gf > ga ? 0 : gf === ga ? 1 : 2;
    if (res === 0) r.w++;
    else if (res === 1) r.d++;
    else r.l++;
    const score = { gf, ga, opp: side === 0 ? f.away : f.home, club: club.id, season: state.meta.season };
    if (gf > ga && (!r.bigWin || gf - ga > r.bigWin.gf - r.bigWin.ga || (gf - ga === r.bigWin.gf - r.bigWin.ga && gf > r.bigWin.gf))) r.bigWin = score;
    if (ga > gf && (!r.bigLoss || ga - gf > r.bigLoss.ga - r.bigLoss.gf || (ga - gf === r.bigLoss.ga - r.bigLoss.gf && ga > r.bigLoss.ga))) r.bigLoss = score;
    if (derby) {
      const d = (r.derbies ??= [0, 0, 0]);
      d[res]++;
    }
  }
}

const avg = (p: Player) => (p.s.apps ? p.s.rt / p.s.apps : 0);

function asReview(p: Player): ReviewPlayer {
  return { pid: p.id, name: p.name, pos: p.pos, clubId: p.clubId, apps: p.s.apps, goals: p.s.goals, ast: p.s.ast, rt: Math.round(avg(p)) };
}

/** How a match rating, goals and assists add up when picking the best players of a season. */
const merit = (p: Player) => avg(p) / 10 + (p.s.goals + p.s.ast * 0.5) * 0.025;

/** Team of the season of a league: the best regulars at each position, in a 4-3-3. */
export function teamOfSeason(state: GameState, leagueId: string): ReviewPlayer[] {
  const comp = state.comps[leagueId];
  if (!comp) return [];
  const clubs = new Set(comp.clubs);
  const players = Object.values(state.players).filter((p) => p.clubId != null && clubs.has(p.clubId) && !p.junior && p.s.apps > 0);
  const most = Math.max(0, ...players.map((p) => p.s.apps));
  const regulars = players.filter((p) => p.s.apps >= most * 0.5);
  const shape: [Pos, number][] = [
    ['GOL', 1],
    ['LAT', 2],
    ['ZAG', 2],
    ['VOL', 1],
    ['MEI', 2],
    ['ATA', 3],
  ];
  const out: ReviewPlayer[] = [];
  for (const [pos, n] of shape) {
    const best = regulars
      .filter((p) => p.pos === pos)
      .sort((a, b) => merit(b) - merit(a))
      .slice(0, n);
    out.push(...best.map(asReview));
  }
  return out;
}

/** How far a club went in a cup this season. */
function cupRun(state: GameState, compId: string, clubId: number): string {
  const comp = state.comps[compId];
  if (comp.champion === clubId) return 'Campeão';
  let last = -1;
  comp.stages.forEach((st, i) => {
    if (st.ties.some((t) => t.a === clubId || t.b === clubId)) last = i;
  });
  if (last < 0) return comp.groups.length ? 'Fase de grupos' : 'Eliminado';
  if (last === comp.stages.length - 1 && comp.stages[last].name === 'Final') return 'Vice-campeão';
  return comp.stages[last].name;
}

/** Review of one human manager's season at his club (called at the end of the season, before anything moves). */
export function buildReview(state: GameState, m: Manager, club: Club, ranks: Record<string, number[]>): SeasonReview {
  const season = state.meta.season;
  const league = club.league;
  const order = league ? ranks[league] : undefined;
  const pos = order ? order.indexOf(club.id) + 1 || null : null;
  const of = order?.length ?? 0;
  const record: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let biggestWin: SeasonReview['biggestWin'] = null;
  for (const f of Object.values(state.fixtures)) {
    if (f.hg == null || f.ag == null || (f.home !== club.id && f.away !== club.id)) continue;
    const home = f.home === club.id;
    const gf = home ? f.hg : f.ag;
    const ga = home ? f.ag : f.hg;
    record[gf > ga ? 0 : gf === ga ? 1 : 2]++;
    record[3] += gf;
    record[4] += ga;
    if (gf > ga && (!biggestWin || gf - ga > biggestWin.gf - biggestWin.ga || (gf - ga === biggestWin.gf - biggestWin.ga && gf > biggestWin.gf)))
      biggestWin = { opp: home ? f.away : f.home, gf, ga };
  }
  const cups = Object.values(state.comps)
    .filter((c) => c.cfg.kind !== 'league' && c.clubs.includes(club.id))
    .map((c) => ({ comp: c.id, reached: cupRun(state, c.id, club.id) }));
  const squad = Object.values(state.players).filter((p) => p.clubId === club.id && !p.junior && p.s.apps > 0);
  const most = Math.max(0, ...squad.map((p) => p.s.apps));
  const regulars = squad.filter((p) => p.s.apps >= most * 0.4);
  const best = [...regulars].sort((a, b) => merit(b) - merit(a))[0];
  const scorer = [...squad].sort((a, b) => b.s.goals - a.s.goals || b.s.ast - a.s.ast)[0];
  const signing = squad.filter((p) => p.joined === season && p.s.apps >= 5).sort((a, b) => merit(b) * Math.min(1, b.s.apps / 20) - merit(a) * Math.min(1, a.s.apps / 20))[0];
  return {
    season,
    manager: m.id,
    clubId: club.id,
    league,
    pos,
    of,
    goal: club.board.goal,
    met: pos != null ? objectiveDelta(club.board.goal, pos, of) >= 0 : true,
    cups,
    record,
    biggestWin,
    best: best ? asReview(best) : null,
    scorer: scorer && scorer.s.goals > 0 ? asReview(scorer) : null,
    signing: signing ? asReview(signing) : null,
    team: league ? teamOfSeason(state, league) : [],
    fans: Math.round(club.fans ?? 60),
    conf: Math.round(club.board.conf),
  };
}

/** Reviews of every human manager's season; only the last few seasons are kept. */
export function seasonReviews(state: GameState, ranks: Record<string, number[]>) {
  const list = (state.reviews ??= []);
  for (const m of Object.values(state.managers)) {
    const club = m.clubId != null ? state.clubs[m.clubId] : null;
    if (club) list.push(buildReview(state, m, club, ranks));
  }
  // a few seasons per manager is plenty for the file size
  const keep = Object.keys(state.managers).length * 5;
  if (list.length > keep) list.splice(0, list.length - keep);
}
