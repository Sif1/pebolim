import { useState, type ReactNode } from 'react';
import type { Club, GameState, Pos } from '../engine/types';
import { formatMoney } from '../engine/util';
import { useApp } from '../store';

export function ClubBadge({ club, size = 28 }: { club: Pick<Club, 'short' | 'colors'> | null | undefined; size?: number }) {
  if (!club) return null;
  return (
    <span
      className="badge"
      style={{
        width: size,
        height: size,
        background: club.colors[0],
        borderColor: club.colors[1],
        color: readable(club.colors[0], club.colors[1]),
        fontSize: Math.max(8, size * 0.32),
      }}
    >
      {club.short.slice(0, 3)}
    </span>
  );
}

/** Away kit for a match: switch to the alternate colors when both teams look alike. */
export function awayKit(home: [string, string], away: [string, string]): [string, string] {
  if (colorDist(home[0], away[0]) > 110) return away;
  if (colorDist(home[0], away[1]) > 110) return [away[1], away[0]];
  return colorDist(home[0], '#1d4ed8') > 110 ? ['#1d4ed8', '#ffffff'] : ['#f97316', '#111111'];
}

function rgb(hex: string): number[] {
  const h = hex.replace('#', '');
  return h.length === 3 ? h.split('').map((c) => parseInt(c + c, 16)) : [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function colorDist(a: string, b: string): number {
  try {
    const x = rgb(a);
    const y = rgb(b);
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
  } catch {
    return 999;
  }
}

/** Pick the second color unless it has poor contrast with the background, else black/white. */
export function readable(bg: string, fg: string): string {
  const lum = (hex: string) => {
    const h = hex.replace('#', '');
    const v = h.length === 3 ? h.split('').map((c) => parseInt(c + c, 16)) : [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return (0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2]) / 255;
  };
  try {
    if (Math.abs(lum(bg) - lum(fg)) > 0.35) return fg;
    return lum(bg) > 0.55 ? '#000000' : '#ffffff';
  } catch {
    return '#ffffff';
  }
}

export function ClubName({ id, state, badge = true }: { id: number; state: GameState; badge?: boolean }) {
  const club = state.clubs[id];
  const openClub = useApp((s) => s.openClub);
  if (!club) return <span>—</span>;
  return (
    <span className="row" style={{ gap: 6, flexWrap: 'nowrap', cursor: 'pointer' }} onClick={(e) => (e.stopPropagation(), openClub(id))}>
      {badge && <ClubBadge club={club} size={20} />}
      <span className="nowrap">{club.name}</span>
    </span>
  );
}

export function PosTag({ pos }: { pos: Pos }) {
  return <span className={`pos pos-${pos}`}>{pos}</span>;
}

export function Str({ v }: { v: number }) {
  const r = Math.round(v);
  const color = r >= 85 ? '#a78bfa' : r >= 78 ? '#22c55e' : r >= 70 ? '#84cc16' : r >= 62 ? '#eab308' : r >= 54 ? '#f97316' : '#ef4444';
  return (
    <span className="str" style={{ background: color + '22', color }}>
      {r}
    </span>
  );
}

export const Money = ({ v }: { v: number }) => <span className={`num nowrap ${v < 0 ? 'bad' : ''}`}>{formatMoney(v)}</span>;

export function FormDots({ form }: { form: string }) {
  return (
    <span>
      {form.split('').map((c, i) => (
        <span key={i} className={`form-dot form-${c}`}>
          {c}
        </span>
      ))}
    </span>
  );
}

export function Bar({ v, max = 100, color }: { v: number; max?: number; color?: string }) {
  const pct = Math.max(0, Math.min(100, (v / max) * 100));
  const c = color ?? (pct > 70 ? 'var(--good)' : pct > 45 ? 'var(--warn)' : 'var(--bad)');
  return (
    <div className="bar">
      <div style={{ width: `${pct}%`, background: c }} />
    </div>
  );
}

export function Modal({ onClose, children, wide }: { onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { width: 'min(920px, 100%)' } : undefined}>
        {children}
      </div>
    </div>
  );
}

export function useSort<T>(rows: T[], initial: { key: string; dir: 1 | -1 }, getters: Record<string, (r: T) => number | string>) {
  const [sort, setSort] = useState(initial);
  const g = getters[sort.key];
  const sorted = g
    ? [...rows].sort((a, b) => {
        const va = g(a);
        const vb = g(b);
        return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))) * sort.dir;
      })
    : rows;
  const th = (key: string, label: ReactNode, cls = '') => (
    <th
      className={`sortable ${cls}`}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : -1 }))}
    >
      {label}
      {sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );
  return { sorted, th };
}

export function compLabel(state: GameState, id: string): string {
  return state.comps[id]?.cfg.short ?? state.config.find((c) => c.id === id)?.short ?? id;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="muted" style={{ padding: 18, textAlign: 'center' }}>{children}</div>;
}

export const COUNTRY_NAME: Record<string, string> = {
  BRA: 'Brasil',
  ARG: 'Argentina',
  URU: 'Uruguai',
  ENG: 'Inglaterra',
  ESP: 'Espanha',
  ITA: 'Itália',
  GER: 'Alemanha',
  FRA: 'França',
  POR: 'Portugal',
  NED: 'Holanda',
  BEL: 'Bélgica',
  SCO: 'Escócia',
  TUR: 'Turquia',
  AUT: 'Áustria',
  SUI: 'Suíça',
  GRE: 'Grécia',
  CZE: 'Rep. Tcheca',
  DEN: 'Dinamarca',
  UKR: 'Ucrânia',
  CRO: 'Croácia',
  SRB: 'Sérvia',
  CHI: 'Chile',
  COL: 'Colômbia',
  PAR: 'Paraguai',
  ECU: 'Equador',
  PER: 'Peru',
  BOL: 'Bolívia',
  VEN: 'Venezuela',
};
