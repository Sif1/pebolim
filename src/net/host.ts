import { enablePatches, produceWithPatches, setAutoFreeze } from 'immer';
import { finishDate, simulateBackground } from '../engine/advance';
import { createCustomClub, createManager, runCommand, type CmdResult } from '../engine/commands';
import type { MatchResult } from '../engine/match/core';
import { LiveMatch } from '../engine/match/live';
import { isHumanClub, prepareMatchday, type MatchdayPlan } from '../engine/matchday';
import { Rng } from '../engine/rng';
import { encodeSnapshot } from '../engine/save';
import type { GameState } from '../engine/types';
import type { Claim, ClientMsg, HostMsg, LobbyState, MatchAction, MatchdayInfo, SessionPhase } from './protocol';
import type { HostSideConn } from './transport';

enablePatches();
setAutoFreeze(false);

interface ClientRec {
  id: string;
  conn: HostSideConn;
  name: string;
  token: string;
  managerId: string | null;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
}

const TICK_MS = 100;
export const MAX_HUMANS = 8;

/** Authoritative game host. Runs in the hosting player's browser. */
export class HostSession {
  state: GameState;
  readonly code: string;
  ver = 0;
  phase: SessionPhase = 'lobby';
  private clients = new Map<string, ClientRec>();
  private nextClient = 1;
  private queue: Promise<void> = Promise.resolve();
  private snap: { ver: number; bytes: Uint8Array; hash: string } | null = null;
  private plan: MatchdayPlan | null = null;
  private live = new Map<number, LiveMatch>();
  private results: Record<number, MatchResult> = {};
  private md: MatchdayInfo | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private tickCount = 0;

  constructor(state: GameState, code: string) {
    this.state = state;
    this.code = code;
  }

  get isNewGame(): boolean {
    const s = this.state;
    return s.meta.season === s.meta.startSeason && s.meta.date === 0 && s.history.length === 0;
  }

  // ---------- connections ----------

  attach(conn: HostSideConn, isHost = false) {
    const rec: ClientRec = {
      id: `c${this.nextClient++}`,
      conn,
      name: 'Jogador',
      token: '',
      managerId: null,
      ready: false,
      connected: true,
      isHost,
    };
    conn.onMessage((msg) => this.enqueue(() => this.handle(rec, msg)));
    conn.onClose(() => this.enqueue(async () => this.disconnected(rec)));
  }

  private enqueue(fn: () => Promise<void> | void) {
    this.queue = this.queue.then(fn).catch((e) => console.error('host error', e));
  }

  private present(): Set<string> {
    const s = new Set<string>();
    for (const c of this.clients.values()) if (c.connected && c.managerId) s.add(c.managerId);
    return s;
  }

  private disconnected(rec: ClientRec) {
    rec.connected = false;
    rec.ready = false;
    // the AI takes over a disconnected manager's live match
    if (rec.managerId) {
      const club = this.state.managers[rec.managerId]?.clubId;
      for (const m of this.live.values()) {
        const sides = [m.sim.setup.home.clubId, m.sim.setup.away.clubId];
        sides.forEach((cid, side) => {
          if (cid === club) {
            m.humans[side] = false;
            m.sim.sides[side].ai = true;
            if (m.paused && m.pausedBy === side) m.resume();
          }
        });
      }
    }
    this.broadcastLobby();
  }

  private send(rec: ClientRec, msg: HostMsg) {
    if (rec.connected) rec.conn.send(msg);
  }

  private broadcast(msg: HostMsg) {
    for (const c of this.clients.values()) this.send(c, msg);
  }

  private notice(rec: ClientRec, text: string, level: 'info' | 'error' | 'success' = 'info') {
    this.send(rec, { t: 'notice', text, level });
  }

