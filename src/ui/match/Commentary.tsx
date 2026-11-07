// Live commentary, Championship Manager style: one line at a time under the pitch, narrating the move on screen
// (who has the ball, the pass, the cross, the shot and how it ends), on the colours of the side in possession.
// A pressure bar tilts toward whoever is on top, and goals flash in the scorer's colours. Half-time and full time
// get a summary line; derbies get their own lines; on the big view the crowd's noise follows the pressure.
// Lines are built from the action in each live frame (see LiveAction in engine/match/live.ts); between
// highlights, while the clock runs fast, a short line every few seconds says how the game is going.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { MatchEvent } from '../../engine/match/core';
import type { LiveAction, LiveFrame } from '../../engine/match/live';
import { useApp } from '../../store';
import { readable } from '../common';
import { crowdBed, stopCrowdBed } from '../sound';

type Kind = 'play' | 'chance' | 'goal' | 'card' | 'info';

interface Line {
  text: string;
  side: 0 | 1 | null;
  kind: Kind;
  /** game second, for the minute shown */
  t: number;
  /** least real time on screen (ms) */
  hold: number;
  /** the half it happened in (for the minute shown); whistles and summaries show none */
  half?: 1 | 2;
  noClock?: boolean;
}

/** Same pick on every screen: the variant comes from the action's id. */
const pick = (id: number, arr: string[]) => arr[Math.abs(id) % arr.length];
const fill = (tpl: string, ...v: string[]) => v.reduce((s, x, i) => s.split(`{${i}}`).join(x), tpl);

// Every template is also a key of the English dictionary (src/i18n/en-ui.ts).
const T = {
  passBack: ['{0} sai jogando com {1}', '{0} toca para {1} lá atrás'],
  passMid: ['{0} toca para {1}', '{0} encontra {1}', '{0} passa para {1}'],
  passFwd: ['{0} procura {1} perto da área', '{0} acha {1} no ataque'],
  back: ['{0} recua para {1}', '{0} volta a bola para {1}'],
  dribble: ['{0} avança com a bola', '{0} parte para cima da marcação', '{0} conduz pelo meio'],
  dribbleBox: ['{0} invade a área!', '{0} passa pelo marcador e entra na área!'],
  long: ['{0} lança {1}', 'Bola longa de {0} para {1}', '{0} tenta a ligação direta com {1}'],
  longSpace: ['{0} lança no espaço', 'Bola longa de {0}', '{0} manda para a frente'],
  cross: ['{0} cruza na área!', '{0} levanta a bola na área', 'Cruzamento de {0}!'],
  shotFar: ['{0} arrisca de fora da área!', '{0} solta a bomba de longe!'],
  shot: ['{0} bate para o gol!', '{0} finaliza!', '{0} chuta!'],
  header: ['{0} sobe para cabecear!', 'Cabeçada de {0}!'],
  penalty: ['{0} parte para a cobrança…'],
  freekick: ['Falta para o {0}. {1} na bola.', 'Cobrança de falta: {1} ajeita a bola.'],
  corner: ['Escanteio para o {0}. {1} vai cobrar.', 'Escanteio: {1} na bola.'],
  throw: ['Lateral para o {0}.'],
  goalkick: ['Tiro de meta para o {0}.'],
  kickoff: ['Bola rolando: saída do {0}.'],
  derbyKickoff: ['É clássico! Bola rolando, saída do {0}.', 'Começa o clássico! Saída do {0}.'],
  derby: ['Clima quente no clássico', 'Jogo pegado, cara de clássico', 'A torcida do {0} canta alto no clássico', 'Ninguém tira o pé: é clássico'],
  save: ['Defesa de {0}!', '{0} defende!', 'Grande defesa de {0}!'],
  saveNoGk: ['O goleiro defende!'],
  wide: ['Para fora!', 'Por cima do gol!', 'Passou perto!'],
  block: ['Bloqueado! Escanteio.', 'A zaga trava o chute: escanteio.'],
  pressing: ['{0} pressiona no campo de ataque', '{0} cerca a área adversária', '{0} está melhor neste momento'],
  midfield: ['{0} troca passes no meio-campo', 'Jogo disputado no meio-campo', '{0} tenta encontrar espaços'],
  deep: ['{0} roda a bola na defesa', '{0} administra a posse lá atrás'],
  attack: ['{0} chega ao ataque', '{0} avança pelo campo'],
};

const dec = (v: number) => v.toFixed(2).replace('.', ',');

