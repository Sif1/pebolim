import { useMemo, useState } from 'react';
import { bottomLeagues } from '../engine/commands';
import type { Club, GameState } from '../engine/types';
import { formatMoney } from '../engine/util';
import { leaveGame, useApp } from '../store';
import { ClubBadge, COUNTRY_NAME, compLabel, Modal, Str } from './common';

export function Lobby() {
  const state = useApp((s) => s.state)!;
  const lobby = useApp((s) => s.lobby);
  const managerId = useApp((s) => s.managerId);
  const client = useApp((s) => s.client)!;
  const host = useApp((s) => s.host);
  const online = useApp((s) => s.online);
  if (!lobby) return <div className="hero">Conectando à sala…</div>;
  const me = managerId ? state.managers[managerId] : null;
  const myClub = me?.clubId != null ? state.clubs[me.clubId] : null;
  const link = `${location.origin}${location.pathname}#/join/${lobby.code}`;

  return (
    <div className="content" style={{ height: '100vh' }}>
      <div className="row" style={{ marginBottom: 14 }}>
        <div className="logo" style={{ fontSize: 26 }}>
          Pebolim <span>Manager</span>
        </div>
        <div className="grow" />
        <button className="btn ghost" onClick={leaveGame}>
          Sair
        </button>
      </div>
      <div className="grid2" style={{ alignItems: 'start', gridTemplateColumns: 'minmax(280px, 360px) 1fr' }}>
        <div className="col">
          <div className="panel col">
            <h3>Sala</h3>
            {host && !online ? (
              <div className="muted">Jogo offline (só você).</div>
            ) : (
              <>
                <div className="row">
                  <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: '0.18em' }}>{lobby.code}</span>
                  <button className="btn sm" onClick={() => void navigator.clipboard?.writeText(link)}>
                    Copiar link
                  </button>
                </div>
                <div className="small muted">Os amigos entram em “Entrar numa sala” com esse código.</div>
              </>
            )}
            <div className="small muted">
              {state.meta.name} · temporada {state.meta.season} · partidas de {state.meta.settings.matchMinutes} min
            </div>
          </div>
          <div className="panel col">
            <h3>Jogadores</h3>
            {lobby.players.map((p) => {
              const m = p.managerId ? state.managers[p.managerId] : null;
              const c = m?.clubId != null ? state.clubs[m.clubId] : null;
              return (
                <div key={p.clientId} className="row" style={{ opacity: p.connected ? 1 : 0.5 }}>
                  <ClubBadge club={c} size={26} />
                  <div className="grow">
                    <b>{p.name}</b> {p.isHost && <span className="pill info">anfitrião</span>}
                    <div className="small muted">{c ? c.name : m ? 'Desempregado' : 'Escolhendo clube…'}</div>
                  </div>
                  {!p.connected && <span className="pill">offline</span>}
                </div>
              );
            })}
          </div>
          {myClub && (
            <div className="panel col">
              <h3>Seu clube</h3>
              <div className="row">
                <ClubBadge club={myClub} size={42} />
                <div>
                  <b style={{ fontSize: 17 }}>{myClub.name}</b>
                  <div className="small muted">{myClub.league ? compLabel(state, myClub.league) : ''}</div>
                </div>
              </div>
              {host ? (
                <button className="btn primary lg" onClick={() => client.hostAction('start')}>
                  Começar o jogo
                </button>
              ) : (
                <div className="muted">Aguardando o anfitrião começar…</div>
              )}
            </div>
          )}
          {!myClub && host && lobby.players.some((p) => p.managerId) && (
            <button className="btn primary" onClick={() => client.hostAction('start')}>
              Começar o jogo
            </button>
          )}
        </div>
        {!me ? <ClaimPanel /> : <div className="panel muted">Clube escolhido. Enquanto os outros escolhem, confira o elenco depois que o jogo começar.</div>}
      </div>
    </div>
  );
}