  lobbyState(): LobbyState {
    return {
      code: this.code,
      phase: this.phase,
      newGame: this.isNewGame,
      players: [...this.clients.values()]
        .filter((c) => c.connected || c.managerId)
        .map((c) => ({
          clientId: c.id,
          name: c.name,
          managerId: c.managerId,
          connected: c.connected,
          ready: c.ready,
          isHost: c.isHost,
        })),
    };
  }

  private broadcastLobby() {
    this.broadcast({ t: 'lobby', lobby: this.lobbyState() });
  }

  private async snapshot() {
    if (!this.snap || this.snap.ver !== this.ver) {
      const { bytes, hash } = await encodeSnapshot(this.state);
      this.snap = { ver: this.ver, bytes, hash };
    }
    return this.snap;
  }

  private async broadcastSnapshot() {
    this.ver++;
    const s = await this.snapshot();
    this.broadcast({ t: 'snapshot', ver: s.ver, data: s.bytes, hash: s.hash });
  }

  // ---------- message handling ----------

  private async handle(rec: ClientRec, msg: ClientMsg) {
    switch (msg.t) {
      case 'hello':
        return this.hello(rec, msg.name, msg.token, msg.managerId);
      case 'claim':
        return this.claim(rec, msg.claim);
      case 'cmd': {
        if (!rec.managerId) return this.send(rec, { t: 'ack', seq: msg.seq, ok: false, msg: 'Escolha um clube primeiro.' });
        if (this.phase === 'matchday') return this.send(rec, { t: 'ack', seq: msg.seq, ok: false, msg: 'Aguarde o fim da rodada.' });
        const mid = rec.managerId;
        const res = this.apply((d) => runCommand(d, mid, msg.cmd));
        return this.send(rec, { t: 'ack', seq: msg.seq, ok: res.ok, msg: res.msg });
      }
      case 'ready':
        rec.ready = msg.ready;
        return this.broadcastLobby();
      case 'match':
        return this.matchAction(rec, msg.fixtureId, msg.action);
      case 'resync': {
        const s = await this.snapshot();
        return this.send(rec, { t: 'snapshot', ver: s.ver, data: s.bytes, hash: s.hash });
      }
      case 'host':
        if (!rec.isHost) return;
        if (msg.action === 'start') return this.start(rec);
        if (msg.action === 'matchday') return this.startMatchday();
        if (msg.action === 'continue') return this.finishMatchday();
    }
  }

  private async hello(rec: ClientRec, name: string, token: string, managerId: string | null) {
    const clean = name.trim().slice(0, 24) || 'Jogador';
    // reconnect: reuse the old record for the same browser tab
    const old = [...this.clients.values()].find((c) => c.token === token && c !== rec && !c.connected);
    if (old) {
      this.clients.delete(old.id);
      rec.managerId = old.managerId;
      rec.isHost = old.isHost || rec.isHost;
    } else if (managerId && this.state.managers[managerId] && ![...this.clients.values()].some((c) => c.connected && c.managerId === managerId)) {
      rec.managerId = managerId;
    }
    const humans = [...this.clients.values()].filter((c) => c.connected).length;
    if (humans >= MAX_HUMANS + 4) {
      this.send(rec, { t: 'kick', reason: 'Sala cheia.' });
      return;
    }
    rec.name = clean;
    rec.token = token;
    this.clients.set(rec.id, rec);
    this.send(rec, { t: 'welcome', clientId: rec.id });
    const s = await this.snapshot();
    this.send(rec, { t: 'snapshot', ver: s.ver, data: s.bytes, hash: s.hash });
    this.send(rec, { t: 'claimed', managerId: rec.managerId });
    this.send(rec, { t: 'matchday', md: this.md });
    this.broadcastLobby();
  }

  /** Run a mutation through Immer and broadcast the patches. */
  private apply(fn: (draft: GameState) => CmdResult | void): CmdResult {
    let out: CmdResult = { ok: true, msg: '' };
    const [next, patches] = produceWithPatches(this.state, (draft) => {
      const r = fn(draft as GameState);
      if (r) out = r;
    });
    if (patches.length) {
      this.state = next;
      this.ver++;
      this.broadcast({ t: 'patch', ver: this.ver, patches });
    }
    return out;
  }

