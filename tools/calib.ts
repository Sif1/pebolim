// Prints match-engine statistics for calibration: npx tsx tools/calib.ts [n]
import { MatchSim } from '../src/engine/match/core';
import { synthSetup } from '../tests/helpers';

const N = Number(process.argv[2] ?? 2000);

function run(hs: number, as: number) {
  let goals = 0, hw = 0, dr = 0, aw = 0, shots = 0, ont = 0, corners = 0, fouls = 0, yel = 0, red = 0, poss = 0;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    const sim = new MatchSim(synthSetup(hs, as, i * 7919 + hs * 13 + as));
    const r = sim.runToEnd();
    goals += r.hg + r.ag;
    if (r.hg > r.ag) hw++;
    else if (r.hg === r.ag) dr++;
    else aw++;
    shots += r.stats[0].shots + r.stats[1].shots;
    ont += r.stats[0].onTarget + r.stats[1].onTarget;
    corners += r.stats[0].corners + r.stats[1].corners;
    fouls += r.stats[0].fouls + r.stats[1].fouls;
    yel += r.stats[0].yel + r.stats[1].yel;
    red += r.stats[0].red + r.stats[1].red;
    poss += sim.possPct();
  }
  const ms = (performance.now() - t0) / N;
  const f = (x: number) => (x / N).toFixed(2);
  console.log(
    `${hs} vs ${as}: goals ${f(goals)} | H ${((hw / N) * 100).toFixed(1)}% D ${((dr / N) * 100).toFixed(1)}% A ${((aw / N) * 100).toFixed(1)}% | shots ${f(shots)} onT ${f(ont)} corners ${f(corners)} fouls ${f(fouls)} yel ${f(yel)} red ${f(red)} possH ${f(poss)} | ${ms.toFixed(2)} ms/match`,
  );
}

const pairs = (process.argv[3] ?? "70-70,75-65,65-75,80-60,60-80").split(",").map((p) => p.split("-").map(Number));
for (const [h, a] of pairs) run(h, a);
