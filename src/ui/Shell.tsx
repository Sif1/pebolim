import { useState, type ReactNode } from 'react';
import type { GameState } from '../engine/types';
import { dateLabel, formatMoney } from '../engine/util';
import { downloadSave, leaveGame, useApp, useMe, type Screen } from '../store';
import { ClubBadge, compLabel, Modal } from './common';
import { ClaimPanel } from './Lobby';
import { Calendario } from './screens/Calendario';
import { ClubeView } from './screens/ClubeView';
import { Competicoes } from './screens/Competicoes';
import { Contratos } from './screens/Contratos';
import { Elenco } from './screens/Elenco';
import { Escalacao } from './screens/Escalacao';
import { Estrutura } from './screens/Estrutura';
import { Financas } from './screens/Financas';
import { Mercado } from './screens/Mercado';
import { Noticias } from './screens/Noticias';
import { Opcoes } from './screens/Opcoes';
import { Painel } from './screens/Painel';
import { Propostas } from './screens/Propostas';
import { Resumo } from './screens/Resumo';
import { Temporada } from './screens/Temporada';
import { Treinador } from './screens/Treinador';

/** The menu: a short flat list; related screens live as tabs inside one entry. Null = divider. */
const NAV: ({ id: Screen; label: string; needsClub?: boolean } | null)[] = [
  { id: 'painel', label: 'Painel' },
  { id: 'elenco', label: 'Elenco', needsClub: true },
  { id: 'escalacao', label: 'Escalação e tática', needsClub: true },
  { id: 'mercado', label: 'Mercado', needsClub: true },
  { id: 'financas', label: 'Finanças e estrutura', needsClub: true },
  null,
  { id: 'competicoes', label: 'Competições' },
  { id: 'noticias', label: 'Notícias' },
  null,
  { id: 'treinador', label: 'Treinador' },
  { id: 'opcoes', label: 'Opções' },
];

interface TabDef {
  id: string;
  label: string;
  count?: number;
  hidden?: boolean;
  render: () => ReactNode;
}

/** A screen made of tabs; remembers the last tab in the store. */
function Tabbed({ screen, tabs }: { screen: Screen; tabs: TabDef[] }) {
  const active = useApp((s) => s.tabs[screen]);
  const setScreen = useApp((s) => s.setScreen);
  const visible = tabs.filter((t) => !t.hidden);
  const cur = visible.find((t) => t.id === active) ?? visible[0];
  return (
    <div className="col">
      <div className="section-tabs">
        {visible.map((t) => (
          <button key={t.id} className={t === cur ? 'active' : ''} onClick={() => setScreen(screen, t.id)}>
            {t.label}
            {!!t.count && <span className="count">{t.count}</span>}
          </button>
        ))}
      </div>
      <div className="tab-body">{cur?.render()}</div>
    </div>
  );
}

export function nextFixture(state: GameState, clubId: number) {
  return Object.values(state.fixtures)
    .filter((f) => (f.home === clubId || f.away === clubId) && f.hg == null && f.date >= state.meta.date)
    .sort((a, b) => a.date - b.date)[0];
}

