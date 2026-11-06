// Measures how much each match-engine input moves results: npx tsx tools/sensitivity.ts [n]
// Every scenario plays the same seeds as the baseline (two 70-rated teams, 4-4-2, balanced tactics) and changes
// one thing about the home team, which keeps its tactics for the whole match (like a manager who doesn't touch
// anything) against an opponent run by the AI coach. Reports the change in its points per game and goal difference.
import { MatchSim, type MatchSetup, type TeamSetup } from '../src/engine/match/core';
import { Rng } from '../src/engine/rng';
import type { Formation, Pos, Tactics, Trait } from '../src/engine/types';
import { synthTeam } from '../tests/helpers';

const N = Number(process.argv[2] ?? 3000);

type Mod = (t: TeamSetup) => void;

function setup(seed: number, mod: Mod | null, formation: Formation = '4-4-2', tactics?: Partial<Tactics>, swapSides = false): MatchSetup {
  const rng = Rng.fromSeed(seed);
  const a = synthTeam(70, rng, formation, tactics);
  const b = synthTeam(70, rng);
  a.ai = false;
  if (mod) mod(a);
  const [home, away] = swapSides ? [b, a] : [a, b];
  return { fixtureId: seed, compId: 'T', home, away, seed: rng.fork(), homeAdv: 1.07, decider: null };
}

function measure(mod: Mod | null, formation?: Formation, tactics?: Partial<Tactics>, swapSides = false) {
  let pts = 0;
  let gd = 0;
  let xg = 0;
  for (let i = 0; i < N; i++) {
    const r = new MatchSim(setup(i * 7919 + 17, mod, formation, tactics, swapSides)).runToEnd();
    const [mine, theirs] = swapSides ? [r.ag, r.hg] : [r.hg, r.ag];
    pts += mine > theirs ? 3 : mine === theirs ? 1 : 0;
    gd += mine - theirs;
    const s = swapSides ? [r.stats[1], r.stats[0]] : r.stats;
    xg += s[0].xg - s[1].xg;
  }
  return { ppg: pts / N, gd: gd / N, xgd: xg / N };
}

const xi = (t: TeamSetup) => t.players.slice(0, 11);
const byPos = (t: TeamSetup, ps: Pos[]) => xi(t).filter((p) => ps.includes(p.pos));
const addStr = (ps: { str: number }[], d: number) => ps.forEach((p) => (p.str += d));
const trait = (ps: { traits: Trait[] }[], tr: Trait) => ps.forEach((p) => p.traits.push(tr));

