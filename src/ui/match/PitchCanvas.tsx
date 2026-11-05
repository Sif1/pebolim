import { useEffect, useRef } from 'react';
import type { LiveFrame } from '../../engine/match/live';
import { useApp } from '../../store';
import { readable } from '../common';

const W = 105;
const H = 68;

interface Props {
  fixtureId: number;
  homeColors: [string, string];
  awayColors: [string, string];
  /** player id -> shirt number */
  numbers: Map<number, number>;
  big?: boolean;
  /** player ids of my side, to highlight */
  mine?: Set<number>;
}

/** Draws a live match from host frames, interpolating between the last two frames. */
export function PitchCanvas({ fixtureId, homeColors, awayColors, numbers, big, mine }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const client = useApp.getState().client;
      const buf = client?.frames.get(fixtureId);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = canvas.clientWidth;
      const ch = Math.round((cw * H) / W);
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
      }
      const s = (cw * dpr) / W;
      ctx.setTransform(s, 0, 0, s, 0, 0);
      drawField(ctx);
      if (!buf) return;
      const cur = buf.cur;
      const prev = buf.prev;
      const span = Math.max(50, buf.at - buf.prevAt);
      const k = prev && !cur.paused ? Math.min(1, (performance.now() - buf.at) / span + 0) : 1;
      // render slightly behind: interpolate prev -> cur
      const lerp = (a: number, b: number) => a + (b - a) * k;
      const pos = (f: LiveFrame, i: number) => [f.p[i * 2] / 10, f.p[i * 2 + 1] / 10];
      const r = big ? 1.9 : 1.6;
      for (let i = 0; i < 22; i++) {
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
        const colors = i < 11 ? homeColors : awayColors;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = colors[0];
        ctx.fill();
        ctx.lineWidth = mine?.has(id) ? 0.55 : 0.35;
        ctx.strokeStyle = mine?.has(id) ? '#fde047' : colors[1];
        ctx.stroke();
        if (big || s > 5) {
          ctx.fillStyle = readable(colors[0], colors[1]);
          ctx.font = `bold ${r * 1.05}px system-ui`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(numbers.get(id) ?? ''), x, y + 0.1);
        }
      }
      // ball
      let bx = cur.b[0] / 10;
      let by = cur.b[1] / 10;
      let bz = cur.b[2] / 10;
      if (prev) {
        bx = lerp(prev.b[0] / 10, bx);
        by = lerp(prev.b[1] / 10, by);
        bz = lerp(prev.b[2] / 10, bz);
      }
      ctx.beginPath();
      ctx.arc(bx + bz * 0.15, by + bz * 0.25, 0.7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(bx, by - bz * 0.35, 0.75 + bz * 0.06, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 0.2;
      ctx.strokeStyle = '#111';
      ctx.stroke();
      if (cur.paused) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 7px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('PAUSADO', W / 2, H / 2 + 2);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [fixtureId, homeColors, awayColors, numbers, big, mine]);

  return <canvas ref={ref} className="pitch" />;
}

function drawField(ctx: CanvasRenderingContext2D) {
  // stripes
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = i % 2 ? '#15803d' : '#166534';
    ctx.fillRect((i * W) / 10, 0, W / 10, H);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 0.3;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  ctx.beginPath();
  ctx.moveTo(W / 2, 0.5);
  ctx.lineTo(W / 2, H - 0.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 9.15, 0, Math.PI * 2);
  ctx.stroke();
  for (const side of [0, 1]) {
    const x0 = side === 0 ? 0.5 : W - 0.5;
    const dir = side === 0 ? 1 : -1;
    ctx.strokeRect(Math.min(x0, x0 + dir * 16.5), H / 2 - 20.16, 16.5, 40.32);
    ctx.strokeRect(Math.min(x0, x0 + dir * 5.5), H / 2 - 9.16, 5.5, 18.32);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(side === 0 ? -0.5 : W - 1.5, H / 2 - 3.66, 2, 7.32);
  }
}
