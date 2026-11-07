// Derbies (clássicos): famous rivalries between big clubs, plus the biggest clubs of the same city.
// A derby moves the fans and the board twice as much, fills the stadium, gets its own commentary, and every
// derby and every match of a human-managed club adds to a head-to-head record kept across seasons.
import type { Club, Fixture, GameState } from './types';

/** Famous rivalries between clubs of different cities (same-city derbies are found on their own). */
const CLASSICS: [string, string][] = [
  // Brazil: the São Paulo "clássicos" with Santos
  ['santos', 'corinthians'],
  ['santos', 'palmeiras'],
  ['santos', 'saopaulo'],
  // Argentina: the five "grandes"
  ['boca', 'racingarg'],
  ['boca', 'independiente'],
  ['river', 'racingarg'],
  ['river', 'independiente'],
  ['boca', 'sanlorenzo'],
  ['river', 'sanlorenzo'],
  // Europe
  ['realmadrid', 'barcelona'],
  ['athletic', 'realsociedad'],
  ['liverpool', 'manutd'],
  ['newcastle', 'sunderland'],
  ['inter', 'juventus'],
  ['milan', 'juventus'],
  ['napoli', 'juventus'],
  ['bayern', 'dortmund'],
  ['dortmund', 'schalke'],
  ['koln', 'gladbach'],
  ['psg', 'marseille'],
  ['lyon', 'saintetienne'],
  ['marseille', 'lyon'],
  ['nice', 'monaco'],
  ['benfica', 'porto'],
  ['sportingcp', 'porto'],
  ['ajax', 'feyenoord'],
  ['ajax', 'psv'],
  ['olympiacos', 'panathinaikos'],
  ['colocolo', 'uchile'],
  ['olimpia', 'cerroporteno'],
  ['atlnacional', 'millonarios'],
  ['ldu', 'barcelonasc'],
];

const cache = new WeakMap<object, Set<string>>();

export const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** Every derby pair of the world (club ids), worked out once per set of clubs. */
function derbies(state: GameState): Set<string> {
  let set = cache.get(state.clubs);
  if (set) return set;
  set = new Set<string>();
  const clubs = Object.values(state.clubs);
  const byKey = new Map(clubs.map((c) => [c.key, c]));
  for (const [a, b] of CLASSICS) {
    const x = byKey.get(a);
    const y = byKey.get(b);
    if (x && y) set.add(pairKey(x.id, y.id));
  }
  // same city: the four best-known clubs of a city (by reputation) are each other's rivals
  const cities = new Map<string, Club[]>();
  for (const c of clubs) {
    if (c.rep < 50) continue;
    const k = `${c.country}|${c.city}`;
    cities.set(k, [...(cities.get(k) ?? []), c]);
  }
  for (const list of cities.values()) {
    const top = list.sort((a, b) => b.rep - a.rep).slice(0, 4);
    for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) set.add(pairKey(top[i].id, top[j].id));
  }
  cache.set(state.clubs, set);
  return set;
}

export function isDerby(state: GameState, a: number, b: number): boolean {
  return derbies(state).has(pairKey(a, b));
}

/** A club's rivals, biggest first. */
export function rivalsOf(state: GameState, clubId: number): Club[] {
  const out: Club[] = [];
  for (const k of derbies(state)) {
    const [a, b] = k.split('-').map(Number);
    if (a === clubId && state.clubs[b]) out.push(state.clubs[b]);
    else if (b === clubId && state.clubs[a]) out.push(state.clubs[a]);
  }
  return out.sort((x, y) => y.rep - x.rep);
}

/** Head-to-head between two clubs, from the first club's side: wins, draws, losses, goals for, goals against. */
export function headToHead(state: GameState, a: number, b: number): [number, number, number, number, number] {
  const r = state.h2h?.[pairKey(a, b)];
  if (!r) return [0, 0, 0, 0, 0];
  return a < b ? [r[0], r[1], r[2], r[3], r[4]] : [r[2], r[1], r[0], r[4], r[3]];
}

/** Add a finished match to the head-to-head record (derbies and matches of human-managed clubs only). */
export function recordHeadToHead(state: GameState, f: Fixture) {
  if (f.hg == null || f.ag == null) return;
  const human = !!state.clubs[f.home]?.managerId || !!state.clubs[f.away]?.managerId;
  if (!human && !isDerby(state, f.home, f.away)) return;
  const k = pairKey(f.home, f.away);
  const r = ((state.h2h ??= {})[k] ??= [0, 0, 0, 0, 0]);
  // stored from the side of the lower id
  const [loG, hiG] = f.home < f.away ? [f.hg, f.ag] : [f.ag, f.hg];
  if (loG > hiG) r[0]++;
  else if (loG === hiG) r[1]++;
  else r[2]++;
  r[3] += loG;
  r[4] += hiG;
}
