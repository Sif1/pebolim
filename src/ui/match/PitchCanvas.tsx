import { useEffect, useRef } from 'react';
import type { LiveFrame } from '../../engine/match/live';
import { tr } from '../../i18n';
import { useApp } from '../../store';
import { readable } from '../common';

const W = 105;
const H = 68;
/** margin around the pitch (room for the goals), in metres */
const M = 3;
const TW = W + 2 * M;
const TH = H + 2 * M;

interface Props {
  fixtureId: number;
  homeColors: [string, string];
  awayColors: [string, string];
  /** player id -> shirt number */
  numbers: Map<number, number>;
  /** player id -> short name (shown under the player on the ball) */
  names?: Map<number, string>;
  big?: boolean;
  /** player ids of my side, to highlight */
  mine?: Set<number>;
}

/**
 * Top-down 2D view in the style of the classic manager games: flat pitch, numbered dots,
 * the ball carrier's name, and a flash on goals. Interpolates between the last two host frames.
 */
export function PitchCanvas({ fixtureId, homeColors, awayColors, numbers, names, big, mine }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    let lastGoals = -1;
    let flashUntil = 0;
    let flashSide: 0 | 1 = 0;
    const homeText = readable(homeColors[0], homeColors[1]);
    const awayText = readable(awayColors[0], awayColors[1]);
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const client = useApp.getState().client;
      const buf = client?.frames.get(fixtureId);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = canvas.clientWidth;
      const ch = Math.round((cw * TH) / TW);
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
      }
      const s = (cw * dpr) / TW;
      ctx.setTransform(s, 0, 0, s, M * s, M * s);
      drawField(ctx);
      if (!buf) return;
      const now = performance.now();
      // draw a little behind the newest frame and blend the two frames around that moment, so the players glide
      // even when frames arrive unevenly (a frame late by a few ms no longer makes everyone stop)
      const hist = buf.hist.length ? buf.hist : [{ f: buf.cur, at: buf.at }];
      const gaps = hist.slice(1).map((h, i) => h.at - hist[i].at);
      const gap = gaps.length ? gaps.reduce((x, y) => x + y, 0) / gaps.length : 100;
      const renderAt = now - Math.min(400, Math.max(120, gap * 1.6));
      let ia = 0;
      while (ia < hist.length - 1 && hist[ia + 1].at <= renderAt) ia++;
      const A = hist[ia];
      const B = hist[Math.min(hist.length - 1, ia + 1)];
      const cur = B.f;
      const prev = A === B ? null : A.f;
      // a highlight starting: players appear where they are, without sliding over from the idle picture
      const k = prev && !cur.paused && (prev.hl || !cur.hl) ? Math.min(1, Math.max(0, (renderAt - A.at) / Math.max(1, B.at - A.at))) : 1;
      const lerp = (a: number, b: number) => a + (b - a) * k;
      const pos = (f: LiveFrame, i: number) => [f.p[i * 2] / 10, f.p[i * 2 + 1] / 10];

      const goals = cur.sc[0] + cur.sc[1];
      if (lastGoals >= 0 && goals > lastGoals) {
        flashUntil = now + 2600;
        flashSide = prev && cur.sc[1] > prev.sc[1] ? 1 : 0;
      }
      lastGoals = goals;

      // between highlights the pitch sits idle (Championship Manager style): the minute and the latest commentary
      if (cur.hl === false && !cur.pk) {
        idle(ctx, cur, client?.events.get(fixtureId) ?? [], big, now < flashUntil);
        if (now >= flashUntil) return;
      }
      const r = big ? 1.55 : 1.9;
      const showNums = s * r > 5;
      let carrierAt: [number, number] | null = null;
      for (let i = 0; i < 22 && cur.hl !== false; i++) {
        const id = cur.ids[i];
        if (!id || cur.p[i * 2] < 0) continue;
        let [x, y] = pos(cur, i);
        if (prev) {
          const j = prev.ids.indexOf(id);
          if (j >= 0 && prev.p[j * 2] >= 0) {
            const [px, py] = pos(prev, j);
            x = lerp(px, x);
            y = lerp(py, y);
          }
        }
        const home = i < 11;
        const colors = home ? homeColors : awayColors;
        // shadow
        ctx.beginPath();
        ctx.arc(x + 0.25, y + 0.35, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = colors[0];
        ctx.fill();
        ctx.lineWidth = mine?.has(id) ? 0.5 : 0.3;
        ctx.strokeStyle = mine?.has(id) ? '#fde047' : colors[1];
        ctx.stroke();
        if (showNums) {
          ctx.fillStyle = home ? homeText : awayText;
          ctx.font = `bold ${r * 1.05}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(numbers.get(id) ?? ''), x, y + 0.08);
        }
        if (id === cur.car) carrierAt = [x, y];
      }
      // ball (not while the pitch is idle)
      if (cur.hl !== false) {
        let bx = cur.b[0] / 10;
        let by = cur.b[1] / 10;
        let bz = cur.b[2] / 10;
        if (prev) {
          bx = lerp(prev.b[0] / 10, bx);
          by = lerp(prev.b[1] / 10, by);
          bz = lerp(prev.b[2] / 10, bz);
        }
        ctx.beginPath();
        ctx.arc(bx + bz * 0.18, by + bz * 0.28, 0.6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(bx, by - bz * 0.35, 0.7 + bz * 0.05, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 0.18;
        ctx.strokeStyle = '#111';
        ctx.stroke();
        // name of the player on the ball
        if (big && names && carrierAt && cur.car) {
          const nm = names.get(cur.car);
          if (nm) {
            ctx.font = `600 2.1px system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            const tw = ctx.measureText(nm).width + 1.2;
            const ty = Math.min(H - 1, carrierAt[1] + r + 0.5);
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(carrierAt[0] - tw / 2, ty - 0.2, tw, 2.7);
            ctx.fillStyle = '#fff';
            ctx.fillText(nm, carrierAt[0], ty);
          }
        }
      }
      if (now < flashUntil) {
        const a = Math.min(1, (flashUntil - now) / 600);
        ctx.fillStyle = `rgba(0,0,0,${0.35 * a})`;
        ctx.fillRect(-M, -M, TW, TH);
        ctx.font = `900 ${big ? 11 : 14}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = `rgba(0,0,0,${a})`;
        ctx.strokeText(tr('GOL!'), W / 2, H / 2);
        ctx.fillStyle = flashSide === 0 ? homeColors[0] : awayColors[0];
        ctx.globalAlpha = a;
        ctx.fillText(tr('GOL!'), W / 2, H / 2);
        ctx.globalAlpha = 1;
      } else if (cur.paused && cur.hl !== false) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(-M, -M, TW, TH);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 7px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tr('PAUSADO'), W / 2, H / 2);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [fixtureId, homeColors, awayColors, numbers, names, big, mine]);

  return <canvas ref={ref} className={`pitch ${big ? 'big' : ''}`} />;
}

/** The idle pitch between highlights: dimmed, with the clock and the latest line of commentary. */
function idle(ctx: CanvasRenderingContext2D, f: LiveFrame, events: LiveFrame['ev'], big: boolean | undefined, goalFlash: boolean) {
  ctx.fillStyle = 'rgba(4, 12, 8, 0.42)';
  ctx.fillRect(-M, -M, TW, TH);
  if (goalFlash) return;
  const m = Math.floor(f.t / 60);
  const minute = f.ended ? tr('FIM') : f.half === 1 && m >= 45 ? `45+${m - 44}'` : f.half === 2 && m >= 90 ? `90+${m - 89}'` : `${m + 1}'`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = `800 ${big ? 9 : 12}px system-ui, sans-serif`;
  ctx.fillText(f.paused ? tr('PAUSADO') : minute, W / 2, H / 2 - (big ? 3 : 2));
  const last = [...events].reverse().find((e) => e.kind !== 'tactic');
  ctx.font = `600 ${big ? 2.6 : 3.6}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  const text = tr(f.ended ? 'Fim de jogo' : last && f.t - last.t < 240 ? last.text : 'sem lances de perigo…');
  ctx.fillText(text.length > 46 ? `${text.slice(0, 45)}…` : text, W / 2, H / 2 + (big ? 5 : 6));
}

function drawField(ctx: CanvasRenderingContext2D) {
  // grass with mowing stripes, including the margin
  ctx.fillStyle = '#2a7a35';
  ctx.fillRect(-M, -M, TW, TH);
  for (let i = 0; i < 12; i++) {
    if (i % 2) continue;
    ctx.fillStyle = '#2f8a3b';
    ctx.fillRect((i * W) / 12, 0, W / 12, H);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 0.25;
  ctx.strokeRect(0, 0, W, H);
  ctx.beginPath();
  ctx.moveTo(W / 2, 0);
  ctx.lineTo(W / 2, H);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 9.15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 0.35, 0, Math.PI * 2);
  ctx.fill();
  for (const side of [0, 1]) {
    const x0 = side === 0 ? 0 : W;
    const dir = side === 0 ? 1 : -1;
    // boxes
    ctx.strokeRect(Math.min(x0, x0 + dir * 16.5), H / 2 - 20.16, 16.5, 40.32);
    ctx.strokeRect(Math.min(x0, x0 + dir * 5.5), H / 2 - 9.16, 5.5, 18.32);
    // penalty spot and arc
    const px = x0 + dir * 11;
    ctx.beginPath();
    ctx.arc(px, H / 2, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    const a = Math.acos(5.5 / 9.15);
    if (side === 0) ctx.arc(px, H / 2, 9.15, -a, a);
    else ctx.arc(px, H / 2, 9.15, Math.PI - a, Math.PI + a);
    ctx.stroke();
    // corner arcs
    for (const cy of [0, H]) {
      ctx.beginPath();
      const start = side === 0 ? (cy === 0 ? 0 : -Math.PI / 2) : cy === 0 ? Math.PI / 2 : Math.PI;
      ctx.arc(x0, cy, 1, start, start + Math.PI / 2);
      ctx.stroke();
    }
    // goal and net
    const gx = side === 0 ? -2 : W;
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(gx, H / 2 - 3.66, 2, 7.32);
    ctx.strokeRect(gx, H / 2 - 3.66, 2, 7.32);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
  }
}
