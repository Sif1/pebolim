import { create } from 'zustand';
import type { Database } from './engine/db';
import { loadFromBytes, saveFileName, saveToBytes } from './engine/save';
import type { GameState } from './engine/types';
import { createWorld, type NewWorldOptions } from './engine/world';
import { idbSet, type AutoSave } from './idb';
import { ClientSession } from './net/client';
import { HostSession } from './net/host';
import type { LobbyState, MatchdayInfo } from './net/protocol';
import { connectToHost, loopbackPair, openHostPeer, randomCode } from './net/transport';

export type Screen = 'painel' | 'elenco' | 'escalacao' | 'mercado' | 'financas' | 'competicoes' | 'noticias' | 'treinador' | 'opcoes' | 'clube';

export interface Notice {
  id: number;
  text: string;
  level: 'info' | 'error' | 'success';
}

interface AppState {
  client: ClientSession | null;
  host: HostSession | null;
  state: GameState | null;
  ver: number;
  lobby: LobbyState | null;
  managerId: string | null;
  md: MatchdayInfo | null;
  frameTick: number;
  screen: Screen;
  /** last tab opened in each section with tabs */
  tabs: Partial<Record<Screen, string>>;
  /** club being viewed on the club screen */
  viewClub: number | null;
  notices: Notice[];
  status: 'idle' | 'connecting' | 'online' | 'closed';
  error: string | null;
  online: boolean;
  setScreen(s: Screen, tab?: string): void;
  openClub(id: number): void;
  notify(text: string, level?: Notice['level']): void;
  dismiss(id: number): void;
}

let noticeId = 1;

export const useApp = create<AppState>((set, get) => ({
  client: null,
  host: null,
  state: null,
  ver: -1,
  lobby: null,
  managerId: null,
  md: null,
  frameTick: 0,
  screen: 'painel',
  tabs: {},
  viewClub: null,
  notices: [],
  status: 'idle',
  error: null,
  online: false,
  setScreen: (screen, tab) => set({ screen, tabs: tab ? { ...get().tabs, [screen]: tab } : get().tabs }),
  openClub: (id) => set({ screen: 'clube', viewClub: id }),
  notify: (text, level = 'info') => {
    const id = noticeId++;
    set({ notices: [...get().notices.slice(-4), { id, text, level }] });
    setTimeout(() => get().dismiss(id), level === 'error' ? 7000 : 4500);
  },
  dismiss: (id) => set({ notices: get().notices.filter((n) => n.id !== id) }),
}));

function tabToken(): string {
  let t = sessionStorage.getItem('pebolim.token');
  if (!t) {
    // unguessable: whoever holds it can take this tab's place after a reconnect
    t = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem('pebolim.token', t);
  }
  return t;
}

const mgrKey = (code: string) => `pebolim.manager.${code}`;

function makeClient(conn: ConstructorParameters<typeof ClientSession>[0], code: string): ClientSession {
  let lastAutosave = 0;
  let pendingSave: ReturnType<typeof setTimeout> | null = null;
  const autosave = (bytes: Uint8Array) => {
    const st = client.state;
    const mid = client.managerId;
    const club = st && mid && st.managers[mid]?.clubId != null ? st.clubs[st.managers[mid].clubId!].name : null;
    void idbSet('last', { bytes, name: st?.meta.name ?? 'Jogo', club, season: st?.meta.season ?? 0, savedAt: new Date().toISOString() } satisfies AutoSave);
  };
  const client: ClientSession = new ClientSession(conn, {
    onState: (state, ver) => {
      useApp.setState({ state, ver });
      // changes between rounds arrive as patches: save them too, a few seconds after things settle
      if (pendingSave) clearTimeout(pendingSave);
      pendingSave = setTimeout(() => {
        pendingSave = null;
        // never autosave a half-played match day (reloading it would replay travel and lineups)
        if (client.state && !client.md) void saveToBytes(client.state).then(autosave);
      }, 4000);
    },
    onLobby: (lobby) => useApp.setState({ lobby }),
    onClaimed: (managerId) => {
      useApp.setState({ managerId });
      if (managerId) localStorage.setItem(mgrKey(code), managerId);
    },
    onMatchday: (md) => {
      const prev = useApp.getState().md;
      useApp.setState({ md });
      // back from a match day: open the round summary
      if (prev && !md) useApp.getState().setScreen('competicoes', useApp.getState().state?.meta.seasonOver ? 'temporadas' : 'rodada');
    },
    onFrames: () => useApp.setState({ frameTick: useApp.getState().frameTick + 1 }),
    onNotice: (text, level) => useApp.getState().notify(text, level),
    onSnapshotBytes: (bytes, live) => {
      if (live) return;
      const now = Date.now();
      if (now - lastAutosave < 3000) return;
      lastAutosave = now;
      autosave(bytes);
    },
    onClose: (reason) => {
      useApp.setState({ status: 'closed', error: reason });
    },
  });
  return client;
}