  private managerTaken(id: string, except: ClientRec) {
    return [...this.clients.values()].some((c) => c !== except && c.connected && c.managerId === id);
  }

  /** Which claims are valid right now (mirrors the lobby UI rules). */
  claimable(clubId: number): boolean {
    const c = this.state.clubs[clubId];
    if (!c || !c.league || c.contOnly) return false;
    if (this.isNewGame) return !c.managerId;
    return c.upForSelection && !c.managerId;
  }

  private claim(rec: ClientRec, claim: Claim) {
    if (this.phase === 'matchday') return this.notice(rec, 'Aguarde o fim da rodada para escolher um clube.', 'error');
    if (claim.kind === 'spectate') {
      rec.managerId = null;
      this.send(rec, { t: 'claimed', managerId: null });
      return this.broadcastLobby();
    }
    if (rec.managerId) return this.notice(rec, 'Você já tem um treinador nesta sessão.', 'error');
    const humans = [...this.clients.values()].filter((c) => c.connected && c.managerId).length;
    if (humans >= MAX_HUMANS) return this.notice(rec, `Limite de ${MAX_HUMANS} treinadores.`, 'error');

    if (claim.kind === 'resume') {
      const m = this.state.managers[claim.managerId];
      if (!m) return this.notice(rec, 'Treinador não encontrado.', 'error');
      if (this.managerTaken(m.id, rec)) return this.notice(rec, 'Outro jogador já assumiu esse treinador.', 'error');
      rec.managerId = m.id;
    } else if (claim.kind === 'club') {
      if (!this.claimable(claim.clubId)) return this.notice(rec, 'Esse clube não está disponível.', 'error');
      let mid: string | null = null;
      this.apply((d) => {
        const rng = new Rng(d.meta.rng);
        mid = createManager(d, rng, rec.name, claim.clubId).id;
        d.meta.rng = rng.state();
      });
      rec.managerId = mid;
    } else if (claim.kind === 'create') {
      if (!this.isNewGame) return this.notice(rec, 'Só é possível criar um clube no início de um jogo novo.', 'error');
      let err: string | null = null;
      let mid: string | null = null;
      this.apply((d) => {
        const rng = new Rng(d.meta.rng);
        err = createCustomClub(d, rng, claim.spec);
        if (!err) mid = createManager(d, rng, rec.name, claim.spec.replaceClubId).id;
        d.meta.rng = rng.state();
      });
      if (err) return this.notice(rec, err, 'error');
      rec.managerId = mid;
    }
    this.send(rec, { t: 'claimed', managerId: rec.managerId });
    this.broadcastLobby();
  }

  private start(rec: ClientRec) {
    if (this.phase !== 'lobby') return;
    if (![...this.clients.values()].some((c) => c.connected && c.managerId)) return this.notice(rec, 'Ninguém escolheu um clube ainda.', 'error');
    this.phase = 'manage';
    for (const c of this.clients.values()) c.ready = false;
    this.broadcastLobby();
  }

  // ---------- match day ----------

  private speed(): number {
    return 5700 / (this.state.meta.settings.matchMinutes * 60);
  }

  private async startMatchday() {
    if (this.phase !== 'manage') return;
    const present = this.present();
    this.state.meta.seasonOver = false;
    const rng = new Rng(this.state.meta.rng);
    this.plan = prepareMatchday(this.state, rng, present);
    this.state.meta.rng = rng.state();
    this.results = simulateBackground(this.plan);
    this.live.clear();
    for (const setup of this.plan.setups) {
      if (!this.plan.live.includes(setup.fixtureId)) continue;
      const humans: [boolean, boolean] = [isHumanClub(this.state, setup.home.clubId, present), isHumanClub(this.state, setup.away.clubId, present)];
      this.live.set(setup.fixtureId, new LiveMatch(setup, humans));
    }
    this.phase = 'matchday';
    for (const c of this.clients.values()) c.ready = false;
    this.md = { date: this.plan.date, live: [...this.live.keys()], done: [], allDone: this.live.size === 0 };
    await this.broadcastSnapshot();
    this.broadcastLobby();
    this.broadcast({ t: 'matchday', md: this.md });
    if (this.live.size) this.startTimer();
  }

