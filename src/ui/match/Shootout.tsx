import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PK_TIMES, type LiveFrame, type PkFrame } from '../../engine/match/live';
import type { PkDir } from '../../engine/match/shootout';
import type { Fixture, GameState } from '../../engine/types';
import { useApp } from '../../store';
import { awayKit, shortName } from '../common';

const DIR_LABEL = ['esquerda', 'meio', 'direita'];
const SHOT_LABEL = ['no canto esquerdo', 'no meio', 'no canto direito'];
const OUT_LABEL = ['GOL!', 'DEFENDEU!', 'PRA FORA!'];

/** The penalty shootout of a live match: scoreboard, the pixel-art kick, and the manager's choices. */
export function ShootoutView({ f, state, fr, mySide }: { f: Fixture; state: GameState; fr: LiveFrame; mySide: 0 | 1 | null }) {
  const client = useApp((s) => s.client)!;
  const pk = fr.pk!;
  const home = state.clubs[f.home];
  const away = state.clubs[f.away];
  const kits = useMemo<[[string, string], [string, string]]>(() => [home.colors, awayKit(home.colors, away.colors)], [home.colors, away.colors]);
  const players = state.players;
  const numberOf = useCallback((id: number) => players[id]?.num ?? 0, [players]);
  const name = (id: number) => shortName(state.players[id]?.name ?? '?');
  const waitingMe = mySide != null && pk.wait[mySide];
  const kickingMe = pk.next && mySide != null && pk.next[0] === mySide;
  const last = pk.kicks[pk.kicks.length - 1];
  const secs = Math.ceil(pk.left / 1000);

  // keyboard: arrows (or A/W/D) to aim or dive
  useEffect(() => {
    if (pk.phase !== 'aim' || !waitingMe) return;
    const onKey = (e: KeyboardEvent) => {
      const d = e.key === 'ArrowLeft' || e.key === 'a' ? 0 : e.key === 'ArrowUp' || e.key === 'w' ? 1 : e.key === 'ArrowRight' || e.key === 'd' ? 2 : null;
      if (d == null) return;
      e.preventDefault();
      client.match(f.id, { a: 'pkAim', dir: d as PkDir });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pk.phase, waitingMe, client, f.id]);

  return (
    <div className="pk">
      <PkBoard pk={pk} names={[home.short, away.short]} kits={kits} />
      <div className="pk-stage">
        <PkCanvas fixtureId={f.id} kits={kits} numberOf={numberOf} />
        <div className="pk-overlay">
          {pk.phase === 'order' && <div className="pk-banner">DISPUTA DE PÊNALTIS</div>}
          {pk.phase === 'aim' && pk.next && (
            <div className="pk-banner small">
              {name(pk.next[1])} ({pk.next[0] === 0 ? home.short : away.short}) vai bater
            </div>
          )}
          {pk.phase === 'anim' && last && pk.left < PK_TIMES.anim - 1850 && <div className={`pk-result o${last[4]}`}>{OUT_LABEL[last[4]]}</div>}
        </div>
      </div>
      {pk.phase === 'order' && mySide != null && waitingMe && (
        <OrderPicker
          state={state}
          ids={pk.order[mySide]}
          keeper={pk.keepers[mySide]}
          secs={secs}
          onConfirm={(order) => client.match(f.id, { a: 'pkOrder', order })}
        />
      )}
      {pk.phase === 'order' && (mySide == null || !waitingMe) && (
        <div className="pk-hint">Os treinadores escolhem os batedores… {secs}s</div>
      )}
      {pk.phase === 'aim' && waitingMe && (
        <div className="pk-aim">
          <div className="pk-q">{kickingMe ? 'Onde bater?' : 'Para onde o goleiro pula?'}</div>
          <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
            {[0, 1, 2].map((d) => (
              <button key={d} className="btn lg" onClick={() => client.match(f.id, { a: 'pkAim', dir: d as PkDir })}>
                {d === 0 ? '◀ ' : d === 1 ? '▲ ' : ''}
                {kickingMe ? (d === 1 ? 'Meio' : d === 0 ? 'Canto esquerdo' : 'Canto direito') : d === 1 ? 'Ficar no meio' : `Pular à ${DIR_LABEL[d]}`}
                {d === 2 ? ' ▶' : ''}
              </button>
            ))}
          </div>
          <div className="pk-hint">
            {secs}s · setas do teclado também valem ·{' '}
            {kickingMe ? 'no meio quase nunca sai, mas o goleiro que fica parado defende' : 'acertar o lado dá boa chance de defesa'}
          </div>
        </div>
      )}
      {pk.phase === 'aim' && !waitingMe && <div className="pk-hint">{pk.wait[0] || pk.wait[1] ? `Aguardando a escolha… ${secs}s` : 'Lá vai…'}</div>}
      {pk.phase === 'anim' && last && (
        <div className="pk-hint">
          {name(last[1])}: bateu {SHOT_LABEL[last[2]]}, goleiro {last[3] === 1 ? 'ficou no meio' : `pulou à ${DIR_LABEL[last[3]]}`}
        </div>
      )}
    </div>
  );
}

/** Kicks so far as dots: green goal, red miss, empty still to come (five each, then sudden death). */
function PkBoard({ pk, names, kits }: { pk: PkFrame; names: [string, string]; kits: [[string, string], [string, string]] }) {
  return (
    <div className="pk-board">
      {[0, 1].map((s) => {
        const mine = pk.kicks.filter((k) => k[0] === s);
        const slots = Math.max(5, mine.length);
        return (
          <div key={s} className="pk-row">
            <span className="sb-chip" style={{ background: kits[s][0], borderColor: kits[s][1] }} />
            <span className="pk-team">{names[s]}</span>
            {Array.from({ length: slots }, (_, i) => {
              const k = mine[i];
              const showing = pk.phase === 'anim' && k && k === pk.kicks[pk.kicks.length - 1] && pk.left > PK_TIMES.anim - 1850;
              return <span key={i} className={`pk-dot ${k && !showing ? (k[4] === 0 ? 'goal' : 'miss') : ''}`} />;
            })}
            <b className="pk-score">{pk.kicks.filter((k) => k[0] === s && k[4] === 0 && !(pk.phase === 'anim' && k === pk.kicks[pk.kicks.length - 1] && pk.left > PK_TIMES.anim - 1850)).length}</b>
          </div>
        );
      })}
    </div>
  );
}

/** Pick five takers in order (click to add, click again to remove). */
function OrderPicker({ state, ids, keeper, secs, onConfirm }: { state: GameState; ids: number[]; keeper: number; secs: number; onConfirm: (order: number[]) => void }) {
  const [order, setOrder] = useState<number[]>([]);
  const toggle = (id: number) => setOrder((o) => (o.includes(id) ? o.filter((x) => x !== id) : o.length < 5 ? [...o, id] : o));
  return (
    <div className="pk-order">
      <div className="row">
        <b className="grow">Escolha seus 5 batedores, na ordem ({secs}s)</b>
        <button className="btn sm ghost" onClick={() => setOrder(ids.filter((id) => id !== keeper).slice(0, 5))}>
          Sugestão
        </button>
        <button className="btn primary" disabled={order.length < 5} onClick={() => onConfirm(order)}>
          Confirmar
        </button>
      </div>
      <div className="pk-takers">
        {ids.map((id) => {
          const p = state.players[id];
          const n = order.indexOf(id);
          return (
            <button key={id} className={`pk-taker ${n >= 0 ? 'on' : ''}`} onClick={() => toggle(id)}>
              <span className="pk-n">{n >= 0 ? n + 1 : ''}</span>
              <span className="grow">{p?.name ?? '?'}</span>
              {p?.traits.includes('cobrancas') && <span className="trait">Cobranças</span>}
              {id === keeper && <span className="pill">GOL</span>}
              <span className="num faint">{Math.round(p?.str ?? 0)}</span>
            </button>
          );
        })}
      </div>
      <div className="small faint">Se o tempo acabar, vale a sugestão. Na morte súbita seguem os demais, pela qualidade.</div>
    </div>
  );
}

// ---------- pixel art ----------

const W = 160;
const H = 96;
const GOAL = { l: 50, r: 110, top: 30, line: 58 };
const SPOT = { x: 80, y: 82 };
const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#a46a3f'];
const HAIR = ['#2b1b0e', '#4a3020', '#141414', '#7a4a22', '#d8b46a', '#1f1f1f'];
const GK_KIT: [string, string][] = [
  ['#f2c94c', '#1d1d1d'],
  ['#38d27a', '#1d1d1d'],
];
/** 3×5 digits for shirt numbers. */
const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];