const scenarios: { group: string; name: string; mod?: Mod; formation?: Formation; tactics?: Partial<Tactics>; away?: boolean }[] = [
  { group: 'Força', name: 'Todos os jogadores +5 de força (70 → 75)', mod: (t) => addStr(t.players, 5) },
  { group: 'Força', name: 'Todos os jogadores +10 de força (70 → 80)', mod: (t) => addStr(t.players, 10) },
  { group: 'Força', name: 'Todos os jogadores −5 de força', mod: (t) => addStr(t.players, -5) },
  { group: 'Setores', name: 'Goleiro +10', mod: (t) => addStr(byPos(t, ['GOL']), 10) },
  { group: 'Setores', name: 'Defensores (ZAG/LAT) +10', mod: (t) => addStr(byPos(t, ['ZAG', 'LAT']), 10) },
  { group: 'Setores', name: 'Meio-campo (VOL/MEI) +10', mod: (t) => addStr(byPos(t, ['VOL', 'MEI']), 10) },
  { group: 'Setores', name: 'Atacantes (ATA) +10', mod: (t) => addStr(byPos(t, ['ATA']), 10) },
  { group: 'Mando', name: 'Jogar fora de casa (em vez de em casa)', away: true },
  { group: 'Condição', name: 'Energia 75% (em vez de 95%)', mod: (t) => t.players.forEach((p) => (p.fitness = 75)) },
  { group: 'Condição', name: 'Energia 60%', mod: (t) => t.players.forEach((p) => (p.fitness = 60)) },
  { group: 'Condição', name: 'Viagem de ônibus de 1.000 km (−9 de energia)', mod: (t) => t.players.forEach((p) => (p.fitness -= 9)) },
  { group: 'Condição', name: 'Moral 95 (em vez de 60)', mod: (t) => t.players.forEach((p) => (p.morale = 95)) },
  { group: 'Condição', name: 'Moral 25', mod: (t) => t.players.forEach((p) => (p.morale = 25)) },
  { group: 'Condição', name: 'Elenco veterano (cansa 15% mais rápido)', mod: (t) => t.players.forEach((p) => (p.tire = 1.15)) },
  { group: 'Escalação', name: 'Um atacante jogando de zagueiro (fora de posição)', mod: (t) => (byPos(t, ['ZAG'])[0].pos = 'ATA') },
  { group: 'Escalação', name: 'Três jogadores fora de posição', mod: (t) => {
    byPos(t, ['ZAG'])[0].pos = 'ATA';
    byPos(t, ['MEI'])[0].pos = 'ZAG';
    byPos(t, ['ATA'])[0].pos = 'LAT';
  } },
  { group: 'Escalação', name: 'Jogar com 10 desde o início', mod: (t) => (t.xi[9] = null) },
  { group: 'Tática', name: 'Postura ofensiva', tactics: { mentality: 'ofensiva' } },
  { group: 'Tática', name: 'Postura defensiva', tactics: { mentality: 'defensiva' } },
  { group: 'Tática', name: 'Marcação pressão alta', tactics: { marking: 'pressao' } },
  { group: 'Tática', name: 'Estilo contra-ataque', tactics: { style: 'contra' } },
  { group: 'Tática', name: 'Estilo bola longa', tactics: { style: 'longa' } },
  ...(['4-3-3', '4-2-3-1', '3-5-2', '5-3-2', '4-5-1', '3-4-3'] as Formation[]).map((f) => ({ group: 'Formação', name: `Formação ${f} (contra 4-4-2)`, formation: f })),
  { group: 'Características', name: 'Atacantes com "finalização"', mod: (t) => trait(byPos(t, ['ATA']), 'finalizacao') },
  { group: 'Características', name: 'Meio-campo com "passe"', mod: (t) => trait(byPos(t, ['VOL', 'MEI']), 'passe') },
  { group: 'Características', name: 'Meias e atacantes com "drible"', mod: (t) => trait(byPos(t, ['MEI', 'ATA']), 'drible') },
  { group: 'Características', name: 'Goleiro com "reflexos"', mod: (t) => trait(byPos(t, ['GOL']), 'reflexos') },
  { group: 'Características', name: 'Um líder em campo ("liderança")', mod: (t) => trait(byPos(t, ['VOL', 'MEI']).slice(0, 1), 'lideranca') },
  { group: 'Características', name: 'Defensores com "marcação"', mod: (t) => trait(byPos(t, ['ZAG', 'LAT', 'VOL']), 'marcacao') },
  { group: 'Características', name: 'Zagueiros e atacantes com "cabeceio"', mod: (t) => trait(byPos(t, ['ZAG', 'ATA']), 'cabeceio') },
];

const t0 = performance.now();
const base = measure(null);
console.log(`Base: ${N} jogos, 70 x 70 em casa: ${base.ppg.toFixed(3)} pontos/jogo, saldo ${base.gd.toFixed(3)}, xG saldo ${base.xgd.toFixed(3)}\n`);
const rows = scenarios.map((s) => {
  const r = measure(s.mod ?? null, s.formation, s.tactics, s.away);
  return { ...s, dppg: r.ppg - base.ppg, dgd: r.gd - base.gd, dxg: r.xgd - base.xgd };
});
rows.sort((a, b) => Math.abs(b.dppg) - Math.abs(a.dppg));
console.log('| # | Grupo | Mudança | Δ pontos/jogo | Δ saldo/jogo | Δ saldo de xG |');
console.log('|---|---|---|---:|---:|---:|');
rows.forEach((r, i) => {
  const sg = (v: number, d = 2) => (v >= 0 ? '+' : '') + v.toFixed(d);
  console.log(`| ${i + 1} | ${r.group} | ${r.name} | ${sg(r.dppg)} | ${sg(r.dgd)} | ${sg(r.dxg)} |`);
});
console.log(`\n(${((performance.now() - t0) / 1000).toFixed(0)} s; erro típico de cada linha ≈ ±${(1.2 / Math.sqrt(N)).toFixed(2)} pontos/jogo)`);
