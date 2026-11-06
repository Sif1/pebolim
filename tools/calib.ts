// Prints match-engine statistics for calibration: npx tsx tools/calib.ts [n] [pairs]
import { MatchSim } from '../src/engine/match/core';
import { synthSetup } from '../tests/helpers';

const N = Number(process.argv[2] ?? 2000);

function run(hs: number, as: number) {
  const sum: Record<string, number> = {};
  const add = (k: string, v: number) => (sum[k] = (sum[k] ?? 0) + v);
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    const sim = new MatchSim(synthSetup(hs, as, i * 7919 + hs * 13 + as));
    const r = sim.runToEnd();
    add('goals', r.hg + r.ag);
    add(r.hg > r.ag ? 'H' : r.hg === r.ag ? 'D' : 'A', 1);
    for (const s of r.stats) {
      add('shots', s.shots);
      add('onT', s.onTarget);
      add('corners', s.corners);
      add('fouls', s.fouls);
      add('yel', s.yel);
      add('red', s.red);
      add('passes', s.passes);
      add('passFail', s.passFail);
      add('tackles', s.tackles);
      add('big', s.big);
      add('xg', s.xg);
      add('saves', s.saves);
    }
    add('possH', sim.possPct());
    const rts = Object.values(r.players).filter((p) => p.mins >= 30);
    add('rt', rts.reduce((a, p) => a + p.rt, 0) / Math.max(1, rts.length));
    add('rtMax', Math.max(...rts.map((p) => p.rt)));
    add('rtMin', Math.min(...rts.map((p) => p.rt)));
  }
  const ms = (performance.now() - t0) / N;
  const f = (k: string, per = 1) => ((sum[k] ?? 0) / N / per).toFixed(2);
  const pct = (k: string) => (((sum[k] ?? 0) / N) * 100).toFixed(1) + '%';
  const acc = ((sum.passes / (sum.passes + sum.passFail)) * 100).toFixed(1);
  console.log(
    `${hs} vs ${as}: goals ${f('goals')} xG ${f('xg')} | H ${pct('H')} D ${pct('D')} A ${pct('A')} | per team: shots ${f('shots', 2)} onT ${f('onT', 2)} big ${f('big', 2)} passes ${f('passes', 2)} (${acc}%) tackles ${f('tackles', 2)} saves ${f('saves', 2)} corners ${f('corners', 2)} fouls ${f('fouls', 2)} | match: yel ${f('yel')} red ${f('red')} possH ${f('possH')} | ratings avg ${f('rt')} max ${f('rtMax')} min ${f('rtMin')} | ${ms.toFixed(2)} ms`,
  );
}

const pairs = (process.argv[3] ?? '70-70,75-65,65-75,80-60,60-80').split(',').map((p) => p.split('-').map(Number));
for (const [h, a] of pairs) run(h, a);