function px(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) {
  g.fillStyle = c;
  g.fillRect(Math.round(x), Math.round(y), w, h);
}

function digits(g: CanvasRenderingContext2D, n: number, cx: number, y: number, c: string) {
  const s = String(n);
  const w = s.length * 4 - 1;
  [...s].forEach((d, i) => {
    const bits = DIGITS[Number(d)];
    for (let k = 0; k < 15; k++) if (bits[k] === '1') px(g, cx - w / 2 + i * 4 + (k % 3), y + Math.floor(k / 3), 1, 1, c);
  });
}

/** A player seen from behind: legs (walking frame), shorts, shirt with number, arms, head. */
function taker(g: CanvasRenderingContext2D, x: number, y: number, kit: [string, string], num: number, seed: number, frame: number, kicking: boolean) {
  const skin = SKIN[seed % SKIN.length];
  const hair = HAIR[(seed >> 2) % HAIR.length];
  const legA = frame % 2 === 0 ? 0 : 1;
  // legs and socks (y = feet)
  if (kicking) {
    px(g, x - 3, y - 5, 2, 5, skin);
    px(g, x + 1, y - 7, 2, 4, skin);
    px(g, x - 3, y - 2, 2, 2, kit[1]);
    px(g, x + 1, y - 4, 2, 2, kit[1]);
  } else {
    px(g, x - 3, y - 5 + legA, 2, 5 - legA, skin);
    px(g, x + 1, y - 4 - legA, 2, 4 + legA, skin);
    px(g, x - 3, y - 2, 2, 2, kit[1]);
    px(g, x + 1, y - 2, 2, 2, kit[1]);
  }
  px(g, x - 3, y - 8, 6, 3, kit[1]); // shorts
  px(g, x - 4, y - 15, 8, 7, kit[0]); // shirt
  digits(g, num, x, y - 14, kit[1]);
  px(g, x - 5, y - 14, 1, 4, skin); // arms
  px(g, x + 4, y - 14, 1, 4, skin);
  px(g, x - 2, y - 19, 4, 4, skin); // head
  px(g, x - 2, y - 19, 4, 2, hair);
}

