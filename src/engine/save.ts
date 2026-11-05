import { SAVE_FORMAT_VERSION, type Fixture, type GameState, type Player } from './types';

const APP = 'pebolim-manager';

const PLAYER_KEYS: (keyof Player)[] = [
  'id', 'name', 'nat', 'pos', 'birth', 'str', 'pot', 'traits', 'clubId', 'wage', 'contractEnd',
  'fitness', 'morale', 'injury', 'ban', 'yel', 'listed', 'loan', 's', 'c', 'num', 'idle',
];
const FIXTURE_KEYS: (keyof Fixture)[] = [
  'id', 'comp', 'date', 'home', 'away', 'hg', 'ag', 'pens', 'stage', 'tie', 'leg', 'group', 'round', 'goals', 'att', 'reds',
];

const r1 = (v: number) => Math.round(v * 10) / 10;

interface Packed {
  k: string[];
  rows: unknown[][];
}

/** Compact, JSON-friendly form of the state (column-packed players and fixtures). */
export function packState(state: GameState): unknown {
  const players: Packed = {
    k: PLAYER_KEYS as string[],
    rows: Object.values(state.players).map((p) =>
      PLAYER_KEYS.map((k) => {
        const v = p[k];
        if (k === 'str' || k === 'fitness' || k === 'morale') return r1(v as number);
        if (k === 's') {
          const s = p.s;
          return [s.apps, s.goals, s.ast, s.yel, s.red];
        }
        if (k === 'c') return [p.c.apps, p.c.goals];
        return v;
      }),
    ),
  };
  const fixtures: Packed = {
    k: FIXTURE_KEYS as string[],
    rows: Object.values(state.fixtures).map((f) =>
      FIXTURE_KEYS.map((k) => (k === 'goals' ? f.goals.map((g) => [g.min, g.side, g.pid, g.ast, g.pen ? 1 : 0]) : (f[k] ?? null))),
    ),
  };
  return { ...state, players, fixtures };
}

export function unpackState(obj: any): GameState {
  const players: Record<number, Player> = {};
  const pk: string[] = obj.players.k;
  for (const row of obj.players.rows as unknown[][]) {
    const p: any = {};
    pk.forEach((k, i) => (p[k] = row[i]));
    const s = p.s as number[];
    p.s = { apps: s[0], goals: s[1], ast: s[2], yel: s[3], red: s[4] };
    const c = p.c as number[];
    p.c = { apps: c[0], goals: c[1] };
    players[p.id] = p as Player;
  }
  const fixtures: Record<number, Fixture> = {};
  const fk: string[] = obj.fixtures.k;
  for (const row of obj.fixtures.rows as unknown[][]) {
    const f: any = {};
    fk.forEach((k, i) => (f[k] = row[i]));
    f.goals = (f.goals as number[][]).map((g) => ({ min: g[0], side: g[1], pid: g[2], ast: g[3], ...(g[4] ? { pen: true } : {}) }));
    if (f.reds == null) delete f.reds;
    fixtures[f.id] = f as Fixture;
  }
  const state = { ...obj, players, fixtures } as GameState;
  return migrate(state);
}

/** Hook for future format changes. */
function migrate(state: GameState): GameState {
  if (state.v > SAVE_FORMAT_VERSION) throw new Error('Este save foi criado por uma versão mais nova do jogo.');
  return state;
}

async function streamBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return streamBytes(stream);
}

export async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new TextDecoder().decode(await streamBytes(stream));
}

/** .pebolim file bytes */
export async function saveToBytes(state: GameState): Promise<Uint8Array> {
  return (await encodeSnapshot(state)).bytes;
}

/** Save bytes plus a hash of the inner JSON (the network snapshot is the same as a save file). */
export async function encodeSnapshot(state: GameState): Promise<{ bytes: Uint8Array; hash: string }> {
  const text = JSON.stringify({ app: APP, format: SAVE_FORMAT_VERSION, state: packState(state) });
  return { bytes: await gzip(text), hash: hashString(text) };
}

export async function loadFromBytes(bytes: Uint8Array, expectHash?: string): Promise<GameState> {
  let text: string;
  try {
    text = await gunzip(bytes);
  } catch {
    throw new Error('Arquivo inválido: não é um save do Pebolim Manager.');
  }
  if (expectHash && hashString(text) !== expectHash) throw new Error('Snapshot corrompido');
  const obj = JSON.parse(text);
  if (obj?.app !== APP || !obj.state) throw new Error('Arquivo inválido: não é um save do Pebolim Manager.');
  return unpackState(obj.state);
}

/** FNV-1a hash of a string, used to detect replica drift. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export function saveFileName(state: GameState, clubName?: string): string {
  const slug = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
  const d = state.calendar[Math.min(state.meta.date, state.calendar.length - 1)];
  const date = d ? `${String(d.day).padStart(2, '0')}-${String(d.month).padStart(2, '0')}` : 'inicio';
  return `pebolim-${slug(clubName ?? state.meta.name)}-${state.meta.season}-${date}.pebolim`;
}
