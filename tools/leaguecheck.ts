// Prints the top of a few final league tables with each club's starting strength: npx tsx tools/leaguecheck.ts [seed]
import { readFileSync } from 'node:fs';
import { finishDate, simulateBackground } from '../src/engine/advance';
import { prepareMatchday } from '../src/engine/matchday';
import { Rng } from '../src/engine/rng';
import { sortTable } from '../src/engine/util';
import { createWorld } from '../src/engine/world';

const db = JSON.parse(readFileSync('public/db/base.json', 'utf8'));
const s = createWorld(db, { name: 'chk', seed: process.argv[2] ?? 'chk-1' });
const present = new Set<string>();
const powerAtStart = Object.fromEntries(Object.values(s.clubs).map((c) => [c.id, c.power]));
while (s.meta.date < s.calendar.length - 1) {
  const rng = new Rng(s.meta.rng);
  const plan = prepareMatchday(s, rng, present);
  s.meta.rng = rng.state();
  finishDate(s, Object.values(simulateBackground(plan)), present);
}
for (const l of ['FRA1', 'GER1', 'ESP1', 'ENG1', 'BRA1']) {
  const table = s.comps[l].table;
  const order = sortTable(table, s.clubs);
  const byPower = order.slice().sort((a, b) => powerAtStart[b] - powerAtStart[a]);
  console.log(`\n${l}:`);
  order.slice(0, 5).forEach((id, i) =>
    console.log(`  ${i + 1}. ${s.clubs[id].name.padEnd(26)} pts ${table[id].pts}  power ${powerAtStart[id].toFixed(1)} (rank ${byPower.indexOf(id) + 1})`),
  );
}
