import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { isDerby } from '../../engine/rivals';
import { gateOf, usableCapacity } from '../../engine/economy';
import { MAX_SUBS } from '../../engine/match/core';
import { FORMATION_LIST, shapeLabel } from '../../engine/match/formations';
import type { LiveDetail, LiveFrame } from '../../engine/match/live';
import type { AttackFocus, Club, Fixture, Formation, GameState, Marking, Mentality, Style, Tactics } from '../../engine/types';
import { dateLabel, formatMoney } from '../../engine/util';
import { MATCH_MINUTES } from '../../net/validate';
import { useApp, useMe } from '../../store';
import { awayKit, ClubBadge, compLabel, Energy, Rating, shortName, Str } from '../common';
import { FOCUS_LABEL, FOCUS_TIP, MARKING_LABEL, MENTALITY_LABEL, STYLE_LABEL } from '../screens/Escalacao';
import { dragProps, dropProps, moveSlotTo, TacticsBoard, type BoardToken, type DragSrc, type DropTarget } from '../TacticsBoard';
import { ask } from '../Confirm';
import { crowd, setSoundOn, soundOn, whistle } from '../sound';
import { LiveCommentary } from './Commentary';
import { PitchCanvas } from './PitchCanvas';
import { ShootoutView } from './Shootout';

const clock = (t: number, half: 1 | 2) => {
  const m = Math.floor(t / 60);
  if (half === 1 && m >= 45) return `45+${m - 44}'`;
  if (half === 2 && m >= 90) return `90+${m - 89}'`;
  return `${m + 1}'`;
};

const lastName = shortName;