export function Shell() {
  const screen = useApp((s) => s.screen);
  const setScreen = useApp((s) => s.setScreen);
  const managerId = useApp((s) => s.managerId);
  const { state, manager, club } = useMe();
  if (!state) return null;
  const pendingBids = club ? Object.values(state.bids).filter((b) => b.seller === club.id && b.status === 'pendente').length : 0;
  const counters = club ? Object.values(state.bids).filter((b) => b.buyer === club.id && b.status === 'contraproposta').length : 0;
  const offers = manager?.offers.length ?? 0;
  const expiring = club ? Object.values(state.players).filter((p) => p.clubId === club.id && !p.loan && p.contractEnd <= state.meta.season).length : 0;

  if (!managerId) {
    return (
      <div className="content" style={{ height: '100vh' }}>
        <div className="row" style={{ marginBottom: 12 }}>
          <h1 className="grow">Escolha um clube para entrar no jogo</h1>
          <button className="btn ghost" onClick={leaveGame}>
            Sair
          </button>
        </div>
        <ClaimPanel />
      </div>
    );
  }

  const body = (() => {
    switch (screen) {
      case 'elenco':
        return <Elenco />;
      case 'escalacao':
        return <Escalacao />;
      case 'mercado':
        return (
          <Tabbed
            screen="mercado"
            tabs={[
              { id: 'buscar', label: 'Buscar jogadores', render: () => <Mercado /> },
              { id: 'propostas', label: 'Propostas', count: pendingBids + counters, render: () => <Propostas /> },
              { id: 'contratos', label: 'Contratos', count: expiring, render: () => <Contratos /> },
            ]}
          />
        );
      case 'financas':
        return (
          <Tabbed
            screen="financas"
            tabs={[
              { id: 'financas', label: 'Finanças e ingressos', render: () => <Financas /> },
              { id: 'estadio', label: 'Estádio e CT', render: () => <Estrutura part="estadio" /> },
              { id: 'viagens', label: 'Viagens', render: () => <Estrutura part="viagens" /> },
            ]}
          />
        );
      case 'competicoes':
        return (
          <Tabbed
            screen="competicoes"
            tabs={[
              { id: 'rodada', label: 'Resumo da rodada', render: () => <Resumo /> },
              { id: 'tabelas', label: 'Tabelas e jogos', render: () => <Competicoes /> },
              { id: 'calendario', label: 'Meu calendário', hidden: !club, render: () => <Calendario /> },
              { id: 'temporadas', label: 'Temporadas', render: () => <Temporada /> },
            ]}
          />
        );
      case 'noticias':
        return <Noticias />;
      case 'treinador':
        return <Treinador />;
      case 'opcoes':
        return <Opcoes />;
      case 'clube':
        return <ClubeView />;
      default:
        return <Painel />;
    }
  })();

  return (
    <div className="shell" style={club ? ({ '--club1': club.colors[0], '--club2': club.colors[1] } as React.CSSProperties) : undefined}>
      <TopBar />
      <nav className="sidebar">
        {NAV.map((it, i) => {
          if (!it) return <div key={`d${i}`} className="nav-divider" />;
          if (it.needsClub && !club) return null;
          const count = it.id === 'mercado' ? pendingBids + counters : it.id === 'treinador' ? offers : 0;
          return (
            <button key={it.id} className={screen === it.id ? 'active' : ''} onClick={() => setScreen(it.id)}>
              {it.label}
              {count > 0 && <span className="count">{count}</span>}
            </button>
          );
        })}
      </nav>
      <main className="content">{body}</main>
    </div>
  );
}

/** Everyone in the room: club badge, name, online dot and ready mark. */
function PlayersOnline() {
  const state = useApp((s) => s.state);
  const lobby = useApp((s) => s.lobby);
  const client = useApp((s) => s.client);
  if (!state || !lobby) return null;
  const players = lobby.players.filter((p) => p.managerId || p.connected);
  const compact = players.length > 4;
  return (
    <div className="online-players">
      {players.map((p) => {
        const m = p.managerId ? state.managers[p.managerId] : null;
        const c = m?.clubId != null ? state.clubs[m.clubId] : null;
        const me = p.clientId === client?.clientId;
        const status = !p.connected ? 'offline' : p.ready ? 'pronto' : p.managerId ? 'decidindo' : 'assistindo';
        return (
          <span
            key={p.clientId}
            className={`op ${p.connected ? '' : 'off'} ${me ? 'me' : ''}`}
            title={`${p.name}${p.isHost ? ' (anfitrião)' : ''}${c ? ` · ${c.name}` : ''} · ${status}`}
          >
            <span className="op-badge">
              {c ? <ClubBadge club={c} size={22} /> : <span className="op-none">{p.name.slice(0, 1).toUpperCase()}</span>}
              <span className={`op-dot ${p.connected ? 'on' : ''}`} />
            </span>
            {!compact && <span className="op-name">{p.name.split(' ')[0].slice(0, 10)}</span>}
            {p.connected && p.managerId && <span className={`op-ready ${p.ready ? 'yes' : ''}`}>{p.ready ? '✓' : '…'}</span>}
          </span>
        );
      })}
    </div>
  );
}

