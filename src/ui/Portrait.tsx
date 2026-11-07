// Pixel-art portraits: every player gets a face drawn from his id (always the same one), with skin and hair
// that fit his nationality, grey hair or a receding line for veterans, and his club's shirt and number.
import { memo, type ReactElement } from 'react';
import type { Pos } from '../engine/types';

const W = 20;
const H = 22;

type Px = (string | null)[][];

/** Small deterministic random generator (mulberry32). */
function rand(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length) % xs.length];

// skin tones, lightest to darkest
const SKIN = ['#f6d2b8', '#eac0a0', '#dba580', '#c68a62', '#a8714a', '#8a5636', '#6b3f26', '#4f2d1b'];
const AFRICA = new Set(['NGA', 'SEN', 'CIV', 'GHA', 'CMR', 'MLI', 'GUI', 'COD', 'BFA', 'ANG', 'ZIM', 'ZAM', 'TOG', 'RSA', 'MOZ', 'GNB', 'GAM', 'GAB', 'CGO', 'CAF', 'BEN', 'BDI', 'CPV', 'GNQ', 'HAI', 'SLE', 'LBR', 'KEN', 'TAN', 'UGA', 'ETH', 'JAM']);
const NORTH = new Set(['NOR', 'SWE', 'DEN', 'ISL', 'FIN', 'NED', 'GER', 'POL', 'SCO', 'IRL', 'NIR', 'WAL', 'ENG', 'BEL', 'AUT', 'SUI', 'CZE', 'SVK', 'UKR', 'RUS', 'CRO', 'SRB', 'SVN', 'BIH', 'MNE', 'ALB', 'KOS', 'GEO', 'HUN', 'ROU', 'BUL', 'LTU', 'LVA', 'EST', 'CAN', 'AUS', 'NZL', 'USA']);
const MAGHREB = new Set(['MAR', 'ALG', 'TUN', 'EGY', 'TUR', 'GRE', 'ISR', 'JOR', 'IRN', 'KSA', 'QAT', 'LBY', 'ARM']);
const ASIA = new Set(['JPN', 'KOR', 'CHN', 'UZB', 'IDN']);

/** Skin tone index range for a nationality: [lightest, darkest]. */
function skinRange(nat: string): [number, number] {
  if (AFRICA.has(nat)) return [4, 7];
  if (NORTH.has(nat)) return [0, 2];
  if (MAGHREB.has(nat)) return [1, 4];
  if (ASIA.has(nat)) return [0, 2];
  if (['ESP', 'ITA', 'POR', 'FRA', 'ARG', 'URU', 'CHI'].includes(nat)) return [0, 3];
  // Brazil, Colombia and most of the Americas: every tone
  return [0, 7];
}

const HAIR_DARK = ['#1a1310', '#2a1b12', '#3b2618', '#14100d'];
const HAIR_LIGHT = ['#c9a25a', '#a87b3c', '#d8bd7a', '#7a4a22', '#8e3b1f'];
const GREY = ['#9a9a9a', '#c4c4c4'];

type HairStyle = 'buzz' | 'short' | 'side' | 'long' | 'curly' | 'afro' | 'mohawk' | 'bald' | 'bun' | 'band';