export function MatchDay() {
  const { state, club } = useMe();
  const md = useApp((s) => s.md);
  const host = useApp((s) => s.host);
  const client = useApp((s) => s.client)!;
  useApp((s) => s.frameTick);
  const [focus, setFocus] = useState<number | null>(null);
  const [sound, setSoundState] = useState(soundOn());
  const setSound = (on: boolean) => {
    setSoundOn(on);
    setSoundState(on);
  };
  // the match on screen (yours, or the one you clicked) is the one you hear
  const liveIds = md?.live ?? [];
  const myLive = state && club ? liveIds.find((id) => state.fixtures[id] && (state.fixtures[id].home === club.id || state.fixtures[id].away === club.id)) : undefined;
  useMatchSounds(focus ?? myLive ?? liveIds[0]);
  if (!state || !md) return <div className="hero">Preparando a rodada…</div>;

  const fixtures = md.live.map((id) => state.fixtures[id]).filter(Boolean);
  const mine = club ? fixtures.find((f) => f.home === club.id || f.away === club.id) : undefined;
  const focused = focus != null ? fixtures.find((f) => f.id === focus) : (mine ?? fixtures[0]);
  const myDone = mine ? md.done.includes(mine.id) : true;
  const minutes = state.meta.settings.matchMinutes;
  const venue = focused ? state.clubs[focused.home] : null;
  const gate = focused ? gateOf(state, focused) : null;
  const stage = focused
    ? focused.stage != null
      ? state.comps[focused.comp]?.stages[focused.stage]?.name
      : focused.round
        ? `${focused.round}ª rodada`
        : focused.group != null
          ? 'fase de grupos'
          : null
    : null;

  return (
    <div className="content md-page" style={{ height: '100vh' }}>
      <div className="row md-top" style={{ marginBottom: focused ? 4 : 12 }}>
        <h1 className="grow" style={{ margin: 0 }}>
          Dia de jogo
          {focused && (
            <span className="md-comp">
              {state.comps[focused.comp]?.cfg.name ?? compLabel(state, focused.comp)}
              {stage && <span className="faint"> · {stage}</span>}
            </span>
          )}
          <span className="md-date">{dateLabel(state, md.date)}</span>
        </h1>
        <button className="btn sm ghost" title={sound ? 'Som ligado (apito, torcida)' : 'Som desligado'} onClick={() => setSound(!sound)}>
          {sound ? '🔊 Som' : '🔇 Mudo'}
        </button>
        <label className="row small muted md-length" style={{ gap: 6 }} title={host ? 'Vale para todas as partidas, na hora' : 'Só o anfitrião muda'}>
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
        <span className="muted md-done">
          {md.done.length}/{md.live.length} partidas encerradas
        </span>
        {md.allDone ? (
          host ? (
            <button className="btn primary lg" data-shortcut="space" title="Atalho: Espaço" onClick={() => client.hostAction('continue')}>
              Ver resultados ▶
            </button>
          ) : (
            <span className="pill info">Aguardando o anfitrião continuar</span>
          )
        ) : myDone && mine ? (
          <span className="pill warn">Seu jogo acabou · aguardando os outros</span>
        ) : null}
      </div>
      {focused && venue && gate && (
        <div className="md-venue">
          <span>🏟 {venue.stadium}</span>
          <span>
            <b>{gate.total.toLocaleString('pt-BR')}</b> ingressos vendidos
            <span className="faint">{` de ${usableCapacity(venue).toLocaleString('pt-BR')} lugares (${Math.round((gate.total / Math.max(1, usableCapacity(venue))) * 100)}%)`}</span>
          </span>
          {club?.id === venue.id && <span className="faint">renda de {formatMoney(gate.revenue)}</span>}
        </div>
      )}
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
          <div className="col" style={{ gap: 12, minWidth: 0 }}>
            <MatchView key={focused.id} f={focused} state={state} big crowdNoise={sound} />
            <StatsPanel f={focused} state={state} />
          </div>
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

/**
 * Sounds for the match on screen, from the home crowd's point of view: a roar for a home goal, boos for an away
 * goal, the referee's whistle for cards, penalties, half-time and full time. History is not replayed when the
 * focused match changes.
 */
function useMatchSounds(fid: number | undefined) {
  const client = useApp((s) => s.client);
  const seen = useRef<{ fid?: number; n: number; kicks: number }>({ n: 0, kicks: 0 });
  useEffect(() => {
    if (!client || fid == null) return;
    const evs = client.events.get(fid) ?? [];
    const s = seen.current;
    const pk = client.frames.get(fid)?.cur.pk;
    if (s.fid !== fid) {
      seen.current = { fid, n: evs.length, kicks: pk?.kicks.length ?? 0 };
      return;
    }
    for (const e of evs.slice(s.n)) {
      if (e.kind === 'goal') crowd(e.side === 0 ? 'cheer' : 'boo');
      else if (e.kind === 'yellow') whistle('short');
      else if (e.kind === 'red' || e.kind === 'penalty') whistle('long');
      else if (e.kind === 'kickoff') whistle('short');
      else if (e.kind === 'ht') whistle('double');
      else if (e.kind === 'ft') whistle('final');
      // a penalty that doesn't go in: the home crowd groans at its own miss, cheers the away miss
      else if (e.kind === 'miss') crowd(e.side === 0 ? 'ooh' : 'cheer');
      else if (e.kind === 'save') crowd(e.side === 0 ? 'cheer' : 'ooh');
    }
    s.n = evs.length;
    // shootout kicks: the sound comes as the ball arrives (in-match penalties sound through their events)
    if (pk?.mode === 'shootout' && pk.kicks.length > s.kicks) {
      const k = pk.kicks[pk.kicks.length - 1];
      window.setTimeout(() => (k[4] === 0 ? crowd(k[0] === 0 ? 'cheer' : 'boo') : crowd(k[0] === 0 ? 'ooh' : 'cheer')), 1850);
    }
    s.kicks = pk?.kicks.length ?? 0;
  });
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
function MatchView({ f, state, big, crowdNoise }: { f: Fixture; state: GameState; big?: boolean; crowdNoise?: boolean }) {
  const client = useApp((s) => s.client)!;
  const myClub = useMe().club?.id;
  const fr: LiveFrame | undefined = client.frames.get(f.id)?.cur;
  const events = client.events.get(f.id) ?? [];
  const home = state.clubs[f.home];
  const away = state.clubs[f.away];
  const kit = useMemo(() => awayKit(home.colors, away.colors), [home.colors, away.colors]);
  const { numbers, names, mineIds } = useMatchMaps(f, state);
  const derby = isDerby(state, f.home, f.away);
  // a goal flashes the scoreboard in the scorer's colours for a few seconds (goals already there don't)
  const goalSeen = useRef<{ n: number; side: 0 | 1; at: number } | null>(null);
  const goals = events.filter((e) => e.kind === 'goal');
  if (!goalSeen.current) goalSeen.current = { n: goals.length, side: 0, at: 0 };
  else if (goals.length > goalSeen.current.n) goalSeen.current = { n: goals.length, side: goals[goals.length - 1].side, at: performance.now() };
  const g = goalSeen.current;
  const sbFlash = g.at && performance.now() - g.at < 3600 ? g : null;
  const flashKit = sbFlash ? (sbFlash.side === 0 ? home.colors : kit) : null;
  const comp = state.comps[f.comp];
  // tactical changes (the AI coach's and the managers') only show on the big view
  const visible = events.filter((e) => big || e.kind !== 'tactic').slice(-(big ? 10 : 2)).reverse();
  const manager = (c: Club) => (c.managerId ? state.managers[c.managerId]?.name : null);

  return (
    <div className={`md-card ${mineIds ? 'mine' : ''} ${big ? 'big' : ''}`}>
      <div
        key={sbFlash ? `g${sbFlash.at}` : 'sb'}
        className={`scoreboard ${sbFlash ? 'sb-flash' : ''}`}
        style={flashKit ? ({ '--f1': flashKit[0], '--f2': flashKit[1] } as CSSProperties) : undefined}
      >
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
          {derby && <span className="sb-derby" title="Clássico: o resultado vale o dobro para a torcida e mais para a diretoria">CLÁSSICO · </span>}
          {fr ? (fr.ended ? 'FIM' : fr.pk ? (fr.pk.mode === 'spot' ? 'PÊNALTI' : 'PÊNALTIS') : fr.paused ? 'PAUSA' : clock(fr.t, fr.half)) : '0\''}
          {fr?.pens && ` · pên. ${fr.pens[0]}-${fr.pens[1]}`}
          {fr?.pk && !fr.pens && ` ${fr.pk.score[0]}-${fr.pk.score[1]}`}
        </div>
      </div>
      {fr?.pk && big ? (
        <ShootoutView f={f} state={state} fr={fr} mySide={myClub === f.home ? 0 : myClub === f.away ? 1 : null} />
      ) : (
        <>
          <PitchCanvas fixtureId={f.id} homeColors={home.colors} awayColors={kit} numbers={numbers} names={names} big={big} mine={mineIds} />
          <Momentum f={f} homeColors={home.colors} awayColors={kit} homeShort={home.short} awayShort={away.short} big={big} />
        </>
      )}
      {fr ? (
        <LiveCommentary
          fixtureId={f.id}
          teams={[home.name, away.name]}
          shorts={[home.short, away.short]}
          colors={[home.colors, kit]}
          names={names}
          compact={!big}
          derby={derby}
          crowdNoise={crowdNoise}
        />
      ) : (
        <div className="ticker">
          <span className="faint">
            {comp?.cfg.short}
            {f.stage != null && comp ? ` · ${comp.stages[f.stage]?.name}` : ''}
          </span>
        </div>
      )}
      {!big && fr && (
        <div className="md-stats">
          <StatRow k="Posse" a={`${fr.poss}%`} b={`${100 - fr.poss}%`} />
          <StatRow k="Finalizações" a={fr.shots[0]} b={fr.shots[1]} />
          <StatRow k="xG" a={(fr.x.xg[0] / 100).toFixed(2)} b={(fr.x.xg[1] / 100).toFixed(2)} />
        </div>
      )}
      {big && (
        <div className="md-events">
          {visible.map((e, i) => (
            <div key={i} className={e.kind === 'goal' ? 'good' : e.kind === 'red' ? 'bad' : ''}>
              <span className="faint num">{Math.floor(e.t / 60) + 1}'</span>{' '}
              {e.kind === 'goal' ? '⚽' : e.kind === 'yellow' ? '🟨' : e.kind === 'red' ? '🟥' : e.kind === 'sub' ? '🔁' : e.kind === 'injury' ? '🚑' : e.kind === 'tactic' ? '📋' : e.kind === 'penalty' ? '❗' : '·'}{' '}
              <span className={e.kind === 'tactic' ? 'info' : ''}>{e.text}</span>{' '}
              {e.kind !== 'ht' && e.kind !== 'ft' && e.kind !== 'pens' && e.kind !== 'tactic' && <span className="faint">({e.side === 0 ? home.short : away.short})</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Minute of the momentum graph (0-89) for an event, given whether half-time has passed. */
const momentMinute = (t: number, half: 1 | 2) => (half === 1 ? Math.min(44, Math.floor(t / 60)) : 45 + Math.min(44, Math.max(0, Math.floor((t - 2700) / 60))));

/**
 * Match momentum: who is pushing, minute by minute. Bars above the line are the home side's pressure,
 * below it the away side's (attacking-third possession, shots weighted by chance quality, corners, goals).
 * Bars wear the same kit as the players' dots on the pitch: shirt colour filled, second colour as the outline.
 */
function Momentum({
  f,
  homeColors,
  awayColors,
  homeShort,
  awayShort,
  big,
}: {
  f: Fixture;
  homeColors: [string, string];
  awayColors: [string, string];
  homeShort: string;
  awayShort: string;
  big?: boolean;
}) {
  const client = useApp((s) => s.client)!;
  const d = client.details.get(f.id);
  const events = client.events.get(f.id) ?? [];
  const N = 90;
  const W = 900;
  const H = big ? 70 : 28;
  const mid = H / 2;
  const smooth = (arr: number[]) =>
    arr.map((_, i) => {
      let s = 0;
      let w = 0;
      [0.2, 0.3, 0.5].forEach((wt, k) => {
        const j = i - 2 + k;
        if (j < 0) return;
        s += (arr[j] ?? 0) * wt;
        w += wt;
      });
      return w ? s / w : 0;
    });
  const hs = smooth((d?.mom[0] ?? []).map((v) => v / 10));
  const as = smooth((d?.mom[1] ?? []).map((v) => v / 10));
  const max = Math.max(3, ...hs, ...as);
  const bw = W / N;
  const at = d?.momAt ?? 0;
  const marks: { m: number; side: 0 | 1; kind: 'goal' | 'red' }[] = [];
  let half: 1 | 2 = 1;
  for (const e of events) {
    if (e.kind === 'ht') half = 2;
    else if (e.kind === 'goal' || e.kind === 'red') marks.push({ m: momentMinute(e.t, half), side: e.side, kind: e.kind });
  }
  const h = (v: number) => (v / max) * (mid - 2);
  return (
    <div className={`momentum ${big ? 'big' : ''}`} title="Pressão de cada time, minuto a minuto (acima: mandante; abaixo: visitante)">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <rect x={(at + 1) * bw} y={0} width={Math.max(0, W - (at + 1) * bw)} height={H} fill="rgba(255,255,255,0.03)" />
        {big &&
          [15, 30, 60, 75].map((m) => <line key={m} x1={m * bw} x2={m * bw} y1={0} y2={H} stroke="rgba(255,255,255,0.07)" />)}
        <line x1={45 * bw} x2={45 * bw} y1={0} y2={H} stroke="rgba(255,255,255,0.3)" strokeDasharray="4 3" />
        {hs.map((v, i) =>
          v > 0.05 ? (
            <rect key={`h${i}`} x={i * bw + 0.8} y={mid - h(v)} width={bw - 1.6} height={h(v)} fill={homeColors[0]} stroke={homeColors[1]} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
          ) : null,
        )}
        {as.map((v, i) =>
          v > 0.05 ? (
            <rect key={`a${i}`} x={i * bw + 0.8} y={mid} width={bw - 1.6} height={h(v)} fill={awayColors[0]} stroke={awayColors[1]} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
          ) : null,
        )}
        <line x1={0} x2={W} y1={mid} y2={mid} stroke="rgba(255,255,255,0.35)" />
        <rect x={at * bw} y={0} width={bw} height={H} fill="rgba(255,255,255,0.18)" />
      </svg>
      {marks.map((k, i) => (
        <span
          key={i}
          className={`mm ${k.kind}`}
          style={{ left: `${((k.m + 0.5) / N) * 100}%`, ...(k.side === 0 ? { top: 1 } : { bottom: 1 }) }}
          title={k.kind === 'goal' ? 'Gol' : 'Expulsão'}
        />
      ))}
      {big && (
        <>
          <span className="mm-team top" style={{ borderLeft: `8px solid ${homeColors[0]}`, outline: `1px solid ${homeColors[1]}` }}>
            {homeShort}
          </span>
          <span className="mm-team bottom" style={{ borderLeft: `8px solid ${awayColors[0]}`, outline: `1px solid ${awayColors[1]}` }}>
            {awayShort}
          </span>
          <div className="mm-ticks">
            {['0', "15'", "30'", "45'", "60'", "75'", "90'"].map((t, i) => (
              <span key={t} style={{ left: `${(i * 15 * 100) / N}%` }}>
                {t}
              </span>
            ))}
          </div>
        </>
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
    <div className="panel stats-panel wide">
      <div className="row small" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <b>{state.clubs[f.home].short}</b>
        <span className="faint">Estatísticas</span>
        <b>{state.clubs[f.away].short}</b>
      </div>
      <div className="stats-grid">
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
      </div>
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
  accept = (src) => src.kind === 'player',
  drag,
  selected,
  onClick,
}: {
  d: LiveDetail['sides'][number];
  state: GameState;
  ids: number[];
  onDropRow?: (src: DragSrc, id: number) => void;
  /** what may be dropped on a row (default: bench players) */
  accept?: (src: DragSrc) => boolean;
  /** rows can be dragged: bench players as players, starters as their slot */
  drag?: 'bench' | 'pitch';
  selected?: number | null;
  onClick?: (id: number) => void;
}) {
  return (
    <table className="t compact">
      <tbody>
        {ids.map((id) => {
          const p = state.players[id];
          const off = d.off.includes(id);
          const slot = d.onPitch.indexOf(id);
          const src: DragSrc | null = drag === 'bench' ? { kind: 'player', pid: id, from: 'bench' } : drag === 'pitch' && slot >= 0 ? { kind: 'slot', slot } : null;
          return (
            <tr
              key={id}
              className={`${onClick ? 'click' : ''} ${selected === id ? 'me' : ''} ${src && !off ? 'draggable' : ''}`}
              style={{ opacity: off ? 0.45 : 1 }}
              onClick={() => onClick?.(id)}
              {...(src && !off ? dragProps(src) : {})}
              {...(onDropRow && !off ? dropProps((s) => onDropRow(s, id), accept) : {})}
            >
              <td style={{ width: 38 }}>
                <span className={`pos pos-${p?.pos}`}>{p?.pos}</span>
              </td>
              <td className="nowrap" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {p?.name ?? '?'} {d.yel.includes(id) && '🟨'}
              </td>
              <td className="center" style={{ width: 34 }} title="Força">
                {p && <Str v={p.str} />}
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
          <button className="btn primary" data-shortcut="space" title="Atalho: Espaço" disabled={!pausedByMe || ended} onClick={() => act({ a: 'resume' })}>
            ▶ Retomar
          </button>
        ) : (
          <button className="btn" data-shortcut="space" title="Atalho: Espaço" disabled={ended || d.pauses >= 3} onClick={() => act({ a: 'pause' })}>
            ⏸ Pausar ({3 - d.pauses})
          </button>
        )}
        <button
          className="btn ghost"
          disabled={ended}
          onClick={async () => {
            if (await ask({ title: 'Simular o resto do jogo?', text: 'A partida termina na hora, com a IA cuidando das decisões que faltam.', ok: 'Simular' })) act({ a: 'quick' });
          }}
        >
          ⏩ Simular
        </button>
        <span className="grow" />
        <span className="small muted">
          Subst. {d.subs}/{MAX_SUBS}
        </span>
      </div>
      {fr.paused && !pausedByMe && <div className="small warn">Pausado pelo adversário. Você também pode mexer no time agora.</div>}
      <div className="small muted">
        Arraste um reserva sobre um titular (ou um titular sobre um reserva) para substituir. Arraste uma camisa sobre outra para trocar de lugar,
        ou para um círculo vazio para mudar a posição. Vale na hora, sem precisar pausar.
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
        drag={subsLeft && !ended ? 'pitch' : undefined}
        selected={out}
        onClick={(id) => setOut(out === id ? null : id)}
      />
      <h3 style={{ margin: '4px 0 0' }}>Banco</h3>
      {bench.length === 0 ? (
        <div className="small faint">Sem reservas.</div>
      ) : (
        <PlayerRows
          d={d}
          state={state}
          ids={bench}
          drag={subsLeft && !ended ? 'bench' : undefined}
          // a starter (from this list or the pitch) dropped on a reserve: that reserve comes on for him
          onDropRow={(src, id) => {
            if (src.kind !== 'slot') return;
            const outId = d.onPitch[src.slot];
            if (outId != null) sub(outId, id);
          }}
          accept={(src) => src.kind === 'slot' && subsLeft && !ended}
          selected={inn}
          onClick={(id) => setInn(inn === id ? null : id)}
        />
      )}
      <button className="btn primary" disabled={ended || out == null || inn == null || !subsLeft} onClick={() => sub(out!, inn!)}>
        {out != null && inn != null ? `Sai ${lastName(name(out))}, entra ${lastName(name(inn))}` : 'Ou clique em quem sai e em quem entra'}
      </button>

      <h3 style={{ margin: '4px 0 0' }}>
        Tática <span className="faint small">{shapeLabel(d.tactics)}</span>
      </h3>
      <div className="grid2 pair" style={{ gridTemplateColumns: '1fr 1fr', gap: 6 }}>
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
        <select
          title={FOCUS_TIP}
          value={tactics.focus ?? ''}
          onChange={(e) => {
            const { focus: _drop, ...rest } = tactics;
            setT(e.target.value ? { ...rest, focus: e.target.value as AttackFocus } : rest);
          }}
        >
          {Object.keys(FOCUS_LABEL).map((k) => (
            <option key={k} value={k}>
              {k === 'meio' ? 'Ataques: pelo meio' : k === 'lados' ? 'Ataques: pelas pontas' : 'Ataques: por onde der'}
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
