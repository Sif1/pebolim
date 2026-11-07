import { useState, type ReactNode } from 'react';
import type { Club, GameState, Pos } from '../engine/types';
import { formatMoney, kk, parseMoney } from '../engine/util';

export { kk, parseMoney };
import { useApp } from '../store';

/** Crest images that failed to load (offline, moved file): draw the shield instead. */
const brokenCrests = new Set<string>();

export function ClubBadge({ club, size = 28 }: { club: (Pick<Club, 'short' | 'colors'> & { crest?: string }) | null | undefined; size?: number }) {
  const [, setFailed] = useState(0);
  if (!club) return null;
  if (club.crest && !brokenCrests.has(club.crest)) {
    return (
      <img
        className="crest"
        src={club.crest}
        alt={club.short}
        width={size}
        height={size}
        loading="lazy"
        draggable={false}
        onError={() => {
          brokenCrests.add(club.crest!);
          setFailed((n) => n + 1);
        }}
      />
    );
  }
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

/**
 * Chrome colours for a club: the main colour (or the second one, for white/very light clubs)
 * darkened until white text reads well on it.
 */
export function clubTheme(colors: [string, string]): { dark: string; deep: string } {
  const lum = (c: number[]) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
  let base: number[];
  try {
    const a = rgb(colors[0]);
    const b = rgb(colors[1]);
    base = lum(a) > 0.72 && lum(b) < 0.6 ? b : a;
  } catch {
    base = [29, 79, 138];
  }
  const night = [8, 17, 29];
  const mix = (w: number) => base.map((v, i) => Math.round(v * w + night[i] * (1 - w)));
  let w = 0.75;
  while (w > 0.2 && lum(mix(w)) > 0.3) w -= 0.05;
  const hex = (c: number[]) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  return { dark: hex(mix(w)), deep: hex(mix(w * 0.45)) };
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
/** A team colour that shows on the dark interface (the second colour, or grey, if the first is too dark). */
export function visibleOnDark(colors: [string, string]): string {
  const lum = (hex: string) => {
    try {
      const v = rgb(hex);
      return (0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2]) / 255;
    } catch {
      return 1;
    }
  };
  if (lum(colors[0]) >= 0.22) return colors[0];
  if (lum(colors[1]) >= 0.22) return colors[1];
  return '#9fb0c4';
}

/** Two colours for home/away that show on the dark interface and can't be mixed up. */
export function contrastPair(home: [string, string], away: [string, string]): [string, string] {
  const h = visibleOnDark(home);
  const lumOk = (c: string) => {
    try {
      const v = rgb(c);
      return (0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2]) / 255 >= 0.22;
    } catch {
      return false;
    }
  };
  for (const c of [away[0], away[1], '#f2f2f2', '#4cc3ff', '#f5c518']) if (lumOk(c) && colorDist(c, h) > 120) return [h, c];
  return [h, '#f2f2f2'];
}

const SUFFIX = new Set(['Júnior', 'Junior', 'Jr.', 'Filho', 'Neto', 'Sobrinho']);

/**
 * Name for tight spots (the pitch, the tactics board): the known name when it is short
 * ("Bruno Henrique", "Flaco López"), otherwise the last word ("Pereira"), keeping suffixes ("Vinícius Jr.").
 */
export function shortName(name: string): string {
  const w = name.trim().split(/\s+/);
  if (w.length <= 1 || name.length <= 14) return name;
  const last = w[w.length - 1];
  if (SUFFIX.has(last)) return `${w[w.length - 2]} ${last === 'Júnior' || last === 'Junior' ? 'Jr.' : last}`;
  // particles belong to the surname: "De la Cruz", "Di María", "van Dijk"
  const parts = [last];
  for (let i = w.length - 2; i > 0 && /^(de|da|do|dos|das|del|la|di|van|von|der|den|le|ter|mac|mc)$/i.test(w[i]); i--) parts.unshift(w[i]);
  return parts.join(' ');
}

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

/** Potential as 0-5 stars. */
export function Stars({ n, title }: { n: number; title?: string }) {
  const k = Math.max(0, Math.min(5, Math.round(n ?? 0)));
  return (
    <span className="stars" title={title ?? `Potencial: ${k} de 5 estrelas`}>
      <span className="on">{'★'.repeat(k)}</span>
      <span className="off">{'★'.repeat(5 - k)}</span>
    </span>
  );
}