/** The keeper facing us: idle, diving left/right (lying sideways) or jumping in the middle. */
function keeper(g: CanvasRenderingContext2D, x: number, kit: [string, string], pose: 'idle' | 'diveL' | 'diveR' | 'up', bob: number) {
  const y = GOAL.line;
  const skin = '#e0ac69';
  if (pose === 'diveL' || pose === 'diveR') {
    const d = pose === 'diveL' ? -1 : 1;
    const bx = x - 7;
    const by = y - 12;
    px(g, bx, by, 14, 5, kit[0]); // body lying across
    px(g, d < 0 ? bx - 4 : bx + 14, by, 4, 2, skin); // arms reaching
    px(g, d < 0 ? bx - 6 : bx + 18, by - 1, 2, 3, '#ffffff'); // gloves
    px(g, d < 0 ? bx + 14 : bx - 4, by + 2, 4, 3, kit[1]); // legs trailing
    px(g, d < 0 ? bx - 3 : bx + 14, by + 1, 3, 3, skin); // head
    return;
  }
  const lift = pose === 'up' ? 4 : bob;
  px(g, x - 3, y - 5 - lift, 2, 5, kit[1]);
  px(g, x + 1, y - 5 - lift, 2, 5, kit[1]);
  px(g, x - 4, y - 12 - lift, 8, 7, kit[0]);
  const armY = pose === 'up' ? y - 18 - lift : y - 12 - lift;
  px(g, x - 6, armY, 2, pose === 'up' ? 6 : 5, kit[0]);
  px(g, x + 4, armY, 2, pose === 'up' ? 6 : 5, kit[0]);
  px(g, x - 6, armY - 1, 2, 2, '#ffffff');
  px(g, x + 4, armY - 1, 2, 2, '#ffffff');
  px(g, x - 2, y - 16 - lift, 4, 4, skin);
}

