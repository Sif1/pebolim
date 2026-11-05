import Peer, { type DataConnection } from 'peerjs';
import type { ClientMsg, HostMsg } from './protocol';

/** A bidirectional message channel. */
export interface Conn<In, Out> {
  send(msg: Out): void;
  onMessage(cb: (msg: In) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

export type HostSideConn = Conn<ClientMsg, HostMsg>;
export type ClientSideConn = Conn<HostMsg, ClientMsg>;

/** In-memory pair used by the host's own client (and tests). */
export function loopbackPair(): [HostSideConn, ClientSideConn] {
  const hostCbs: ((m: ClientMsg) => void)[] = [];
  const clientCbs: ((m: HostMsg) => void)[] = [];
  const hostClose: (() => void)[] = [];
  const clientClose: (() => void)[] = [];
  let open = true;
  // messages are cloned so the host's own client never shares objects with the authoritative state
  const hostSide: HostSideConn = {
    send: (m) => {
      if (!open) return;
      const copy = structuredClone(m);
      queueMicrotask(() => clientCbs.forEach((cb) => cb(copy)));
    },
    onMessage: (cb) => hostCbs.push(cb),
    onClose: (cb) => hostClose.push(cb),
    close: () => {
      open = false;
      clientClose.forEach((c) => c());
    },
  };
  const clientSide: ClientSideConn = {
    send: (m) => {
      if (!open) return;
      const copy = structuredClone(m);
      queueMicrotask(() => hostCbs.forEach((cb) => cb(copy)));
    },
    onMessage: (cb) => clientCbs.push(cb),
    onClose: (cb) => clientClose.push(cb),
    close: () => {
      open = false;
      hostClose.forEach((c) => c());
    },
  };
  return [hostSide, clientSide];
}

function wrap<In, Out>(dc: DataConnection): Conn<In, Out> {
  const closeCbs: (() => void)[] = [];
  let closed = false;
  const fireClose = () => {
    if (closed) return;
    closed = true;
    closeCbs.forEach((c) => c());
  };
  dc.on('close', fireClose);
  dc.on('error', fireClose);
  return {
    send: (m) => {
      if (!closed && dc.open) void dc.send(m);
    },
    onMessage: (cb) => dc.on('data', (d) => cb(d as In)),
    onClose: (cb) => closeCbs.push(cb),
    close: () => {
      dc.close();
      fireClose();
    },
  };
}

export const PEER_PREFIX = 'pebolim-';

export function iceServers(): RTCIceServer[] {
  try {
    const custom = localStorage.getItem('pebolim.ice');
    if (custom) return JSON.parse(custom) as RTCIceServer[];
  } catch {
    /* ignore */
  }
  return [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }];
}

export function randomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** Open a host peer with the room code. Calls onConn for each joining client. */
export function openHostPeer(code: string, onConn: (c: HostSideConn) => void): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(PEER_PREFIX + code, { config: { iceServers: iceServers() } });
    let opened = false;
    peer.on('open', () => {
      opened = true;
      resolve(peer);
    });
    peer.on('error', (err) => {
      if (!opened) reject(err);
      else console.warn('peer error', err);
    });
    peer.on('connection', (dc) => {
      dc.on('open', () => onConn(wrap<ClientMsg, HostMsg>(dc)));
    });
    peer.on('disconnected', () => {
      // lost the signalling server; existing data connections keep working, try to get back for new joiners
      if (!peer.destroyed) peer.reconnect();
    });
  });
}

/** Connect to a host by room code. */
export function connectToHost(code: string): Promise<{ peer: Peer; conn: ClientSideConn }> {
  return new Promise((resolve, reject) => {
    const peer = new Peer({ config: { iceServers: iceServers() } });
    const timer = setTimeout(() => reject(new Error('Tempo esgotado ao conectar. Confira o código da sala.')), 20000);
    peer.on('error', (err) => {
      clearTimeout(timer);
      reject(err.type === 'peer-unavailable' ? new Error('Sala não encontrada. Confira o código.') : err);
    });
    peer.on('open', () => {
      const dc = peer.connect(PEER_PREFIX + code.toUpperCase(), { reliable: true });
      dc.on('open', () => {
        clearTimeout(timer);
        resolve({ peer, conn: wrap<HostMsg, ClientMsg>(dc) });
      });
    });
  });
}