/** Energy (fitness) color: green above 80%, yellow 60-80%, red below 60%. */
export function energyColor(v: number): string {
  return v > 80 ? 'var(--good)' : v >= 60 ? 'var(--warn)' : 'var(--bad)';
}

/** Energy as a bar plus its number. */
export function Energy({ v, w = 56 }: { v: number; w?: number }) {
  const r = Math.max(0, Math.min(100, Math.round(v)));
  const c = energyColor(r);
  return (
    <span className="energy" title={`Energia ${r}%`}>
      <span className="bar" style={{ width: w, minWidth: w }}>
        <div style={{ width: `${r}%`, background: c }} />
      </span>
      <span className="num" style={{ color: c }}>
        {r}%
      </span>
    </span>
  );
}

export function ratingColor(v: number): string {
  return v >= 8 ? '#a78bfa' : v >= 7 ? '#22c55e' : v >= 6.5 ? '#84cc16' : v >= 6 ? '#eab308' : v >= 5.5 ? '#f97316' : '#ef4444';
}

/** Match rating badge (e.g. 7.4); a dash when the player has no rating yet. */
export function Rating({ v }: { v: number | null | undefined }) {
  if (v == null) return <span className="rating faint">–</span>;
  const c = ratingColor(v);
  return (
    <span className="rating" style={{ background: c + '26', color: c }} title="Nota na partida">
      {v.toFixed(1)}
    </span>
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
  const th = (key: string, label: ReactNode, cls = '') => {
    // the arrow goes on the inner side, so a right-aligned label still lines up with its numbers
    const arrow = sort.key === key ? <span className="sort-arrow">{sort.dir === 1 ? '▲' : '▼'}</span> : null;
    return (
      <th
        className={`sortable ${cls}`}
        title="Clique para ordenar"
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : -1 }))}
      >
        {cls.includes('right') && arrow}
        {label}
        {!cls.includes('right') && arrow}
      </th>
    );
  };
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
  USA: 'Estados Unidos',
  NOR: 'Noruega',
  SWE: 'Suécia',
  MAR: 'Marrocos',
  NGA: 'Nigéria',
  JPN: 'Japão',
  SEN: 'Senegal',
  POL: 'Polônia',
  CIV: 'Costa do Marfim',
  GHA: 'Gana',
  ALG: 'Argélia',
  SVK: 'Eslováquia',
  IRL: 'Irlanda',
  WAL: 'País de Gales',
  CMR: 'Camarões',
  ROU: 'Romênia',
  KOS: 'Kosovo',
  KOR: 'Coreia do Sul',
  ALB: 'Albânia',
  MEX: 'México',
  HUN: 'Hungria',
  GEO: 'Geórgia',
  CAN: 'Canadá',
  BIH: 'Bósnia',
  ANG: 'Angola',
  SVN: 'Eslovênia',
  MLI: 'Mali',
  AUS: 'Austrália',
  NIR: 'Irlanda do Norte',
  MNE: 'Montenegro',
  GUI: 'Guiné',
  EGY: 'Egito',
  COD: 'RD Congo',
  RUS: 'Rússia',
  ISL: 'Islândia',
  FIN: 'Finlândia',
  BFA: 'Burkina Faso',
};

