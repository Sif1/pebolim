import { useState } from 'react';
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
import { Painel } from './screens/Painel';
import { Propostas } from './screens/Propostas';
import { Resumo } from './screens/Resumo';
import { Temporada } from './screens/Temporada';
import { Treinador } from './screens/Treinador';

const NAV: { group: string; items: { id: Screen; label: string; needsClub?: boolean }[] }[] = [
  {
    group: 'Clube',
    items: [
      { id: 'painel', label: 'Painel' },
      { id: 'elenco', label: 'Elenco', needsClub: true },
      { id: 'escalacao', label: 'Escalação e tática', needsClub: true },
      { id: 'estrutura', label: 'Estádio, CT e viagens', needsClub: true },
      { id: 'financas', label: 'Finanças', needsClub: true },
    ],
  },
  {
    group: 'Mercado',
    items: [
      { id: 'mercado', label: 'Buscar jogadores', needsClub: true },
      { id: 'propostas', label: 'Propostas', needsClub: true },
      { id: 'contratos', label: 'Contratos', needsClub: true },
    ],
  },
  {
    group: 'Futebol',
    items: [
      { id: 'resumo', label: 'Resumo da rodada' },
      { id: 'competicoes', label: 'Competições' },
      { id: 'calendario', label: 'Calendário', needsClub: true },
      { id: 'noticias', label: 'Notícias' },
      { id: 'temporada', label: 'Temporadas' },
      { id: 'treinador', label: 'Treinador' },
    ],
  },
];

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
        return <Mercado />;
      case 'propostas':
        return <Propostas />;
      case 'contratos':
        return <Contratos />;
      case 'financas':
        return <Financas />;
      case 'estrutura':
        return <Estrutura />;
      case 'competicoes':
        return <Competicoes />;
      case 'calendario':
        return <Calendario />;
      case 'noticias':
        return <Noticias />;
      case 'resumo':
        return <Resumo />;
      case 'temporada':
        return <Temporada />;
      case 'treinador':
        return <Treinador />;
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
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="group">{g.group}</div>
            {g.items
              .filter((it) => !it.needsClub || club)
              .map((it) => {
                const count = it.id === 'propostas' ? pendingBids + counters : it.id === 'treinador' ? offers : 0;
                return (
                  <button key={it.id} className={screen === it.id ? 'active' : ''} onClick={() => setScreen(it.id)}>
                    {it.label}
                    {count > 0 && <span className="count">{count}</span>}
                  </button>
                );
              })}
          </div>
        ))}
      </nav>
      <main className="content">{body}</main>
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
      <div className="row" style={{ gap: 6 }}>
        <span className="small muted" title={managers.map((p) => `${p.name}: ${p.ready ? 'pronto' : 'aguardando'}`).join('\n')}>
          Prontos {readyCount}/{managers.length}
        </span>
        <button className={`btn ${me?.ready ? '' : 'primary'}`} onClick={() => client.ready(!me?.ready)}>
          {me?.ready ? 'Cancelar pronto' : 'Pronto ✓'}
        </button>
        {host && (
          <button className="btn primary" onClick={() => (allReady ? client.hostAction('matchday') : setConfirm(true))}>
            Jogar rodada ▶
          </button>
        )}
        <button className="btn" title="Baixar o arquivo do jogo (.pebolim)" onClick={() => void downloadSave()}>
          Baixar save
        </button>
        {online && <span className="pill info" title="Código da sala">{lobby.code}</span>}
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
