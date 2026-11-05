import type { CalDate, Track } from './types';

/**
 * One shared season calendar for every country (January to December).
 * Tracks keep a club from ever having two matches on the same date:
 *  E = estaduais (Brazil) / league dates for countries without estaduais
 *  L = leagues, N = national cups, C = continental cups.
 */
export function buildCalendar(season: number): CalDate[] {
  const seq: Track[] = [];
  // Phase 1 (Jan-Mar): 15 estadual dates with 2 cup and 2 continental dates mixed in.
  for (let i = 0; i < 15; i++) {
    seq.push('E');
    if (i === 2 || i === 7) seq.push('N');
    if (i === 10 || i === 13) seq.push('C');
  }
  // Phase 2: 40 league dates; the remaining 8 cup and 11 continental dates are spread evenly.
  const extras: Track[] = [];
  let c = 11;
  let n = 8;
  while (c > 0 || n > 0) {
    if (c > 0) {
      extras.push('C');
      c--;
    }
    if (n > 0) {
      extras.push('N');
      n--;
    }
  }
  for (let i = 0; i < 40; i++) {
    seq.push('L');
    if (i % 2 === 1 && extras.length) seq.push(extras.shift()!);
  }
  while (extras.length) seq.push(extras.shift()!);

  // Dates alternate Sunday/Wednesday, with a gap after the estaduais and a mid-year break.
  const out: CalDate[] = [];
  let d = new Date(Date.UTC(season, 0, 14));
  while (d.getUTCDay() !== 0) d = new Date(d.getTime() + 86400000);
  let wd: 'dom' | 'qua' = 'dom';
  const breakAfter = 19 + 30; // ~ end of June
  for (let i = 0; i < seq.length; i++) {
    out.push({ idx: i, day: d.getUTCDate(), month: d.getUTCMonth() + 1, wd, track: seq[i], window: false });
    let add = wd === 'dom' ? 3 : 4;
    if (i === 18) add += 7;
    if (i === breakAfter) add += 21;
    d = new Date(d.getTime() + add * 86400000);
    wd = wd === 'dom' ? 'qua' : 'dom';
  }
  // Transfer windows: pre-season/estaduais and the mid-year break.
  for (const cd of out) {
    if (cd.idx <= 19 || (cd.idx >= breakAfter - 2 && cd.idx <= breakAfter + 4)) cd.window = true;
  }
  return out;
}

/** Pick `count` items spread evenly from `slots` (keeps order). */
export function spread(slots: number[], count: number): number[] {
  if (count >= slots.length) return slots.slice(0, count);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(slots[Math.floor((i * slots.length) / count)]);
  return out;
}

export function slotsFor(cal: CalDate[], tracks: Track[]): number[] {
  return cal.filter((d) => tracks.includes(d.track)).map((d) => d.idx);
}
