import { absDate, playerValue } from './util';
import { ceilingFor, tierOf } from './potential';
import { sectorRefs } from './economy';
import { SAVE_FORMAT_VERSION, type Fixture, type GameState, type Player, type SectorPrices } from './types';
import { defaultTicket } from './world';

const APP = 'pebolim-manager';

const PLAYER_KEYS: (keyof Player)[] = [
  'id', 'name', 'nat', 'pos', 'birth', 'str', 'stars', 'pot', 'traits', 'clubId', 'wage', 'contractEnd',
  'fitness', 'morale', 'injury', 'ban', 'yel', 'salePrice', 'loanListed', 'auction', 'loan', 's', 'c', 'num', 'idle',
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
          return [s.apps, s.goals, s.ast, s.yel, s.red, s.rt];
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
    p.s = { apps: s[0], goals: s[1], ast: s[2], yel: s[3], red: s[4], rt: s[5] ?? 0 };
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

/** Bring older saves up to the current format. */
function migrate(state: GameState): GameState {
  if (state.v > SAVE_FORMAT_VERSION) throw new Error('Este save foi criado por uma versão mais nova do jogo.');
  if (state.v < 2) {
    // v1 had one ticket price per club: scale the sector reference prices by how far it was from the default
    for (const c of Object.values(state.clubs) as (GameState['clubs'][number] & { ticket?: number })[]) {
      const k = c.ticket ? c.ticket / Math.max(1, defaultTicket(c)) : 1;
      c.tickets = { base: sectorRefs(c).map((p) => Math.max(1, Math.round(p * k))) as SectorPrices, comps: {} };
      delete c.ticket;
    }
    // matches played before ratings existed count as a neutral 6.0
    for (const p of Object.values(state.players)) p.s.rt = p.s.apps * 60;
    state.v = 2;
  }
  if (state.v < 3) {
    // v2 was in Brazilian reais; everything is in US dollars now
    const k = 1 / 5.4;
    const m = (v: number) => Math.round(v * k);
    for (const c of Object.values(state.clubs)) {
      c.balance = m(c.balance);
      c.baseIncome = m(c.baseIncome);
      for (const key of Object.keys(c.ledger) as (keyof typeof c.ledger)[]) c.ledger[key] = m(c.ledger[key]);
      const conv = (ps: SectorPrices) => ps.map((x) => Math.max(1, m(x))) as SectorPrices;
      c.tickets = { base: conv(c.tickets.base), comps: Object.fromEntries(Object.entries(c.tickets.comps).map(([id, ps]) => [id, conv(ps)])) };
    }
    for (const p of Object.values(state.players)) p.wage = Math.max(500, m(p.wage));
    for (const b of Object.values(state.bids)) {
      b.fee = m(b.fee);
      b.wage = m(b.wage);
      if (b.counter != null) b.counter = m(b.counter);
    }
    for (const cfg of state.config) cfg.prize = m(cfg.prize);
    for (const comp of Object.values(state.comps)) comp.cfg.prize = m(comp.cfg.prize);
    state.v = 3;
  }
  // market listings (saves before them had only a "listed" flag) and loans that ended at a season
  state.auctionBids ??= {};
  for (const p of Object.values(state.players) as (Player & { listed?: boolean })[]) {
    if (p.salePrice === undefined) p.salePrice = p.listed ? playerValue(p, state.meta.season) : null;
    p.loanListed ??= null;
    p.auction ??= null;
    delete p.listed;
    if (p.loan && p.loan.until < 10000) p.loan.until = absDate(p.loan.until, 77);
  }
  // potential stars (saves before them had only a hidden ceiling)
  for (const p of Object.values(state.players)) {
    if (p.stars == null) {
      p.stars = Math.max(tierOf(p.str), tierOf(p.pot ?? p.str));
      p.pot = Math.max(p.str, ceilingFor(p.stars));
    }
  }
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
