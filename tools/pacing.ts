// How does a live match spend its real time? Plays matches through LiveMatch at a chosen length and reports
// how many highlights were shown, at what speed, and how long the pitch sat idle between them.
//   npx tsx tools/pacing.ts [minutes] [matches]
import { LiveMatch } from '../src/engine/match/live';
import { synthSetup } from '../tests/helpers';

const MIN = Number(process.argv[2] ?? 5);
const N = Number(process.argv[3] ?? 12);
const base = 5700 / (MIN * 60);
let real = 0;
let hlReal = 0;
let hlGame = 0;
let idleGame = 0;
let highlights = 0;
let shots = 0;
let goals = 0;
let goalsShown = 0;
for (let i = 0; i < N; i++) {
  const m = new LiveMatch(synthSetup(72, 70, 1000 + i), [false, false]);
  let wasHl = false;
  let guard = 0;
  while (!m.ended && guard++ < 200_000) {
    const before = m.frame();
    m.tick(50, base);
    const fr = m.frame();
    const dg = fr.t - before.t;
    real += 0.05;
    if (fr.hl) {
      hlReal += 0.05;
      hlGame += dg;
      if (!wasHl) highlights++;
    } else idleGame += dg;
    const g = fr.sc[0] + fr.sc[1] - (before.sc[0] + before.sc[1]);
    if (g > 0) {
      goals += g;
      if (fr.hl || before.hl) goalsShown += g;
    }
    wasHl = !!fr.hl;
  }
  shots += m.sim.stats[0].shots + m.sim.stats[1].shots;
}
console.log(`${MIN}-minute matches (plain speed ${base.toFixed(1)} game s per real s), ${N} matches:`);
console.log(`  real length per match ${(real / N).toFixed(0)} s (target ${MIN * 60})`);
console.log(`  highlights ${(highlights / N).toFixed(1)} per match (${(shots / N).toFixed(0)} shots), ${(hlReal / N).toFixed(0)} s on screen at ${(hlGame / Math.max(1e-9, hlReal)).toFixed(1)} game s per real s`);
console.log(`  goals shown ${goalsShown}/${goals}; idle clock ${(idleGame / Math.max(1e-9, real - hlReal)).toFixed(0)} game s per real s`);