/** FIFA code → ISO 3166 code used by the flag images (UK nations have their own). */
const ISO2: Record<string, string> = {
  BRA: 'br', ARG: 'ar', URU: 'uy', ENG: 'gb-eng', SCO: 'gb-sct', WAL: 'gb-wls', NIR: 'gb-nir', ESP: 'es', ITA: 'it', GER: 'de',
  FRA: 'fr', POR: 'pt', NED: 'nl', BEL: 'be', TUR: 'tr', AUT: 'at', SUI: 'ch', GRE: 'gr', CZE: 'cz', DEN: 'dk', UKR: 'ua',
  CRO: 'hr', SRB: 'rs', CHI: 'cl', COL: 'co', PAR: 'py', ECU: 'ec', PER: 'pe', BOL: 'bo', VEN: 've', USA: 'us', NOR: 'no',
  SWE: 'se', MAR: 'ma', NGA: 'ng', JPN: 'jp', SEN: 'sn', POL: 'pl', CIV: 'ci', GHA: 'gh', ALG: 'dz', SVK: 'sk', IRL: 'ie',
  CMR: 'cm', ROU: 'ro', KOS: 'xk', KOR: 'kr', ALB: 'al', MEX: 'mx', HUN: 'hu', GEO: 'ge', CAN: 'ca', BIH: 'ba', ANG: 'ao',
  SVN: 'si', MLI: 'ml', AUS: 'au', MNE: 'me', GUI: 'gn', EGY: 'eg', COD: 'cd', RUS: 'ru', ISL: 'is', FIN: 'fi', BFA: 'bf',
  ZIM: 'zw', ZAM: 'zm', UZB: 'uz', TUN: 'tn', TOG: 'tg', RSA: 'za', PAN: 'pa', NZL: 'nz', MOZ: 'mz', MKD: 'mk', LUX: 'lu',
  JOR: 'jo', ISR: 'il', IDN: 'id', HAI: 'ht', GNQ: 'gq', GNB: 'gw', GAM: 'gm', GAB: 'ga', CPV: 'cv', CGO: 'cg', CAF: 'cf',
  BUL: 'bg', BEN: 'bj', BDI: 'bi', ARM: 'am', CRC: 'cr', HON: 'hn', JAM: 'jm', IRN: 'ir', KSA: 'sa', QAT: 'qa', CHN: 'cn',
  LTU: 'lt', LVA: 'lv', EST: 'ee', BLR: 'by', CYP: 'cy', MLT: 'mt', SLV: 'sv', GUA: 'gt', CUB: 'cu', DOM: 'do', SLE: 'sl',
  LBR: 'lr', KEN: 'ke', TAN: 'tz', UGA: 'ug', ETH: 'et', SUD: 'sd', LBY: 'ly', MTN: 'mr', NIG: 'ne', SUR: 'sr', GUY: 'gy',
};

const brokenFlags = new Set<string>();

/** Country flag next to a nationality (falls back to the code when the image can't load). */
export function Flag({ nat, label = false }: { nat: string; label?: boolean }) {
  const [, setFailed] = useState(0);
  const iso = ISO2[nat];
  const name = COUNTRY_NAME[nat] ?? nat;
  const img =
    iso && !brokenFlags.has(iso) ? (
      <img
        className="flag"
        src={`https://flagcdn.com/w40/${iso}.png`}
        alt={nat}
        title={name}
        loading="lazy"
        onError={() => {
          brokenFlags.add(iso);
          setFailed((n) => n + 1);
        }}
      />
    ) : (
      <span className="flag-code" title={name}>
        {nat}
      </span>
    );
  return (
    <span className="nat">
      {img}
      {label && <span className="small muted">{name}</span>}
    </span>
  );
}

// ---------- money fields: "2,5kk" for 2.5 million, "300k" for 300 thousand (Brasfoot style) ----------

/**
 * Money input that shows and accepts the short form ("2,5kk"). Arrow keys step up and down; the value is sent
 * as you type whenever it reads as money, and the text tidies itself when you leave the field.
 */
export function MoneyField({
  value,
  onChange,
  step,
  width = 110,
  placeholder,
  allowZero = true,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  width?: number;
  placeholder?: string;
  allowZero?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (value || allowZero ? kk(value) : '');
  const stepOf = (v: number) => step ?? (v >= 10e6 ? 500_000 : v >= 1e6 ? 100_000 : v >= 100_000 ? 10_000 : 1_000);
  const bad = text != null && text.trim() !== '' && parseMoney(text) == null;
  return (
    <span className="money-field" style={{ width }}>
      <span className="money-cur">US$</span>
      <input
        type="text"
        inputMode="decimal"
        className={bad ? 'bad' : ''}
        value={shown}
        placeholder={placeholder}
        title="Ex.: 2,5kk = US$ 2,5 milhões · 300k = US$ 300 mil · setas ↑↓ mudam o valor"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          setText(e.target.value);
          const v = parseMoney(e.target.value);
          if (v != null) onChange(Math.max(0, v));
          else if (e.target.value.trim() === '' && !allowZero) onChange(0);
        }}
        onBlur={() => setText(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setText(null);
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          const base = parseMoney(text ?? '') ?? value;
          const next = Math.max(0, base + (e.key === 'ArrowUp' ? 1 : -1) * stepOf(base));
          setText(null);
          onChange(next);
        }}
      />
    </span>
  );
}
