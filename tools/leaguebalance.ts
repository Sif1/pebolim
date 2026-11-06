// Plays three full seasons and checks that the strongest squads still finish on top:
// npx tsx tools/leaguebalance.ts [on|off] [nomatch]
//   off      AI clubs keep default tactics (only tired substitutions)
//   nomatch  switch off the tactical matchup effects (counter space, long balls vs pressing, defensive block)
import { readFileSync } from 'node:fs';
import { finishDate, simulateBackground } from '../src/engine/advance';
import { AI_COACH } from '../src/engine/ai/tactics';
import { prepareMatchday } from '../src/engine/matchday';
import { Rng } from '../src/engine/rng';
import { sortTable } from '../src/engine/util';
import { createWorld } from '../src/engine/world';

const db = JSON.parse(readFileSync('public/db/base.json', 'utf8'));
AI_COACH.enabled = process.argv[2] !== 'off';
AI_COACH.matchups = process.argv[3] !== 'nomatch';
let corrSum = 0;
let n = 0;
let topRank = 0;
let topN = 0;
let champTop3 = 0;
for (const seed of ['s1', 's2', 's3']) {
  const s = createWorld(db, { name: 'x', seed });
  const present = new Set<string>();
  const power = Object.fromEntries(Object.values(s.clubs).map((c) => [c.id, c.power]));
  while (s.meta.date < s.calendar.length - 1) {
    const rng = new Rng(s.meta.rng);
    const plan = prepareMatchday(s, rng, present);
    s.meta.rng = rng.state();
    finishDate(s, Object.values(simulateBackground(plan)), present);
  }
  for (const l of ['BRA1', 'ENG1', 'ESP1', 'ITA1', 'GER1', 'FRA1', 'ARG1']) {
    const order = sortTable(s.comps[l].table, s.clubs);
    const byPow = [...order].sort((a, b) => power[b] - power[a]);
    const k = order.length;
    let d2 = 0;
    order.forEach((id, i) => (d2 += (i - byPow.indexOf(id)) ** 2));
    corrSum += 1 - (6 * d2) / (k * (k * k - 1));
    n++;
    for (const id of byPow.slice(0, 3)) {
      topRank += order.indexOf(id) + 1;
      topN++;
    }
    if (byPow.slice(0, 3).includes(order[0])) champTop3++;
  }
}
console.log(
  `AI coach ${AI_COACH.enabled ? 'on' : 'off'}, matchups ${AI_COACH.matchups ? 'on' : 'off'}: ` +
    `strength-vs-table rank correlation ${(corrSum / n).toFixed(3)} | average final position of the 3 strongest ${(topRank / topN).toFixed(2)} | ` +
    `champion among the 3 strongest in ${champTop3} of ${n} leagues`,
);
