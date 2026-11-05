// Headless season simulation: npx tsx tools/sim.ts [seasons] [--synthetic]
import { readFileSync, existsSync } from 'node:fs';
import { finishDate, simulateBackground } from '../src/engine/advance';
import type { Database } from '../src/engine/db';
import { prepareMatchday } from '../src/engine/matchday';
import { Rng } from '../src/engine/rng';
import type { GameState } from '../src/engine/types';
import { formatMoney, sortTable, squadIndex } from '../src/engine/util';
import { createWorld } from '../src/engine/world';
import { synthDb } from '../tests/synthDb';

const seasons = Number(process.argv[2] ?? 1);
const synthetic = process.argv.includes('--synthetic') || !existsSync('public/db/base.json');
const db: Database = synthetic ? synthDb() : JSON.parse(readFileSync('public/db/base.json', 'utf8'));

let t0 = performance.now();
const state: GameState = createWorld(db, { name: 'sim', seed: 'sim-1' });
console.log(
  `world: ${Object.keys(state.clubs).length} clubs, ${Object.keys(state.players).length} players, ${Object.keys(state.fixtures).length} fixtures, ${Object.keys(state.comps).length} comps (${(performance.now() - t0).toFixed(0)} ms)`,
);

const present = new Set<string>();
for (let s = 0; s < seasons; s++) {
  t0 = performance.now();
  const season = state.meta.season;
  let goals = 0;
  let games = 0;
  let worst = 0;
  while (state.meta.season === season) {
    const d0 = performance.now();
    const rng = new Rng(state.meta.rng);
    const plan = prepareMatchday(state, rng, present);
    state.meta.rng = rng.state();
    const res = simulateBackground(plan);
    for (const r of Object.values(res)) {
      goals += r.hg + r.ag;
      games++;
    }
    finishDate(state, Object.values(res), present);
    worst = Math.max(worst, performance.now() - d0);
  }
  const hist = state.history[state.history.length - 1];
  console.log(`\nSeason ${season}: ${games} games, ${(goals / games).toFixed(2)} goals/game, ${(performance.now() - t0).toFixed(0)} ms (slowest date ${worst.toFixed(0)} ms)`);
  for (const [comp, cid] of Object.entries(hist.champions)) console.log(`  ${comp.padEnd(8)} ${state.clubs[cid].name}`);
  const unfinished = Object.values(state.comps).filter((c) => !c.finished);
  console.log(`  players: ${Object.keys(state.players).length}, free agents: ${Object.values(state.players).filter((p) => p.clubId == null).length}`);
  const idx = squadIndex(state);
  const sizes = [...idx.values()].map((s) => s.length);
  console.log(`  squad sizes min ${Math.min(...sizes)} max ${Math.max(...sizes)}`);
  const bal = Object.values(state.clubs).map((c) => c.balance).sort((a, b) => a - b);
  console.log(`  balances: min ${formatMoney(bal[0])} median ${formatMoney(bal[Math.floor(bal.length / 2)])} max ${formatMoney(bal[bal.length - 1])}`);
  console.log(`  next season comps: ${Object.keys(state.comps).length}, unfinished from new: ${unfinished.length}`);
  const b1 = state.comps.BRA1;
  if (b1) console.log(`  BRA1 next season clubs: ${b1.clubs.length}, table rows ${Object.keys(b1.table).length}, top by rep: ${sortTable(b1.table, state.clubs).slice(0, 3).map((id) => state.clubs[id].name).join(', ')}`);
}
console.log(`\nJSON size: ${(JSON.stringify(state).length / 1024).toFixed(0)} KB`);

// save size check
import('../src/engine/save').then(async ({ saveToBytes, loadFromBytes }) => {
  const bytes = await saveToBytes(state);
  console.log(`Save file: ${(bytes.length / 1024).toFixed(0)} KB gz`);
  const back = await loadFromBytes(bytes);
  console.log(`Round-trip players: ${Object.keys(back.players).length}, fixtures: ${Object.keys(back.fixtures).length}`);
});