/** Pick a club (or resume a manager) according to the session rules. */
export function ClaimPanel() {
  const state = useApp((s) => s.state)!;
  const lobby = useApp((s) => s.lobby)!;
  const client = useApp((s) => s.client)!;
  const [creating, setCreating] = useState(false);
  const takenManagers = new Set(lobby.players.filter((p) => p.connected && p.managerId).map((p) => p.managerId!));

  if (!lobby.newGame) {
    const managers = Object.values(state.managers).filter((m) => !takenManagers.has(m.id));
    const open = Object.values(state.clubs).filter((c) => c.upForSelection && !c.managerId && c.league);
    return (
      <div className="col">
        <div className="panel col">
          <h2>Treinadores desta carreira</h2>
          <div className="small muted">Reassuma o seu treinador (com o clube que ele tinha) ou um que esteja livre.</div>
          {managers.length === 0 && <div className="muted">Nenhum treinador disponível.</div>}
          {managers.map((m) => {
            const c = m.clubId != null ? state.clubs[m.clubId] : null;
            return (
              <div key={m.id} className="row panel tight">
                <ClubBadge club={c} size={32} />
                <div className="grow">
                  <b>{m.name}</b>
                  <div className="small muted">
                    {c ? `${c.name} · ${c.league ? compLabel(state, c.league) : ''}` : 'Desempregado'} · reputação {Math.round(m.rep)}
                  </div>
                </div>
                <button className="btn primary" onClick={() => client.claim({ kind: 'resume', managerId: m.id })}>
                  Continuar como {m.name.split(' ')[0]}
                </button>
              </div>
            );
          })}
        </div>
        <div className="panel col">
          <h2>Clubes disponíveis</h2>
          <div className="small muted">Clubes que ficaram sem treinador (demissão ou troca de clube) estão livres para um novo treinador.</div>
          {open.length === 0 && <div className="muted">Nenhum clube disponível no momento.</div>}
          <ClubTable clubs={open} state={state} onPick={(c) => client.claim({ kind: 'club', clubId: c.id })} />
        </div>
        <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => client.claim({ kind: 'spectate' })}>
          Só assistir
        </button>
      </div>
    );
  }

  const pickable = Object.values(state.clubs).filter((c) => c.league && !c.contOnly);
  return (
    <div className="col">
      <div className="panel col">
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>
            Escolha seu clube
          </h2>
          <button className="btn" onClick={() => setCreating(true)}>
            + Criar meu próprio clube
          </button>
        </div>
        <ClubBrowser clubs={pickable} state={state} onPick={(c) => client.claim({ kind: 'club', clubId: c.id })} />
      </div>
      {creating && <CreateClub onClose={() => setCreating(false)} />}
    </div>
  );
}

function ClubBrowser({ clubs, state, onPick }: { clubs: Club[]; state: GameState; onPick: (c: Club) => void }) {
  const leagues = useMemo(() => state.config.filter((c) => c.kind === 'league'), [state.config]);
  const [league, setLeague] = useState(leagues[0]?.id ?? '');
  const [q, setQ] = useState('');
  const list = clubs.filter((c) => (q ? c.name.toLowerCase().includes(q.toLowerCase()) : c.league === league));
  return (
    <div className="col">
      <div className="row">
        <select value={league} onChange={(e) => (setLeague(e.target.value), setQ(''))}>
          {leagues.map((l) => (
            <option key={l.id} value={l.id}>
              {COUNTRY_NAME[l.country ?? ''] ?? l.country} — {l.name}
            </option>
          ))}
        </select>
        <input type="search" placeholder="Buscar clube…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ClubTable clubs={list} state={state} onPick={onPick} />
    </div>
  );
}

