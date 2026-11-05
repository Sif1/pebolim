import type { Club, GameState, Ledger, Player, TableRow } from './types';

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export const age = (p: Player, season: number) => season - p.birth;

/** Market value in R$, from strength, age and potential. */
export function playerValue(p: Player, season: number): number {
  const a = age(p, season);
  const s = p.str;
  let v = 250_000 * Math.pow(10, (s - 40) / 15);
  if (a <= 21) v *= 1.3 + Math.max(0, p.pot - s) / 25;
  else if (a <= 24) v *= 1.25 + Math.max(0, p.pot - s) / 40;
  else if (a <= 28) v *= 1.1;
  else if (a <= 30) v *= 0.85;
  else if (a <= 32) v *= 0.55;
  else v *= 0.3;
  if (p.pos === 'GOL') v *= 0.75;
  if (p.injury > 10) v *= 0.85;
  return roundMoney(Math.max(50_000, v));
}

/** Monthly wage a player expects at a club of the given reputation. */
export function expectedWage(p: Player, season: number, clubRep = 60): number {
  const v = playerValue(p, season);
  const repF = 0.6 + clubRep / 125;
  return roundMoney(Math.max(4_000, (v * 0.011 + 6_000) * repF));
}

export function roundMoney(v: number): number {
  if (v >= 10_000_000) return Math.round(v / 100_000) * 100_000;
  if (v >= 1_000_000) return Math.round(v / 10_000) * 10_000;
  if (v >= 100_000) return Math.round(v / 1_000) * 1_000;
  return Math.round(v / 100) * 100;
}

export function formatMoney(v: number): string {
  const neg = v < 0;
  const a = Math.abs(v);
  let s: string;
  if (a >= 1_000_000_000) s = (a / 1_000_000_000).toFixed(2).replace('.', ',') + ' bi';
  else if (a >= 1_000_000) s = (a / 1_000_000).toFixed(a >= 100_000_000 ? 0 : 1).replace('.', ',') + ' mi';
  else if (a >= 1_000) s = Math.round(a / 1_000) + ' mil';
  else s = String(Math.round(a));
  return (neg ? '-R$ ' : 'R$ ') + s;
}

/** Great-circle distance in km. */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export const emptyRow = (): TableRow => ({ p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 });

export const emptyLedger = (): Ledger => ({
  tickets: 0,
  sponsors: 0,
  tv: 0,
  prizes: 0,
  sales: 0,
  wages: 0,
  upkeep: 0,
  travel: 0,
  purchases: 0,
  works: 0,
});

/** Sort club ids by table: points, wins, goal difference, goals for, then name. */
export function sortTable(table: Record<number, TableRow>, clubs: Record<number, Club>): number[] {
  return Object.keys(table)
    .map(Number)
    .sort((a, b) => {
      const ra = table[a];
      const rb = table[b];
      return (
        rb.pts - ra.pts ||
        rb.w - ra.w ||
        rb.gf - rb.ga - (ra.gf - ra.ga) ||
        rb.gf - ra.gf ||
        (clubs[a]?.name ?? '').localeCompare(clubs[b]?.name ?? '')
      );
    });
}

export function squadOf(state: GameState, clubId: number): Player[] {
  const out: Player[] = [];
  for (const id in state.players) {
    const p = state.players[id];
    if (p.clubId === clubId) out.push(p);
  }
  return out;
}

/** Build a clubId -> players index in one pass (much faster than squadOf in loops). */
export function squadIndex(state: GameState): Map<number, Player[]> {
  const m = new Map<number, Player[]>();
  for (const id in state.players) {
    const p = state.players[id];
    if (p.clubId == null) continue;
    let arr = m.get(p.clubId);
    if (!arr) m.set(p.clubId, (arr = []));
    arr.push(p);
  }
  return m;
}

export function dateLabel(state: GameState, idx: number): string {
  const d = state.calendar[idx];
  if (!d) return '—';
  return `${String(d.day).padStart(2, '0')}/${String(d.month).padStart(2, '0')}/${state.meta.season}`;
}

/** Absolute date number across seasons, used for tenure. */
export const absDate = (season: number, date: number) => season * 100 + date;

export function addNews(
  state: GameState,
  kind: GameState['news'][number]['kind'],
  text: string,
  clubs: number[] = [],
  to: string | null = null,
) {
  state.news.push({
    id: state.meta.next.news++,
    season: state.meta.season,
    date: state.meta.date,
    kind,
    text,
    clubs,
    to,
  });
  if (state.news.length > 400) state.news.splice(0, state.news.length - 400);
}
