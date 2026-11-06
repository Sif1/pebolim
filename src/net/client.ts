import { applyPatches, enablePatches, setAutoFreeze, type Patch } from 'immer';
import type { Command, CmdResult } from '../engine/commands';
import type { LiveDetail, LiveFrame } from '../engine/match/live';
import { loadFromBytes } from '../engine/save';
import type { GameState } from '../engine/types';
import type { Claim, ClientMsg, HostMsg, LobbyState, MatchAction, MatchdayInfo } from './protocol';
import type { ClientSideConn } from './transport';

enablePatches();
setAutoFreeze(false);

export interface FrameBuf {
  prev: LiveFrame | null;
  prevAt: number;
  cur: LiveFrame;
  at: number;
}

export interface ClientEvents {
  onState(state: GameState, ver: number): void;
  onLobby(lobby: LobbyState): void;
  onClaimed(managerId: string | null): void;
  onMatchday(md: MatchdayInfo | null): void;
  onFrames(): void;
  onNotice(text: string, level: 'info' | 'error' | 'success'): void;
  /** live = mid-match-day snapshot, not a safe autosave point */
  onSnapshotBytes(bytes: Uint8Array, live: boolean): void;
  onClose(reason: string): void;
}

/** A participant's view of the session: a replica of the game state kept in sync by the host. */
export class ClientSession {
  state: GameState | null = null;
  ver = -1;
  lobby: LobbyState | null = null;
  clientId: string | null = null;
  managerId: string | null = null;
  md: MatchdayInfo | null = null;
  frames = new Map<number, FrameBuf>();
  details = new Map<number, LiveDetail>();
  /** all events of each live match so far */
  events = new Map<number, LiveFrame['ev']>();
  private seq = 0;
  private pending = new Map<number, (r: CmdResult) => void>();
  private buffered: { ver: number; patches: Patch[] }[] = [];
  private loading = false;
  private closed = false;

  constructor(
    private conn: ClientSideConn,
    private ev: ClientEvents,
  ) {
    conn.onMessage((m) => void this.handle(m));
    conn.onClose(() => {
      if (!this.closed) this.ev.onClose('Conexão com o anfitrião perdida.');
      this.closed = true;
    });
  }

  hello(name: string, token: string, managerId: string | null) {
    this.send({ t: 'hello', name, token, managerId });
  }

  send(m: ClientMsg) {
    this.conn.send(m);
  }

  claim(claim: Claim) {
    this.send({ t: 'claim', claim });
  }

  ready(ready: boolean) {
    this.send({ t: 'ready', ready });
  }

  match(fixtureId: number, action: MatchAction) {
    this.send({ t: 'match', fixtureId, action });
  }

  hostAction(action: 'start' | 'matchday' | 'continue') {
    this.send({ t: 'host', action });
  }

  /** Host only: change how long live matches last. */
  setMatchMinutes(matchMinutes: number) {
    this.send({ t: 'settings', matchMinutes });
  }

  command(cmd: Command): Promise<CmdResult> {
    const seq = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(seq, resolve);
      this.send({ t: 'cmd', seq, cmd });
      setTimeout(() => {
        if (this.pending.has(seq)) {
          this.pending.delete(seq);
          resolve({ ok: false, msg: 'Sem resposta do anfitrião.' });
        }
      }, 15000);
    });
  }

  close() {
    this.closed = true;
    this.conn.close();
  }

  private async handle(m: HostMsg) {
    switch (m.t) {
      case 'welcome':
        this.clientId = m.clientId;
        return;
      case 'lobby':
        this.lobby = m.lobby;
        return this.ev.onLobby(m.lobby);
      case 'claimed':
        this.managerId = m.managerId;
        return this.ev.onClaimed(m.managerId);
      case 'snapshot':
        return this.snapshot(m.ver, m.data, m.hash, !!m.live);
      case 'patch':
        this.buffered.push({ ver: m.ver, patches: m.patches });
        return this.flush();
      case 'ack': {
        const cb = this.pending.get(m.seq);
        this.pending.delete(m.seq);
        cb?.({ ok: m.ok, msg: m.msg });
        return;
      }
      case 'notice':
        return this.ev.onNotice(m.text, m.level);
      case 'matchday':
        this.md = m.md;
        if (!m.md) {
          this.frames.clear();
          this.details.clear();
          this.events.clear();
        }
        return this.ev.onMatchday(m.md);
      case 'frames': {
        const now = performance.now();
        for (const f of m.frames) {
          const buf = this.frames.get(f.f);
          this.frames.set(f.f, buf ? { prev: buf.cur, prevAt: buf.at, cur: f, at: now } : { prev: null, prevAt: now, cur: f, at: now });
          if (f.ev.length) this.events.set(f.f, [...(this.events.get(f.f) ?? []), ...f.ev]);
        }
        for (const d of m.details) this.details.set(d.f, d);
        return this.ev.onFrames();
      }
      case 'kick':
        this.closed = true;
        return this.ev.onClose(m.reason);
    }
  }

  private async snapshot(ver: number, data: Uint8Array, hash: string, live: boolean) {
    this.loading = true;
    try {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
      const state = await loadFromBytes(bytes, hash);
      if (ver < this.ver) return;
      this.state = state;
      this.ver = ver;
      this.buffered = this.buffered.filter((b) => b.ver > ver);
      this.ev.onSnapshotBytes(bytes, live);
      this.ev.onState(state, ver);
    } catch (e) {
      console.error(e);
      this.send({ t: 'resync' });
    } finally {
      this.loading = false;
    }
    this.flush();
  }

  private flush() {
    if (this.loading || !this.state) return;
    this.buffered.sort((a, b) => a.ver - b.ver);
    let changed = false;
    while (this.buffered.length) {
      const b = this.buffered[0];
      if (b.ver <= this.ver) {
        this.buffered.shift();
        continue;
      }
      if (b.ver !== this.ver + 1) {
        // missing a version: ask for a fresh snapshot
        this.send({ t: 'resync' });
        return;
      }
      this.state = applyPatches(this.state, b.patches) as GameState;
      this.ver = b.ver;
      this.buffered.shift();
      changed = true;
    }
    if (changed) this.ev.onState(this.state, this.ver);
  }
}
