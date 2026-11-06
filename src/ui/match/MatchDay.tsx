import { useMemo, useState, type ReactNode } from 'react';
import { MAX_SUBS } from '../../engine/match/core';
import { FORMATION_LIST, shapeLabel } from '../../engine/match/formations';
import type { LiveDetail, LiveFrame } from '../../engine/match/live';
import type { Club, Fixture, Formation, GameState, Marking, Mentality, Style, Tactics } from '../../engine/types';
import { dateLabel } from '../../engine/util';
import { MATCH_MINUTES } from '../../net/validate';
import { useApp, useMe } from '../../store';
import { awayKit, ClubBadge, compLabel, Energy, Rating } from '../common';
import { MARKING_LABEL, MENTALITY_LABEL, STYLE_LABEL } from '../screens/Escalacao';
import { dragProps, dropProps, moveSlotTo, TacticsBoard, type BoardToken, type DragSrc, type DropTarget } from '../TacticsBoard';
import { PitchCanvas } from './PitchCanvas';

const clock = (t: number, half: 1 | 2) => {
  const m = Math.floor(t / 60);
  if (half === 1 && m >= 45) return `45+${m - 44}'`;
  if (half === 2 && m >= 90) return `90+${m - 89}'`;
  return `${m + 1}'`;
};