function ClubTable({ clubs, state, onPick }: { clubs: Club[]; state: GameState; onPick: (c: Club) => void }) {
  const sorted = [...clubs].sort((a, b) => b.power - a.power);
  return (
    <div className="scroll" style={{ maxHeight: '60vh' }}>
      <table className="t">
        <thead>
          <tr>
            <th>Clube</th>
            <th>Liga</th>
            <th className="center">Força</th>
            <th className="center">Reputação</th>
            <th className="right">Caixa</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => {
            const taken = !!c.managerId;
            const m = taken ? state.managers[c.managerId!] : null;
            return (
              <tr key={c.id}>
                <td>
                  <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                    <ClubBadge club={c} size={24} />
                    <span>
                      {c.name}
                      <div className="small faint">{c.city}</div>
                    </span>
                  </span>
                </td>
                <td className="small">{c.league ? compLabel(state, c.league) : '—'}</td>
                <td className="center">
                  <Str v={c.power} />
                </td>
                <td className="center num">{Math.round(c.rep)}</td>
                <td className="right small">{formatMoney(c.balance)}</td>
                <td className="right">
                  {taken ? (
                    <span className="pill">{m?.name ?? 'ocupado'}</span>
                  ) : (
                    <button className="btn sm primary" onClick={() => onPick(c)}>
                      Escolher
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CreateClub({ onClose }: { onClose: () => void }) {
  const state = useApp((s) => s.state)!;
  const client = useApp((s) => s.client)!;
  const bottoms = bottomLeagues(state);
  const [league, setLeague] = useState(bottoms.find((b) => b.startsWith('BRA')) ?? bottoms[0]);
  const options = Object.values(state.clubs)
    .filter((c) => c.league === league && !c.managerId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const [replace, setReplace] = useState<number>(options[0]?.id ?? 0);
  const [name, setName] = useState('');
  const [short, setShort] = useState('');
  const [c1, setC1] = useState('#16a34a');
  const [c2, setC2] = useState('#ffffff');
  const [city, setCity] = useState('');
  const [stadium, setStadium] = useState('');
  const preview = { short: (short || name.slice(0, 3)).toUpperCase() || '???', colors: [c1, c2] as [string, string] };
  const rep = options.find((o) => o.id === replace) ?? options[0];

  return (
    <Modal onClose={onClose}>
      <h2>Criar meu clube</h2>
      <div className="small muted" style={{ marginBottom: 12 }}>
        Seu clube entra na última divisão do país escolhido, no lugar de um clube que você escolhe. O elenco é gerado no nível da divisão e o caixa é pequeno.
      </div>
      <div className="col">
        <div className="row">
          <ClubBadge club={preview} size={56} />
          <div className="col grow" style={{ gap: 6 }}>
            <input type="text" placeholder="Nome do clube" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
            <div className="row">
              <input type="text" placeholder="Sigla" value={short} maxLength={4} style={{ width: 80 }} onChange={(e) => setShort(e.target.value)} />
              <input type="color" value={c1} onChange={(e) => setC1(e.target.value)} title="Cor principal" />
              <input type="color" value={c2} onChange={(e) => setC2(e.target.value)} title="Cor secundária" />
            </div>
          </div>
        </div>
        <div className="grid2">
          <label className="field">
            Cidade
            <input type="text" value={city} maxLength={32} onChange={(e) => setCity(e.target.value)} />
          </label>
          <label className="field">
            Estádio
            <input type="text" value={stadium} maxLength={40} onChange={(e) => setStadium(e.target.value)} />
          </label>
          <label className="field">
            Divisão
            <select
              value={league}
              onChange={(e) => {
                setLeague(e.target.value);
                const first = Object.values(state.clubs).find((c) => c.league === e.target.value && !c.managerId);
                setReplace(first?.id ?? 0);
              }}
            >
              {bottoms.map((b) => (
                <option key={b} value={b}>
                  {compLabel(state, b)} ({COUNTRY_NAME[state.config.find((c) => c.id === b)?.country ?? ''] ?? ''})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Substitui o clube
            <select value={replace} onChange={(e) => setReplace(Number(e.target.value))}>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {rep && <div className="small muted">Você herda a vaga, a cidade-base para viagens e o calendário do {rep.name}.</div>}
        <div className="row">
          <button
            className="btn primary"
            disabled={name.trim().length < 3 || !replace}
            onClick={() => {
              client.claim({
                kind: 'create',
                spec: { name, short: short || name.slice(0, 3), colors: [c1, c2], city, stadium, replaceClubId: replace },
              });
              onClose();
            }}
          >
            Criar e assumir
          </button>
          <button className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </div>
    </Modal>
  );
}