function scene(g: CanvasRenderingContext2D, kits: [[string, string], [string, string]]) {
  // stands with a pixel crowd
  px(g, 0, 0, W, 24, '#141c28');
  let r = 7;
  const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff), r / 0x7fffffff);
  const crowd = [kits[0][0], kits[0][1], kits[1][0], '#d9d9d9', '#3a4a5c', '#6b4f3a'];
  for (let y = 2; y < 22; y += 2) for (let x = (y / 2) % 2; x < W; x += 2) if (rnd() < 0.75) px(g, x, y, 1, 1, crowd[Math.floor(rnd() * crowd.length)]);
  // ad boards
  for (let x = 0; x < W; x += 20) px(g, x, 23, 20, 3, (x / 20) % 2 ? kits[0][0] : kits[1][0]);
  // grass stripes
  for (let y = 26; y < H; y += 6) px(g, 0, y, W, 6, (y / 6) % 2 ? '#2f8a3a' : '#2a7d35');
  // net and goal frame
  for (let y = GOAL.top; y < GOAL.line; y += 3) px(g, GOAL.l, y, GOAL.r - GOAL.l, 1, 'rgba(255,255,255,0.18)');
  for (let x = GOAL.l; x < GOAL.r; x += 3) px(g, x, GOAL.top, 1, GOAL.line - GOAL.top, 'rgba(255,255,255,0.18)');
  px(g, 0, GOAL.line, W, 1, '#e8f0e8'); // goal line
  px(g, GOAL.l - 2, GOAL.top - 2, 2, GOAL.line - GOAL.top + 2, '#ffffff');
  px(g, GOAL.r, GOAL.top - 2, 2, GOAL.line - GOAL.top + 2, '#ffffff');
  px(g, GOAL.l - 2, GOAL.top - 2, GOAL.r - GOAL.l + 4, 2, '#ffffff');
  // box line and spot
  px(g, 20, 70, 120, 1, 'rgba(255,255,255,0.7)');
  px(g, SPOT.x - 1, SPOT.y + 1, 2, 1, '#ffffff');
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));

/** Where the ball ends up: in a corner (the top one when the keeper guessed right and still lost), the middle, or wide/over. */
function target(dir: PkDir, out: number, dive: PkDir): { x: number; y: number } {
  if (out === 2) return dir === 0 ? { x: GOAL.l - 9, y: 38 } : dir === 2 ? { x: GOAL.r + 9, y: 38 } : { x: 84, y: GOAL.top - 9 };
  const high = out === 0 && dive === dir;
  if (dir === 1) return high ? { x: 81, y: GOAL.top + 3 } : { x: 81, y: 44 };
  const y = high ? GOAL.top + 4 : out === 1 ? 46 : 52;
  return dir === 0 ? { x: GOAL.l + 5, y } : { x: GOAL.r - 5, y };
}