  private startTimer() {
    this.stopTimer();
    this.lastTick = performance.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick() {
    const now = performance.now();
    const dt = Math.min(2000, now - this.lastTick);
    this.lastTick = now;
    const speed = this.speed();
    let changed = false;
    for (const m of this.live.values()) {
      if (m.ended) continue;
      m.tick(dt, speed);
      if (m.ended) {
        this.results[m.fixtureId] = m.sim.result();
        this.md!.done.push(m.fixtureId);
        changed = true;
      }
    }
    this.tickCount++;
    if (this.tickCount % 2 === 0 || changed) this.pushFrames(this.tickCount % 10 === 0);
    if (changed) {
      this.md!.allDone = this.md!.done.length >= this.live.size;
      this.broadcast({ t: 'matchday', md: this.md });
      if (this.md!.allDone) this.stopTimer();
    }
  }

  private pushFrames(allDetails = false) {
    const frames = [...this.live.values()].map((m) => m.frame());
    const details = [...this.live.values()].filter((m) => allDetails || m.detailDirty).map((m) => m.detail());
    this.broadcast({ t: 'frames', frames, details });
  }

  private matchAction(rec: ClientRec, fixtureId: number, action: MatchAction) {
    const m = this.live.get(fixtureId);
    if (!m || !rec.managerId) return;
    const clubId = this.state.managers[rec.managerId]?.clubId;
    const side = m.sim.setup.home.clubId === clubId ? 0 : m.sim.setup.away.clubId === clubId ? 1 : -1;
    if (side < 0) return this.notice(rec, 'Você não participa dessa partida.', 'error');
    const s = side as 0 | 1;
    let err: string | null = null;
    switch (action.a) {
      case 'pause':
        err = m.pause(s);
        break;
      case 'resume':
        err = m.resume(s);
        break;
      case 'sub':
        err = m.sim.sub(s, action.out, action.in);
        break;
      case 'swap':
        m.sim.swapSlots(s, action.s1, action.s2);
        break;
      case 'tactics':
        m.sim.setTactics(s, action.tactics);
        break;
      case 'quick': {
        m.quickReq[s] = true;
        const other = (1 - s) as 0 | 1;
        if (m.humans[other] && !m.quickReq[other]) {
          err = 'Pedido enviado. Aguardando o adversário aceitar a simulação rápida.';
          break;
        }
        this.results[m.fixtureId] = m.finishNow();
        if (!this.md!.done.includes(m.fixtureId)) this.md!.done.push(m.fixtureId);
        this.md!.allDone = this.md!.done.length >= this.live.size;
        this.broadcast({ t: 'matchday', md: this.md });
        if (this.md!.allDone) this.stopTimer();
        break;
      }
    }
    m.detailDirty = true;
    if (err) this.notice(rec, err, action.a === 'quick' ? 'info' : 'error');
    this.pushFrames();
  }

  private async finishMatchday() {
    if (this.phase !== 'matchday' || !this.md?.allDone) return;
    this.stopTimer();
    const present = this.present();
    finishDate(this.state, Object.values(this.results), present);
    this.live.clear();
    this.plan = null;
    this.results = {};
    this.md = null;
    this.phase = 'manage';
    for (const c of this.clients.values()) c.ready = false;
    await this.broadcastSnapshot();
    this.broadcast({ t: 'matchday', md: null });
    this.broadcastLobby();
  }

  dispose() {
    this.stopTimer();
    for (const c of this.clients.values()) c.conn.close();
  }
}