function TopBar() {
  const { state, manager, club } = useMe();
  const lobby = useApp((s) => s.lobby);
  const client = useApp((s) => s.client)!;
  const host = useApp((s) => s.host);
  const online = useApp((s) => s.online);
  const [confirm, setConfirm] = useState(false);
  if (!state || !lobby) return null;
  const me = lobby.players.find((p) => p.clientId === client.clientId);
  const managers = lobby.players.filter((p) => p.connected && p.managerId);
  const readyCount = managers.filter((p) => p.ready).length;
  const allReady = readyCount === managers.length;
  const nf = club ? nextFixture(state, club.id) : null;
  const opp = nf && club ? state.clubs[nf.home === club.id ? nf.away : nf.home] : null;
  const cal = state.calendar[state.meta.date];

  return (
    <header className="topbar">
      {club ? (
        <>
          <div className="club-strip" style={{ background: `linear-gradient(${club.colors[0]}, ${club.colors[1]})` }} />
          <ClubBadge club={club} size={38} />
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>{club.name}</div>
            <div className="small muted">
              {manager?.name} · {formatMoney(club.balance)}
            </div>
          </div>
        </>
      ) : (
        <div>
          <div style={{ fontWeight: 800 }}>{manager?.name ?? 'Espectador'}</div>
          <div className="small muted">Sem clube</div>
        </div>
      )}
      <div className="grow" />
      <div className="small right">
        <div>
          {cal ? (
            <>
              <b>{dateLabel(state, state.meta.date)}</b> <span className="muted">({cal.wd === 'dom' ? 'domingo' : 'quarta'})</span>
            </>
          ) : (
            'Fim de temporada'
          )}
          {cal?.window && state.meta.settings.windows && <span className="pill good" style={{ marginLeft: 6 }}>janela aberta</span>}
        </div>
        <div className="muted">
          {nf && opp ? (
            nf.date === state.meta.date ? (
              <>
                Hoje: {nf.home === club!.id ? 'x' : '@'} {opp.name} · {compLabel(state, nf.comp)}
              </>
            ) : (
              <>
                Próximo: {nf.home === club!.id ? 'x' : '@'} {opp.name} em {dateLabel(state, nf.date).slice(0, 5)}
              </>
            )
          ) : club ? (
            'Sem jogo hoje'
          ) : null}
        </div>
      </div>
      <PlayersOnline />
      <div className="row" style={{ gap: 6 }}>
        <button className={`btn ${me?.ready ? '' : 'primary'}`} onClick={() => client.ready(!me?.ready)}>
          {me?.ready ? 'Cancelar pronto' : 'Pronto ✓'}
        </button>
        {host && (
          <button className="btn primary" onClick={() => (allReady ? client.hostAction('matchday') : setConfirm(true))}>
            Jogar rodada ▶
          </button>
        )}
        <button className="btn ghost sm" title="Baixar o arquivo do jogo (.pebolim)" onClick={() => void downloadSave()}>
          Baixar save
        </button>
        {online && (
          <span className="pill info" title="Código da sala">
            {lobby.code}
          </span>
        )}
        <button className="btn ghost sm" onClick={() => window.confirm('Sair do jogo? Baixe o save antes, se for o anfitrião.') && leaveGame()}>
          Sair
        </button>
      </div>
      {confirm && (
        <Modal onClose={() => setConfirm(false)}>
          <h2>Nem todos estão prontos</h2>
          <p className="muted">
            Aguardando: {managers.filter((p) => !p.ready).map((p) => p.name).join(', ')}. Começar a rodada mesmo assim?
          </p>
          <div className="row">
            <button
              className="btn primary"
              onClick={() => {
                setConfirm(false);
                client.hostAction('matchday');
              }}
            >
              Começar mesmo assim
            </button>
            <button className="btn ghost" onClick={() => setConfirm(false)}>
              Esperar
            </button>
          </div>
        </Modal>
      )}
    </header>
  );
}