function face(id: number, nat: string, age: number, pos: Pos, kit: [string, string], num: number): Px {
  const r = rand(id * 2654435761 + 7);
  const px: Px = Array.from({ length: H }, () => Array<string | null>(W).fill(null));
  const set = (x: number, y: number, c: string | null) => {
    if (x >= 0 && x < W && y >= 0 && y < H && c) px[y][x] = c;
  };
  const rect = (x: number, y: number, w: number, h: number, c: string) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, c);
  };

  const [lo, hi] = skinRange(nat);
  const tone = lo + Math.floor(r() * (hi - lo + 1));
  const skin = SKIN[tone];
  const shade = SKIN[Math.min(SKIN.length - 1, tone + 1)];
  const darkSkin = tone >= 4;
  const blondish = (NORTH.has(nat) && r() < 0.45) || (!darkSkin && r() < 0.08);
  let hair = blondish ? pick(r, HAIR_LIGHT) : pick(r, HAIR_DARK);
  if (age >= 31 && r() < (age - 29) * 0.1) hair = pick(r, GREY);
  const styles: HairStyle[] = darkSkin
    ? ['buzz', 'buzz', 'short', 'afro', 'curly', 'bald', 'mohawk', 'band']
    : ['short', 'short', 'side', 'side', 'buzz', 'long', 'curly', 'bun', 'mohawk', 'band'];
  let style = pick(r, styles);
  if (age >= 32 && r() < 0.25) style = 'bald';

  // shirt: club colours (keepers in their own kit), collar in the second colour, number on the chest
  const shirt = pos === 'GOL' ? '#e8c832' : kit[0];
  const trim = pos === 'GOL' ? '#1d1d1d' : kit[1];
  rect(2, 17, 16, 5, shirt);
  rect(1, 19, 1, 3, shirt);
  rect(18, 19, 1, 3, shirt);
  rect(7, 17, 6, 1, trim);
  set(8, 18, trim);
  set(11, 18, trim);
  digits(px, num, 10, 18, trim);
  // neck
  rect(8, 14, 4, 3, shade);
  rect(8, 14, 4, 2, skin);
  // head
  rect(5, 4, 10, 10, skin);
  rect(6, 3, 8, 1, skin);
  rect(6, 14, 8, 1, skin);
  set(5, 4, null);
  px[4][5] = null;
  px[4][14] = null;
  px[13][5] = shade;
  px[13][14] = shade;
  // ears
  set(4, 8, skin);
  set(4, 9, shade);
  set(15, 8, skin);
  set(15, 9, shade);
  // eyes, brows, nose, mouth
  const eyeY = 8;
  set(7, eyeY, '#ffffff');
  set(8, eyeY, '#1b1b1b');
  set(11, eyeY, '#1b1b1b');
  set(12, eyeY, '#ffffff');
  const brow = style === 'bald' && hair === GREY[0] ? shade : hair;
  rect(7, eyeY - 1, 2, 1, brow);
  rect(11, eyeY - 1, 2, 1, brow);
  set(9, 10, shade);
  set(10, 10, shade);
  rect(8, 12, 4, 1, darkSkin ? '#3a2018' : '#a8605a');

  // facial hair: more likely with age
  const beardRoll = r();
  if (beardRoll < 0.18 + Math.min(0.25, Math.max(0, age - 24) * 0.03)) {
    // full beard
    rect(5, 11, 1, 3, hair);
    rect(14, 11, 1, 3, hair);
    rect(6, 13, 8, 2, hair);
    rect(8, 11, 4, 1, hair);
    rect(8, 12, 4, 1, darkSkin ? '#3a2018' : '#a8605a');
  } else if (beardRoll < 0.32) {
    rect(8, 11, 4, 1, hair); // moustache
  } else if (beardRoll < 0.45) {
    for (const [x, y] of [[6, 13], [8, 14], [10, 14], [12, 13], [7, 12], [13, 12], [9, 14], [11, 13]]) set(x, y, shade); // stubble
  }

  // hair
  switch (style) {
    case 'buzz':
      rect(6, 3, 8, 1, hair);
      rect(5, 4, 10, 1, hair);
      break;
    case 'short':
      rect(6, 2, 8, 2, hair);
      rect(5, 3, 10, 2, hair);
      rect(5, 5, 1, 2, hair);
      rect(14, 5, 1, 2, hair);
      break;
    case 'side':
      rect(6, 2, 9, 2, hair);
      rect(5, 3, 10, 2, hair);
      rect(5, 5, 4, 1, hair);
      rect(5, 5, 1, 3, hair);
      rect(14, 5, 1, 2, hair);
      break;
    case 'long':
      rect(6, 2, 8, 2, hair);
      rect(5, 3, 10, 2, hair);
      rect(4, 4, 2, 9, hair);
      rect(14, 4, 2, 9, hair);
      break;
    case 'curly':
      for (let x = 4; x <= 15; x++) for (let y = 1; y <= 4; y++) if ((x + y) % 2 === 0 || y >= 3) set(x, y, hair);
      rect(4, 5, 1, 2, hair);
      rect(15, 5, 1, 2, hair);
      break;
    case 'afro':
      rect(5, 0, 10, 1, hair);
      rect(4, 1, 12, 4, hair);
      rect(3, 2, 1, 4, hair);
      rect(16, 2, 1, 4, hair);
      rect(4, 5, 1, 2, hair);
      rect(15, 5, 1, 2, hair);
      break;
    case 'mohawk':
      rect(8, 0, 4, 4, hair);
      rect(6, 3, 8, 1, hair);
      break;
    case 'bun':
      rect(8, 0, 4, 2, hair);
      rect(6, 2, 8, 2, hair);
      rect(5, 3, 10, 2, hair);
      break;
    case 'band':
      rect(6, 2, 8, 2, hair);
      rect(5, 3, 10, 1, hair);
      rect(5, 4, 10, 1, kit[1] === '#ffffff' ? kit[0] : '#f2f2f2');
      break;
    case 'bald':
      // a fringe of hair round the sides
      rect(5, 5, 1, 3, hair);
      rect(14, 5, 1, 3, hair);
      set(6, 4, shade);
      break;
  }
  return px;
}

const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];

function digits(px: Px, n: number, cx: number, y: number, c: string) {
  const s = String(n).slice(0, 2);
  const w = s.length * 4 - 1;
  [...s].forEach((d, i) => {
    const bits = DIGITS[Number(d)];
    for (let k = 0; k < 15; k++) {
      const x = Math.round(cx - w / 2) + i * 4 + (k % 3);
      const yy = y + Math.floor(k / 3);
      if (bits[k] === '1' && yy < H && x >= 0 && x < W) px[yy][x] = c;
    }
  });
}

/** A player's pixel portrait (SVG, crisp at any size). */
export const Portrait = memo(function Portrait({
  id,
  nat,
  age,
  pos,
  kit,
  num,
  size = 72,
}: {
  id: number;
  nat: string;
  age: number;
  pos: Pos;
  kit: [string, string];
  num: number;
  size?: number;
}) {
  const px = face(id, nat, age, pos, kit, num);
  const rects: ReactElement[] = [];
  // one rect per run of equal pixels in a row
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      const c = px[y][x];
      let x2 = x + 1;
      while (x2 < W && px[y][x2] === c) x2++;
      if (c) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={x2 - x} height={1} fill={c} />);
      x = x2;
    }
  }
  return (
    <svg className="portrait" viewBox={`0 0 ${W} ${H}`} width={size} height={(size * H) / W} shapeRendering="crispEdges" aria-hidden="true">
      <rect x={0} y={0} width={W} height={H} fill="#0b1626" />
      <rect x={0} y={14} width={W} height={H - 14} fill="rgba(255,255,255,0.04)" />
      {rects}
    </svg>
  );
});