/** Canvas drawn every animation frame from the latest shootout frame. */
function PkCanvas({ fixtureId, kits, numberOf }: { fixtureId: number; kits: [[string, string], [string, string]]; numberOf: (id: number) => number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const client = useApp((s) => s.client)!;
  const anim = useRef<{ n: number; start: number } | null>(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cv = ref.current;
      const fr = client.frames.get(fixtureId)?.cur;
      const pk = fr?.pk;
      if (!cv || !pk) return;
      const g = cv.getContext('2d')!;
      const now = performance.now();
      scene(g, kits);
      const next = pk.next;
      // start the local clock of a kick when it first appears
      if (pk.phase === 'anim') {
        if (!anim.current || anim.current.n !== pk.kicks.length) anim.current = { n: pk.kicks.length, start: now - (PK_TIMES.anim - pk.left) };
      } else anim.current = null;
      const t = anim.current ? now - anim.current.start : 0;
      const kick = pk.phase === 'anim' ? pk.kicks[pk.kicks.length - 1] : null;
      const side = (next?.[0] ?? 0) as 0 | 1;
      const gkKit = GK_KIT[1 - side];
      const bob = Math.round(Math.sin(now / 180));
      // keeper
      let kx = 80;
      let pose: 'idle' | 'diveL' | 'diveR' | 'up' = 'idle';
      if (kick && t > 1300) {
        const dv = kick[3];
        kx = lerp(80, dv === 0 ? 62 : dv === 2 ? 98 : 80, (t - 1300) / 300);
        pose = dv === 0 ? 'diveL' : dv === 2 ? 'diveR' : 'up';
      } else kx = 80 + (pk.phase === 'aim' ? Math.round(Math.sin(now / 260) * 2) : 0);
      keeper(g, kx, gkKit, pose, pose === 'idle' ? Math.max(0, bob) : 0);
      // ball
      let bx = SPOT.x;
      let by = SPOT.y;
      let bs = 3;
      if (kick && t > 1350) {
        const tg = target(kick[2], kick[4], kick[3]);
        const k = (t - 1350) / 400;
        if (kick[4] === 1 && k >= 1) {
          // saved: knocked away
          const k2 = (t - 1750) / 350;
          bx = lerp(tg.x, tg.x + (kick[2] === 2 ? 14 : kick[2] === 0 ? -14 : 6), k2);
          by = lerp(tg.y, tg.y + 18, k2) - Math.sin(Math.min(1, k2) * Math.PI) * 8;
        } else {
          bx = lerp(SPOT.x, tg.x, k);
          by = lerp(SPOT.y, tg.y, k) - Math.sin(Math.min(1, k) * Math.PI) * 6;
        }
        bs = k < 0.5 ? 3 : 2;
      }
      // taker (walks up from behind, strikes)
      if (next || kick) {
        const pid = kick ? kick[1] : next![1];
        const kit = kits[kick ? kick[0] : side];
        let x = 74;
        let y = 92;
        let frame = 0;
        let kicking = false;
        if (pk.phase === 'anim') {
          const w = Math.min(1, t / 1200);
          x = lerp(62, 77, w);
          y = lerp(100, 88, w);
          frame = w < 1 ? Math.floor(t / 140) : 0;
          kicking = t >= 1200 && t < 1700;
        } else if (pk.phase === 'order') {
          x = 66;
          y = 100;
        }
        if (by < y - 6) {
          ball(g, bx, by, bs);
          taker(g, x, y, kit, numberOf(pid), pid, frame, kicking);
        } else {
          taker(g, x, y, kit, numberOf(pid), pid, frame, kicking);
          ball(g, bx, by, bs);
        }
      } else ball(g, bx, by, bs);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [client, fixtureId, kits, numberOf]);
  return <canvas ref={ref} width={W} height={H} className="pk-canvas" />;
}

function ball(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  px(g, x - s / 2 + 1, y + s / 2, s, 1, 'rgba(0,0,0,0.35)');
  px(g, x - s / 2, y - s / 2, s, s, '#ffffff');
  px(g, x, y, 1, 1, '#333333');
}