/** The summary read at half-time and at full time: score, possession and shots, and who was better. */
function summaryLine(f: LiveFrame, kind: 'ht' | 'ft', shorts: [string, string], teams: [string, string]): Line {
  const [h, a] = f.sc;
  if (kind === 'ht') {
    const better = f.shots[0] - f.shots[1] >= 4 || f.x.xg[0] - f.x.xg[1] >= 60 ? 0 : f.shots[1] - f.shots[0] >= 4 || f.x.xg[1] - f.x.xg[0] >= 60 ? 1 : null;
    const verdict = better == null ? 'Primeiro tempo equilibrado.' : fill('{0} foi melhor no primeiro tempo.', teams[better]);
    return {
      text: fill('Intervalo: {0} {1} x {2} {3}. Posse {4}% x {5}%, finalizações {6} x {7}. {8}', shorts[0], `${h}`, `${a}`, shorts[1], `${f.poss}`, `${100 - f.poss}`, `${f.shots[0]}`, `${f.shots[1]}`, verdict),
      side: null,
      kind: 'info',
      t: f.t,
      hold: 5200,
      noClock: true,
    };
  }
  return {
    text: fill('Fim de jogo: {0} {1} x {2} {3}. Finalizações {4} x {5}, xG {6} x {7}.', shorts[0], `${h}`, `${a}`, shorts[1], `${f.shots[0]}`, `${f.shots[1]}`, dec(f.x.xg[0] / 100), dec(f.x.xg[1] / 100)),
    side: null,
    kind: 'info',
    t: f.t,
    hold: 600000,
    noClock: true,
  };
}

/** Commentary lines for a new action (a shot gives two: the shot, then how it ends). */
function actionLines(ac: LiveAction, t: number, name: (id: number) => string, teams: [string, string], derby = false): Line[] {
  const A = name(ac.a);
  const B = name(ac.g) || teams[ac.s];
  const u = ac.u / 100;
  const v = (arr: string[]) => pick(ac.id, arr);
  const line = (text: string, kind: Kind = 'play', hold = 1100): Line => ({ text, side: ac.s, kind, t, hold });
  switch (ac.k) {
    case 'pass':
      if (!A) return [];
      return [line(fill(v(u > 0.7 ? T.passFwd : u < 0.35 ? T.passBack : T.passMid), A, B))];
    case 'back':
      return A ? [line(fill(v(T.back), A, B))] : [];
    case 'dribble':
      return A ? [line(fill(v(u > 0.82 ? T.dribbleBox : T.dribble), A), u > 0.82 ? 'chance' : 'play')] : [];
    case 'long':
      return A ? [line(ac.g ? fill(v(T.long), A, B) : fill(v(T.longSpace), A))] : [];
    case 'cross':
      return A ? [line(fill(v(T.cross), A), 'chance')] : [];
    case 'shot':
    case 'header':
    case 'penalty': {
      const out: Line[] = [];
      if (A) out.push(line(fill(v(ac.k === 'header' ? T.header : ac.k === 'penalty' ? T.penalty : u < 0.8 ? T.shotFar : T.shot), A), 'chance', 1300));
      // the goal itself comes with its event (big flash); here only the other endings
      const gk = name(ac.g);
      if (ac.r === 'save' && ac.k !== 'penalty') out.push({ ...line(gk ? fill(v(T.save), gk) : v(T.saveNoGk), 'chance', 1400), side: (1 - ac.s) as 0 | 1 });
      else if (ac.r === 'wide' && ac.k !== 'penalty') out.push(line(v(T.wide), 'chance', 1300));
      else if (ac.r === 'block') out.push(line(v(T.block), 'chance', 1300));
      return out;
    }
    case 'freekick':
      return [line(fill(v(T.freekick), teams[ac.s], A || teams[ac.s]), 'play', 1400)];
    case 'corner':
      return [line(fill(v(T.corner), teams[ac.s], A || teams[ac.s]), 'play', 1400)];
    case 'throw':
      return [line(fill(v(T.throw), teams[ac.s]))];
    case 'goalkick':
      return [line(fill(v(T.goalkick), teams[ac.s]))];
    case 'kickoff':
      // the first kick-off of a derby gets its own line
      return [line(fill(v(derby && t < 60 ? T.derbyKickoff : T.kickoff), teams[ac.s]), 'info', 1300)];
    default:
      return [];
  }
}