const lastName = (n: string) => n.split(' ').slice(-1)[0];

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
  const focused = focus != null ? fixtures.find((f) => f.id === focus) : (mine ?? fixtures[0]);
  const myDone = mine ? md.done.includes(mine.id) : true;
  const minutes = state.meta.settings.matchMinutes;

  return (
    <div className="content" style={{ height: '100vh' }}>
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 className="grow" style={{ margin: 0 }}>
          Dia de jogo · {dateLabel(state, md.date)}
        </h1>
        <label className="row small muted" style={{ gap: 6 }} title={host ? 'Vale para todas as partidas, na hora' : 'Só o anfitrião muda'}>
          Duração
          {host ? (
            <select value={minutes} onChange={(e) => client.setMatchMinutes(Number(e.target.value))}>
              {MATCH_MINUTES.map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          ) : (
            <b>{minutes} min</b>
          )}
        </label>
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
      {!mine && club && fixtures.length > 0 && (
        <div className="panel muted" style={{ marginBottom: 12 }}>
          Seu clube não joga hoje. Acompanhe os jogos dos outros treinadores.
        </div>
      )}
      {focused && (
        <div className="match-focus" style={{ marginBottom: 14 }}>
          <div className="col" style={{ gap: 0, minWidth: 0 }}>
            <MatchView f={focused} state={state} big />
          </div>
          <StatsPanel f={focused} state={state} />
          {mine && focused.id === mine.id ? (
            <MatchControl f={mine} state={state} side={mine.home === club!.id ? 0 : 1} />
          ) : (
            <Lineups f={focused} state={state} onBack={mine ? () => setFocus(null) : undefined} />
          )}
        </div>
      )}
      {fixtures.length > 1 && (
        <>
          <div className="small faint" style={{ marginBottom: 6 }}>
            Outras partidas ao vivo (clique para ampliar)
          </div>
          <div className="md-grid">
            {fixtures
              .filter((f) => f.id !== focused?.id)
              .map((f) => (
                <div key={f.id} onClick={() => setFocus(f.id)} style={{ cursor: 'pointer' }}>
                  <MatchView f={f} state={state} />
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}

function useMatchMaps(f: Fixture, state: GameState) {
  const { club } = useMe();
  const numbers = useMemo(() => {
    const m = new Map<number, number>();
    for (const id in state.players) {
      const p = state.players[id];
      if (p.clubId === f.home || p.clubId === f.away) m.set(p.id, p.num);
    }
    return m;
  }, [state.players, f.home, f.away]);
  const names = useMemo(() => {
    const m = new Map<number, string>();
    for (const [id] of numbers) m.set(id, lastName(state.players[id]?.name ?? ''));
    return m;
  }, [numbers, state.players]);
  const mineIds = useMemo(() => {
    if (!club || (club.id !== f.home && club.id !== f.away)) return undefined;
    const s = new Set<number>();
    for (const [id] of numbers) if (state.players[id]?.clubId === club.id) s.add(id);
    return s;
  }, [club, numbers, f.home, f.away, state.players]);
  return { numbers, names, mineIds };
}

/** Scoreboard, pitch and commentary for one live match. */
function MatchView({ f, state, big }: { f: Fixture; state: GameState; big?: boolean }) {
  const client = useApp((s) => s.client)!;
  const fr: LiveFrame | undefined = client.frames.get(f.id)?.cur;
  const events = client.events.get(f.id) ?? [];
  const home = state.clubs[f.home];
  const away = state.clubs[f.away];
  const kit = useMemo(() => awayKit(home.colors, away.colors), [home.colors, away.colors]);
  const { numbers, names, mineIds } = useMatchMaps(f, state);
  const comp = state.comps[f.comp];
  // tactical changes (the AI coach's and the managers') only show on the big view
  const visible = events.filter((e) => big || e.kind !== 'tactic').slice(-(big ? 10 : 2)).reverse();
  const manager = (c: Club) => (c.managerId ? state.managers[c.managerId]?.name : null);
  const last = visible[0];

  return (
    <div className={`md-card ${mineIds ? 'mine' : ''} ${big ? 'big' : ''}`}>
      <div className="scoreboard">
        <div className="sb-team">
          <span className="sb-chip" style={{ background: home.colors[0], borderColor: home.colors[1] }} />
          <span className="sb-name">{big ? home.name : home.short}</span>
          {big && <span className="sb-mgr">{manager(home) ?? 'IA'}</span>}
        </div>
        <div className="sb-score">
          {fr ? fr.sc[0] : 0}
          <span>–</span>
          {fr ? fr.sc[1] : 0}
        </div>
        <div className="sb-team right">
          {big && <span className="sb-mgr">{manager(away) ?? 'IA'}</span>}
          <span className="sb-name">{big ? away.name : away.short}</span>
          <span className="sb-chip" style={{ background: kit[0], borderColor: kit[1] }} />
        </div>
        <div className="sb-clock">
          {fr ? (fr.ended ? 'FIM' : fr.paused ? 'PAUSA' : clock(fr.t, fr.half)) : '0\''}
          {fr?.pens && ` · pên. ${fr.pens[0]}-${fr.pens[1]}`}
        </div>
      </div>
      <PitchCanvas fixtureId={f.id} homeColors={home.colors} awayColors={kit} numbers={numbers} names={names} big={big} mine={mineIds} />
      <div className="ticker">
        {last ? (
          <span className={last.kind === 'goal' ? 'good' : last.kind === 'red' ? 'bad' : ''}>
            <span className="faint num">{Math.floor(last.t / 60) + 1}'</span> {last.text}
          </span>
        ) : (
          <span className="faint">
            {comp?.cfg.short}
            {f.stage != null && comp ? ` · ${comp.stages[f.stage]?.name}` : ''}
          </span>
        )}
      </div>
      {!big && fr && (
        <div className="md-stats">
          <StatRow k="Posse" a={`${fr.poss}%`} b={`${100 - fr.poss}%`} />
          <StatRow k="Finalizações" a={fr.shots[0]} b={fr.shots[1]} />
          <StatRow k="xG" a={(fr.x.xg[0] / 100).toFixed(2)} b={(fr.x.xg[1] / 100).toFixed(2)} />
        </div>
      )}
      {big && (
        <div className="md-events">
          {visible.slice(1).map((e, i) => (
            <div key={i} className={e.kind === 'goal' ? 'good' : e.kind === 'red' ? 'bad' : ''}>
              <span className="faint num">{Math.floor(e.t / 60) + 1}'</span>{' '}
              {e.kind === 'goal' ? '⚽' : e.kind === 'yellow' ? '🟨' : e.kind === 'red' ? '🟥' : e.kind === 'sub' ? '🔁' : e.kind === 'injury' ? '🚑' : e.kind === 'tactic' ? '📋' : '·'}{' '}
              <span className={e.kind === 'tactic' ? 'info' : ''}>{e.text}</span>{' '}
              {e.kind !== 'ht' && e.kind !== 'ft' && e.kind !== 'pens' && e.kind !== 'tactic' && <span className="faint">({e.side === 0 ? home.short : away.short})</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatRow({ k, a, b }: { k: string; a: ReactNode; b: ReactNode }) {
  return (
    <>
      <span className="right num">{a}</span>
      <span className="k">{k}</span>
      <span className="num">{b}</span>
    </>
  );
}

/** Comparative bar row: home value | label | away value. */
function Cmp({ k, a, b, fmt = (v) => String(v), title }: { k: string; a: number; b: number; fmt?: (v: number) => string; title?: string }) {
  const tot = a + b;
  const pa = tot > 0 ? (a / tot) * 100 : 50;
  return (
    <div className="cmp" title={title}>
      <div className="cmp-row">
        <span className={`num ${a > b ? 'lead' : ''}`}>{fmt(a)}</span>
        <span className="k">{k}</span>
        <span className={`num ${b > a ? 'lead' : ''}`}>{fmt(b)}</span>
      </div>
      <div className="cmp-bar">
        <div style={{ width: `${pa}%` }} />
      </div>
    </div>
  );
}

function StatsPanel({ f, state }: { f: Fixture; state: GameState }) {
  const client = useApp((s) => s.client)!;
  const fr = client.frames.get(f.id)?.cur;
  const detail = client.details.get(f.id);
  if (!fr) return <div className="panel small muted">Aguardando o início…</div>;
  const x = fr.x;
  const acc = (i: 0 | 1) => {
    const t = x.pas[i] + x.pf[i];
    return t ? Math.round((x.pas[i] / t) * 100) : 0;
  };
  const tops = detail
    ? detail.sides
        .flatMap((s, side) => Object.entries(s.rt).map(([id, r]) => ({ id: Number(id), r: r / 10, side })))
        .sort((a, b) => b.r - a.r)
        .slice(0, 3)
    : [];
  return (
    <div className="panel stats-panel">
      <div className="row small" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <b>{state.clubs[f.home].short}</b>
        <span className="faint">Estatísticas</span>
        <b>{state.clubs[f.away].short}</b>
      </div>
      <Cmp k="Posse" a={fr.poss} b={100 - fr.poss} fmt={(v) => `${v}%`} />
      <Cmp k="Finalizações" a={fr.shots[0]} b={fr.shots[1]} />
      <Cmp k="No gol" a={fr.onT[0]} b={fr.onT[1]} />
      <Cmp k="xG" a={x.xg[0] / 100} b={x.xg[1] / 100} fmt={(v) => v.toFixed(2)} title="Gols esperados: soma da qualidade das chances criadas" />
      <Cmp k="Chances claras" a={x.bc[0]} b={x.bc[1]} />
      <Cmp k="Passes certos" a={x.pas[0]} b={x.pas[1]} />
      <Cmp k="Passes errados" a={x.pf[0]} b={x.pf[1]} />
      <Cmp k="Precisão de passe" a={acc(0)} b={acc(1)} fmt={(v) => `${v}%`} />
      <Cmp k="Desarmes" a={x.tk[0]} b={x.tk[1]} />
      <Cmp k="Defesas do goleiro" a={x.sv[0]} b={x.sv[1]} />
      <Cmp k="Escanteios" a={x.co[0]} b={x.co[1]} />
      <Cmp k="Faltas" a={x.fo[0]} b={x.fo[1]} />
      <Cmp k="Cartões" a={fr.cards[0] + fr.cards[2]} b={fr.cards[1] + fr.cards[3]} fmt={(v) => String(v)} />
      {tops.length > 0 && (
        <>
          <div className="small faint" style={{ marginTop: 8 }}>
            Destaques
          </div>
          {tops.map((t) => (
            <div key={t.id} className="row small" style={{ gap: 6 }}>
              <ClubBadge club={state.clubs[t.side === 0 ? f.home : f.away]} size={16} />
              <span className="grow nowrap">{state.players[t.id]?.name ?? '?'}</span>
              <Rating v={t.r} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/** Spectating someone else's match: both line-ups with energy and ratings. */
function Lineups({ f, state, onBack }: { f: Fixture; state: GameState; onBack?: () => void }) {
  const client = useApp((s) => s.client)!;
  const d = client.details.get(f.id);
  return (
    <div className="panel col">
      {onBack && (
        <button className="btn sm" onClick={onBack} style={{ alignSelf: 'flex-start' }}>
          ← Voltar para o meu jogo
        </button>
      )}
      {!d && <div className="small muted">Carregando escalações…</div>}
      {d?.sides.map((s, side) => (
        <div key={side}>
          <h3 style={{ margin: '4px 0' }}>
            {state.clubs[side === 0 ? f.home : f.away].name} <span className="faint small">{shapeLabel(s.tactics)}</span>
          </h3>
          <PlayerRows d={s} state={state} ids={s.onPitch.filter((x): x is number => x != null)} />
        </div>
      ))}
    </div>
  );
}

function PlayerRows({
  d,
  state,
  ids,
  onDropRow,
  drag,
  selected,
  onClick,
}: {
  d: LiveDetail['sides'][number];
  state: GameState;
  ids: number[];
  onDropRow?: (src: DragSrc, id: number) => void;
  drag?: boolean;
  selected?: number | null;
  onClick?: (id: number) => void;
}) {
  return (
    <table className="t compact">
      <tbody>
        {ids.map((id) => {
          const p = state.players[id];
          const off = d.off.includes(id);
          return (
            <tr
              key={id}
              className={`${onClick ? 'click' : ''} ${selected === id ? 'me' : ''}`}
              style={{ opacity: off ? 0.45 : 1 }}
              onClick={() => onClick?.(id)}
              {...(drag && !off ? dragProps({ kind: 'player', pid: id, from: 'bench' }) : {})}
              {...(onDropRow ? dropProps((src) => onDropRow(src, id), (src) => src.kind === 'player') : {})}
            >
              <td style={{ width: 38 }}>
                <span className={`pos pos-${p?.pos}`}>{p?.pos}</span>
              </td>
              <td className="nowrap" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {p?.name ?? '?'} {d.yel.includes(id) && '🟨'}
              </td>
              <td style={{ width: 96 }}>
                <Energy v={d.fit[id] ?? 0} w={40} />
              </td>
              <td className="right" style={{ width: 36 }}>
                <Rating v={d.rt[id] != null ? d.rt[id] / 10 : null} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
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
  const ended = fr.ended;
  const pausedByMe = fr.paused && fr.pausedBy === side;
  const act = (a: Parameters<typeof client.match>[1]) => client.match(f.id, a);
  const club = state.clubs[side === 0 ? f.home : f.away];
  const colors = side === 0 ? club.colors : awayKit(state.clubs[f.home].colors, club.colors);
  const subsLeft = d.subs < MAX_SUBS;
  const bench = d.bench.filter((id) => !d.off.includes(id));

  const sub = (outId: number, inId: number) => {
    if (ended || !subsLeft) return;
    act({ a: 'sub', out: outId, in: inId });
    setOut(null);
    setInn(null);
  };

  const onDrop = (target: DropTarget, src: DragSrc) => {
    if (ended) return;
    if (target.kind === 'cell') {
      if (src.kind !== 'slot') return;
      const shape = moveSlotTo(d.tactics, src.slot, target.cell);
      if (shape) act({ a: 'tactics', tactics: { ...d.tactics, shape } });
      return;
    }
    if (src.kind === 'slot') return act({ a: 'swap', s1: src.slot, s2: target.slot });
    const outId = d.onPitch[target.slot];
    if (outId != null) sub(outId, src.pid);
  };

  const tokens = new Map<number, BoardToken>();
  for (const id of d.onPitch) {
    if (id == null) continue;
    const p = state.players[id];
    tokens.set(id, {
      id,
      num: p?.num ?? 0,
      name: p?.name ?? '?',
      pos: p?.pos ?? 'MEI',
      fitness: d.fit[id] ?? 0,
      rating: d.rt[id] != null ? d.rt[id] / 10 : null,
      yellow: d.yel.includes(id),
    });
  }

  return (
    <div className="panel col match-control">
      <div className="row">
        {fr.paused ? (
          <button className="btn primary" disabled={!pausedByMe || ended} onClick={() => act({ a: 'resume' })}>
            ▶ Retomar
          </button>
        ) : (
          <button className="btn" disabled={ended || d.pauses >= 3} onClick={() => act({ a: 'pause' })}>
            ⏸ Pausar ({3 - d.pauses})
          </button>
        )}
        <button className="btn ghost" disabled={ended} onClick={() => window.confirm('Simular o resto do jogo instantaneamente?') && act({ a: 'quick' })}>
          ⏩ Simular
        </button>
        <span className="grow" />
        <span className="small muted">
          Subst. {d.subs}/{MAX_SUBS}
        </span>
      </div>
      {fr.paused && !pausedByMe && <div className="small warn">Pausado pelo adversário. Você também pode mexer no time agora.</div>}
      <div className="small muted">
        Arraste um reserva sobre um titular para substituir. Arraste uma camisa sobre outra para trocar de lugar, ou para um círculo vazio para mudar
        a posição. Vale na hora, sem precisar pausar.
      </div>
      <TacticsBoard
        tactics={d.tactics}
        xi={d.onPitch}
        tokens={tokens}
        colors={colors}
        compact
        movable={!ended}
        acceptPlayer={() => subsLeft && !ended}
        onDrop={onDrop}
      />
      <h3 style={{ margin: '4px 0 0' }}>Em campo</h3>
      <PlayerRows
        d={d}
        state={state}
        ids={d.onPitch.filter((x): x is number => x != null)}
        onDropRow={(src, id) => src.kind === 'player' && sub(id, src.pid)}
        selected={out}
        onClick={(id) => setOut(out === id ? null : id)}
      />
      <h3 style={{ margin: '4px 0 0' }}>Banco</h3>
      {bench.length === 0 ? (
        <div className="small faint">Sem reservas.</div>
      ) : (
        <PlayerRows d={d} state={state} ids={bench} drag={subsLeft && !ended} selected={inn} onClick={(id) => setInn(inn === id ? null : id)} />
      )}
      <button className="btn primary" disabled={ended || out == null || inn == null || !subsLeft} onClick={() => sub(out!, inn!)}>
        {out != null && inn != null ? `Sai ${lastName(name(out))}, entra ${lastName(name(inn))}` : 'Ou clique em quem sai e em quem entra'}
      </button>

      <h3 style={{ margin: '4px 0 0' }}>
        Tática <span className="faint small">{shapeLabel(d.tactics)}</span>
      </h3>
      <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <select value={tactics.formation} onChange={(e) => setT({ ...tactics, formation: e.target.value as Formation, shape: null })}>
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
