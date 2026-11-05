import { useMemo, useState } from 'react';
import { MAX_SUBS } from '../../engine/match/core';
import { FORMATION_LIST } from '../../engine/match/formations';
import type { LiveDetail, LiveFrame } from '../../engine/match/live';
import type { Fixture, Formation, GameState, Marking, Mentality, Style, Tactics } from '../../engine/types';
import { dateLabel } from '../../engine/util';
import { useApp, useMe } from '../../store';
import { awayKit, Bar, ClubBadge, compLabel } from '../common';
import { MARKING_LABEL, MENTALITY_LABEL, STYLE_LABEL } from '../screens/Escalacao';
import { PitchCanvas } from './PitchCanvas';

const clock = (t: number, half: 1 | 2) => {
  const m = Math.floor(t / 60);
  if (half === 1 && m >= 45) return `45+${m - 44}'`;
  if (half === 2 && m >= 90) return `90+${m - 89}'`;
  return `${m + 1}'`;
};

export function MatchDay() {
  const { state, club } = useMe();
  const md = useApp((s) => s.md);
  const host = useApp((s) => s.host);
  const client = useApp((s) => s.client)!;
  useApp((s) => s.frameTick);
  const [focus, setFocus] = useState<number | null>(null);
  if (!state || !md) return <div className="hero">Preparando a rodada…</div>;

  const fixtures = md.live.map((id) => state.fixtures[id]).filter(Boolean);
  const mine = club ? fixtures.find((f) => f.home === club.id || f.away === club.id) : undefined;
  const others = fixtures.filter((f) => f !== mine);
  const focused = focus != null ? fixtures.find((f) => f.id === focus) : mine;
  const myDone = mine ? md.done.includes(mine.id) : true;

  return (
    <div className="content" style={{ height: '100vh' }}>
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 className="grow" style={{ margin: 0 }}>
          Dia de jogo · {dateLabel(state, md.date)}
        </h1>
        <span className="muted">
          {md.done.length}/{md.live.length} partidas encerradas
        </span>
        {md.allDone ? (
          host ? (
            <button className="btn primary lg" onClick={() => client.hostAction('continue')}>
              Ver resultados ▶
            </button>
          ) : (
            <span className="pill info">Aguardando o anfitrião continuar</span>
          )
        ) : myDone && mine ? (
          <span className="pill warn">Seu jogo acabou · aguardando os outros</span>
        ) : null}
      </div>
      {fixtures.length === 0 && (
        <div className="panel">Nenhum treinador joga nesta data. Os resultados das outras partidas já foram calculados.</div>
      )}
      {!mine && club && fixtures.length > 0 && <div className="panel muted" style={{ marginBottom: 12 }}>Seu clube não joga hoje. Acompanhe os jogos dos outros treinadores.</div>}
      {focused && (
        <div className="big-match" style={{ marginBottom: 14 }}>
          <MatchCard f={focused} state={state} big />
          {mine && focused.id === mine.id ? (
            <MatchControl f={mine} state={state} side={mine.home === club!.id ? 0 : 1} />
          ) : (
            <div className="panel">
              <button className="btn" onClick={() => setFocus(null)}>
                {mine ? 'Voltar para o meu jogo' : 'Fechar'}
              </button>
            </div>
          )}
        </div>
      )}
      <div className="md-grid">
        {(focused ? fixtures.filter((f) => f.id !== focused.id) : others).map((f) => (
          <div key={f.id} onClick={() => setFocus(f.id)} style={{ cursor: 'pointer' }}>
            <MatchCard f={f} state={state} />
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchCard({ f, state, big }: { f: Fixture; state: GameState; big?: boolean }) {
  const client = useApp((s) => s.client)!;
  const { club } = useMe();
  const buf = client.frames.get(f.id);
  const fr: LiveFrame | undefined = buf?.cur;
  const events = client.events.get(f.id) ?? [];
  const home = state.clubs[f.home];
  const away = state.clubs[f.away];
  const numbers = useMemo(() => {
    const m = new Map<number, number>();
    for (const id in state.players) {
      const p = state.players[id];
      if (p.clubId === f.home || p.clubId === f.away) m.set(p.id, p.num);
    }
    return m;
  }, [state.players, f.home, f.away]);
  const mineIds = useMemo(() => {
    if (!club || (club.id !== f.home && club.id !== f.away)) return undefined;
    const s = new Set<number>();
    for (const [id] of numbers) if (state.players[id]?.clubId === club.id) s.add(id);
    return s;
  }, [club, numbers, f.home, f.away, state.players]);
  const isMine = !!mineIds;
  const visible = events.filter((e) => e.kind !== 'tactic').slice(-(big ? 12 : 4)).reverse();
  const manager = (cid: number) => {
    const c = state.clubs[cid];
    return c.managerId ? state.managers[c.managerId]?.name : null;
  };
  const comp = state.comps[f.comp];
  const kit = useMemo(() => awayKit(home.colors, away.colors), [home.colors, away.colors]);

  return (
    <div className={`md-card ${isMine ? 'mine' : ''}`}>
      <div className="md-head">
        <ClubBadge club={home} size={big ? 34 : 26} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="nowrap" style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {home.name}
          </div>
          <div className="small faint nowrap">{manager(f.home) ?? 'IA'}</div>
        </div>
        <div className="md-score">
          {fr ? `${fr.sc[0]} - ${fr.sc[1]}` : '0 - 0'}
          <div className="small muted" style={{ fontWeight: 600, fontSize: 11 }}>
            {fr ? (fr.ended ? 'Encerrado' : fr.paused ? 'Pausado' : clock(fr.t, fr.half)) : 'Início'}
            {fr?.pens && ` · pên. ${fr.pens[0]}-${fr.pens[1]}`}
          </div>
        </div>
        <div className="grow right" style={{ minWidth: 0 }}>
          <div className="nowrap" style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {away.name}
          </div>
          <div className="small faint nowrap">{manager(f.away) ?? 'IA'}</div>
        </div>
        <ClubBadge club={away} size={big ? 34 : 26} />
      </div>
      <PitchCanvas fixtureId={f.id} homeColors={home.colors} awayColors={kit} numbers={numbers} big={big} mine={mineIds} />
      {fr && (
        <div className="md-stats">
          <span className="right">{fr.poss}%</span>
          <span className="k">posse</span>
          <span>{100 - fr.poss}%</span>
          <span className="right">
            {fr.shots[0]} ({fr.onT[0]})
          </span>
          <span className="k">finalizações (no gol)</span>
          <span>
            {fr.shots[1]} ({fr.onT[1]})
          </span>
          <span className="right">
            {fr.cards[0]}🟨 {fr.cards[2] > 0 && `${fr.cards[2]}🟥`}
          </span>
          <span className="k">cartões</span>
          <span>
            {fr.cards[1]}🟨 {fr.cards[3] > 0 && `${fr.cards[3]}🟥`}
          </span>
        </div>
      )}
      <div className="md-events">
        <div className="faint small" style={{ marginBottom: 2 }}>
          {comp?.cfg.short}
          {f.stage != null && comp ? ` · ${comp.stages[f.stage]?.name}` : ''}
        </div>
        {visible.map((e, i) => (
          <div key={i} className={e.kind === 'goal' ? 'good' : e.kind === 'red' ? 'bad' : ''}>
            <span className="faint num">{Math.floor(e.t / 60) + 1}'</span> {e.kind === 'goal' ? '⚽' : e.kind === 'yellow' ? '🟨' : e.kind === 'red' ? '🟥' : e.kind === 'sub' ? '🔁' : e.kind === 'injury' ? '🚑' : '·'}{' '}
            {e.text} {e.kind !== 'ht' && e.kind !== 'ft' && e.kind !== 'pens' && <span className="faint">({e.side === 0 ? home.short : away.short})</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchControl({ f, state, side }: { f: Fixture; state: GameState; side: 0 | 1 }) {
  const client = useApp((s) => s.client)!;
  const detail: LiveDetail | undefined = client.details.get(f.id);
  const fr = client.frames.get(f.id)?.cur;
  const [out, setOut] = useState<number | null>(null);
  const [inn, setInn] = useState<number | null>(null);
  const [t, setT] = useState<Tactics | null>(null);
  const d = detail?.sides[side];
  if (!d || !fr) return <div className="panel">Conectando à partida…</div>;
  const tactics = t ?? d.tactics;
  const name = (id: number) => state.players[id]?.name ?? '?';
  const pos = (id: number) => state.players[id]?.pos ?? '';
  const ended = fr.ended;
  const pausedByMe = fr.paused && fr.pausedBy === side;
  const act = (a: Parameters<typeof client.match>[1]) => client.match(f.id, a);

  return (
    <div className="panel col">
      <div className="row">
        {fr.paused ? (
          <button className="btn primary" disabled={!pausedByMe || ended} onClick={() => act({ a: 'resume' })}>
            ▶ Retomar
          </button>
        ) : (
          <button className="btn" disabled={ended || d.pauses >= 3} onClick={() => act({ a: 'pause' })}>
            ⏸ Pausar ({3 - d.pauses} restantes)
          </button>
        )}
        <button className="btn ghost" disabled={ended} onClick={() => window.confirm('Simular o resto do jogo instantaneamente?') && act({ a: 'quick' })}>
          ⏩ Simular rápido
        </button>
      </div>
      {fr.paused && !pausedByMe && <div className="small warn">Pausado pelo adversário. Você também pode mexer no time agora.</div>}
      <div className="small muted">Mudanças valem na hora, mesmo sem pausar. Pausar só para o seu jogo.</div>

      <h3 style={{ marginTop: 6 }}>
        Substituições ({d.subs}/{MAX_SUBS})
      </h3>
      <div className="col" style={{ gap: 4 }}>
        {d.onPitch.map((id, i) =>
          id == null ? null : (
            <div key={id} className={`row small ${out === id ? 'good' : ''}`} style={{ cursor: 'pointer', gap: 6 }} onClick={() => setOut(id)}>
              <span className={`pos pos-${pos(id)}`}>{pos(id)}</span>
              <span className="grow">
                {name(id)} {d.yel.includes(id) && '🟨'}
              </span>
              <div style={{ width: 60 }}>
                <Bar v={d.fit[id] ?? 0} />
              </div>
              <span className="faint" style={{ width: 16 }}>
                {i === 0 ? '' : ''}
              </span>
            </div>
          ),
        )}
      </div>
      <div className="small faint">Banco:</div>
      <div className="col" style={{ gap: 4 }}>
        {d.bench
          .filter((id) => !d.off.includes(id))
          .map((id) => (
            <div key={id} className={`row small ${inn === id ? 'good' : ''}`} style={{ cursor: 'pointer', gap: 6 }} onClick={() => setInn(id)}>
              <span className={`pos pos-${pos(id)}`}>{pos(id)}</span>
              <span className="grow">{name(id)}</span>
              <span className="faint num">{Math.round(state.players[id]?.str ?? 0)}</span>
            </div>
          ))}
      </div>
      <button
        className="btn primary"
        disabled={ended || out == null || inn == null || d.subs >= MAX_SUBS}
        onClick={() => {
          act({ a: 'sub', out: out!, in: inn! });
          setOut(null);
          setInn(null);
        }}
      >
        {out != null && inn != null ? `Sai ${name(out).split(' ').slice(-1)[0]}, entra ${name(inn).split(' ').slice(-1)[0]}` : 'Escolha quem sai e quem entra'}
      </button>

      <h3 style={{ marginTop: 6 }}>Tática</h3>
      <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <select value={tactics.formation} onChange={(e) => setT({ ...tactics, formation: e.target.value as Formation })}>
          {FORMATION_LIST.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select value={tactics.mentality} onChange={(e) => setT({ ...tactics, mentality: e.target.value as Mentality })}>
          {Object.entries(MENTALITY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select value={tactics.marking} onChange={(e) => setT({ ...tactics, marking: e.target.value as Marking })}>
          {Object.entries(MARKING_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select value={tactics.style} onChange={(e) => setT({ ...tactics, style: e.target.value as Style })}>
          {Object.entries(STYLE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <button
        className="btn"
        disabled={ended || !t}
        onClick={() => {
          act({ a: 'tactics', tactics });
          setT(null);
        }}
      >
        Aplicar tática
      </button>
      <div className="small faint">{compLabel(state, f.comp)}</div>
    </div>
  );
}