function eventLine(e: MatchEvent): Line | null {
  switch (e.kind) {
    case 'goal':
      // the banner already shouts it: the line names the scorer
      return { text: e.text.replace(/^GOL!\s*/, ''), side: e.side, kind: 'goal', t: e.t, hold: 4200 };
    case 'yellow':
    case 'red':
    case 'penalty':
      return { text: e.text, side: e.side, kind: 'card', t: e.t, hold: 2400 };
    case 'injury':
    case 'sub':
    case 'miss':
    case 'save':
      return { text: e.text, side: e.side, kind: e.kind === 'miss' || e.kind === 'save' ? 'chance' : 'info', t: e.t, hold: 2000 };
    case 'ht':
    case 'ft':
    case 'pens':
      return { text: e.text, side: null, kind: 'info', t: e.t, hold: 3000 };
    default:
      return null;
  }
}

interface Live {
  lastAt: number;
  lastAction: number;
  queue: Line[];
  cur: Line | null;
  since: number;
  /** pressure: −1 (away on top) … +1 (home on top), smoothed */
  press: number;
  pressAt: number;
  /** goal flash: side and when */
  flash: { side: 0 | 1; at: number } | null;
  ambientAt: number;
  started: boolean;
}

const clockOf = (t: number, half: 1 | 2) => {
  const m = Math.floor(t / 60);
  return half === 1 && m >= 45 ? `45+${m - 44}` : half === 2 && m >= 90 ? `90+${m - 89}` : `${m + 1}`;
};