async function startHosting(state: GameState, name: string, online: boolean) {
  const code = randomCode();
  const host = new HostSession(state, code);
  const [hostSide, clientSide] = loopbackPair();
  host.attach(hostSide, true);
  const client = makeClient(clientSide, code);
  useApp.setState({ host, client, status: 'online', error: null, online: false, screen: 'painel', md: null, lobby: null, managerId: null });
  client.hello(name, 'host-' + tabToken(), null);
  if (online) {
    try {
      await openHostPeer(code, (conn) => host.attach(conn));
      useApp.setState({ online: true });
    } catch (e) {
      console.warn(e);
      useApp.getState().notify('Não foi possível abrir a sala online. Você pode jogar sozinho mesmo assim.', 'error');
    }
  }
}

export async function hostNewGame(db: Database, opts: NewWorldOptions, playerName: string, online: boolean) {
  const state = createWorld(db, opts);
  await startHosting(state, playerName, online);
}

export async function hostFromBytes(bytes: Uint8Array, playerName: string, online: boolean) {
  const state = await loadFromBytes(bytes);
  await startHosting(state, playerName, online);
}

export async function joinGame(code: string, playerName: string) {
  useApp.setState({ status: 'connecting', error: null });
  try {
    const clean = code.trim().toUpperCase();
    const { conn } = await connectToHost(clean);
    const client = makeClient(conn, clean);
    useApp.setState({ client, host: null, status: 'online', online: true, screen: 'painel' });
    client.hello(playerName, tabToken(), localStorage.getItem(mgrKey(clean)));
  } catch (e) {
    useApp.setState({ status: 'idle', error: e instanceof Error ? e.message : String(e) });
  }
}

export function leaveGame() {
  const { client, host } = useApp.getState();
  client?.close();
  host?.dispose();
  useApp.setState({ client: null, host: null, state: null, lobby: null, md: null, managerId: null, status: 'idle', online: false });
}

export async function downloadSave() {
  const { state, managerId } = useApp.getState();
  if (!state) return;
  const bytes = await saveToBytes(state);
  const club = managerId && state.managers[managerId]?.clubId != null ? state.clubs[state.managers[managerId].clubId!].name : undefined;
  const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = saveFileName(state, club);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Helpers for components. */
export function useMe() {
  const state = useApp((s) => s.state);
  const managerId = useApp((s) => s.managerId);
  const manager = state && managerId ? (state.managers[managerId] ?? null) : null;
  const club = state && manager?.clubId != null ? state.clubs[manager.clubId] : null;
  return { state, manager, club };
}

export async function command(cmd: Parameters<ClientSession['command']>[0], quiet = false) {
  const client = useApp.getState().client;
  if (!client) return { ok: false, msg: 'Sem sessão' };
  const res = await client.command(cmd);
  if (!quiet || !res.ok) useApp.getState().notify(res.msg, res.ok ? 'success' : 'error');
  return res;
}