export function LiveCommentary({
  fixtureId,
  teams,
  shorts,
  colors,
  names,
  compact,
  derby,
  crowdNoise,
}: {
  fixtureId: number;
  /** full names [home, away] */
  teams: [string, string];
  shorts: [string, string];
  /** kits as drawn on the pitch [home, away] */
  colors: [[string, string], [string, string]];
  names: Map<number, string>;
  compact?: boolean;
  derby?: boolean;
  /** drive the crowd's background noise from this match */
  crowdNoise?: boolean;
}) {
  useApp((s) => s.frameTick);
  const client = useApp((s) => s.client);
  const st = useRef<Live>({ lastAt: 0, lastAction: -1, queue: [], cur: null, since: 0, press: 0, pressAt: 0, flash: null, ambientAt: 0, started: false });
  const buf = client?.frames.get(fixtureId);
  const fr: LiveFrame | undefined = buf?.cur;
  const s = st.current;
  const now = performance.now();
  const name = (id: number) => (id ? (names.get(id) ?? '') : '');

  if (buf) {
    if (!s.started) {
      // joining mid-match: start from now, with the latest event on screen
      s.started = true;
      s.lastAt = buf.hist[buf.hist.length - 1]?.at ?? 0;
      const evs = client?.events.get(fixtureId) ?? [];
      const last = [...evs].reverse().find((e) => e.kind !== 'tactic');
      s.cur = last ? eventLine(last) : null;
      s.since = now;
    }
    for (const { f, at } of buf.hist) {
      if (at <= s.lastAt) continue;
      s.lastAt = at;
      for (const e of f.ev) {
        const l = eventLine(e);
        if (!l) continue;
        l.half = f.half;
        if (e.kind === 'ht' || e.kind === 'ft' || e.kind === 'pens') l.noClock = true;
        if (e.kind === 'goal') {
          s.flash = { side: e.side, at: now };
          // the goal jumps the queue: nothing older matters now
          s.queue = [];
          s.cur = l;
          s.since = now;
        } else if (e.kind === 'ht' || e.kind === 'ft') {
          // the whistle, then the summary
          s.queue = [l, summaryLine(f, e.kind, shorts, teams)];
        } else s.queue.push(l);
      }
      const ac = f.ac;
      if (ac && ac.id !== s.lastAction) {
        s.lastAction = ac.id;
        // during a highlight every move is narrated; while the clock runs fast only the chances are
        const lines = actionLines(ac, f.t, name, teams, derby).map((l) => ({ ...l, half: f.half }));
        if (f.hl) s.queue.push(...lines);
        else if (ac.k === 'shot' || ac.k === 'header') s.queue.push(...lines.slice(-1));
        // pressure: the side on the ball, more the closer it is to goal, a little extra for a shot
        const mag = Math.min(1, Math.max(0, (ac.u / 100 - 0.25) / 0.6) + (ac.k === 'shot' || ac.k === 'header' ? 0.3 : 0));
        const target = (ac.s === 0 ? 1 : -1) * mag;
        const dt = s.pressAt ? Math.min(3000, at - s.pressAt) : 1000;
        s.pressAt = at;
        s.press += (target - s.press) * (1 - Math.exp(-dt / (f.hl ? 2200 : 1400)));
      }
    }
    // keep up with the play: never more than a few lines behind (summaries stay)
    while (s.queue.length > 3) {
      const i = s.queue.findIndex((l) => l.kind === 'play' || (l.kind === 'info' && l.side != null));
      s.queue.splice(i >= 0 ? i : 0, 1);
    }
    if (s.queue.length && (!s.cur || now - s.since >= s.cur.hold)) {
      s.cur = s.queue.shift()!;
      s.since = now;
    }
    // between highlights: a word on how the game is going every few seconds
    if (fr && !fr.hl && !fr.paused && !fr.ended && !fr.pk && !s.queue.length && (!s.cur || now - s.since > Math.max(s.cur.hold, 2600)) && now - s.ambientAt > 2600) {
      s.ambientAt = now;
      const ac = fr.ac;
      const side = Math.abs(s.press) > 0.45 ? (s.press > 0 ? 0 : 1) : (ac?.s ?? 0);
      const u = (ac?.u ?? 50) / 100;
      const k = Math.floor(now / 2600);
      const pool = derby && k % 3 === 0 ? T.derby : Math.abs(s.press) > 0.45 ? T.pressing : u > 0.68 ? T.attack : u < 0.35 ? T.deep : T.midfield;
      s.cur = { text: fill(pick(k, pool), teams[side]), side, kind: 'info', t: fr.t, hold: 2600, half: fr.half };
      s.since = now;
    }
  }

  const line = fr?.paused ? { text: 'Partida pausada', side: null, kind: 'info' as Kind, t: fr.t, hold: 0 } : s.cur;
  const flashing = s.flash && now - s.flash.at < 4000 ? s.flash : null;
  const kit = line?.side != null ? colors[line.side] : null;
  const bg = kit ? kit[0] : '#0b1626';
  const fg = kit ? readable(kit[0], kit[1]) : '#dbe6f3';
  const press = Math.max(-1, Math.min(1, s.press));
  const presser = press >= 0 ? colors[0] : colors[1];
  // the crowd: a murmur that grows with the pressure (more for the home side, it's their crowd), a roar at a
  // chance or a goal, quiet when the match stops
  const crowd = !crowdNoise || !fr || fr.ended ? 0 : fr.paused || fr.pk ? 0.12 : flashing ? 1 : s.cur?.kind === 'chance' && now - s.since < 1600 ? 0.75 : 0.22 + Math.abs(press) * (press > 0 ? 0.5 : 0.3) + (derby ? 0.1 : 0);
  useEffect(() => {
    if (crowdNoise) crowdBed(crowd);
  });
  // lines still waiting when no frames come (full time, a pause): show the next one when its turn comes
  const [, wake] = useState(0);
  useEffect(() => {
    if (!s.queue.length || !s.cur) return;
    const id = window.setTimeout(() => wake((x) => x + 1), Math.max(60, s.cur.hold - (performance.now() - s.since)));
    return () => window.clearTimeout(id);
  });
  useEffect(() => {
    if (!crowdNoise) return;
    return () => stopCrowdBed();
  }, [crowdNoise]);

  return (
    <div className={`cm-live ${compact ? 'compact' : ''}`}>
      <div className="cm-press" title="Quem está pressionando agora">
        {!compact && <span className="cm-team">{shorts[0]}</span>}
        <div className="cm-track">
          <div
            className="cm-fill"
            style={{
              [press >= 0 ? 'left' : 'right']: '50%',
              width: `${Math.abs(press) * 50}%`,
              background: presser[0],
              boxShadow: `inset 0 0 0 1px ${presser[1]}`,
            }}
          />
          <div className="cm-mid" />
        </div>
        {!compact && <span className="cm-team">{shorts[1]}</span>}
      </div>
      <div
        key={flashing ? `f${flashing.at}` : 'line'}
        className={`cm-line ${line?.kind ?? ''} ${flashing ? 'flash' : ''}`}
        style={
          {
            background: bg,
            color: fg,
            '--f1': flashing ? colors[flashing.side][0] : bg,
            '--f2': flashing ? colors[flashing.side][1] : bg,
            '--t1': flashing ? readable(colors[flashing.side][0], colors[flashing.side][1]) : fg,
            '--t2': flashing ? readable(colors[flashing.side][1], colors[flashing.side][0]) : fg,
          } as CSSProperties
        }
      >
        {flashing && !compact && <span className="cm-goal">GOOOL!</span>}
        {line && fr && !line.noClock && <span className="cm-min num">{clockOf(line.t, line.half ?? fr.half)}'</span>}
        <span className="cm-text">{line?.text ?? '…'}</span>
      </div>
    </div>
  );
}
