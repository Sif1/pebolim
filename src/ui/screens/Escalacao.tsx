import { useEffect, useMemo, useState } from 'react';
import { autoLineup, BENCH_SIZE, isAvailable, lineupRating } from '../../engine/ai/lineup';
import { FORMATIONS, FORMATION_LIST } from '../../engine/match/formations';
import { effective } from '../../engine/match/ratings';
import type { Formation, Lineup, Marking, Mentality, Player, Style, Tactics } from '../../engine/types';
import { squadOf } from '../../engine/util';
import { command, useMe } from '../../store';
import { Bar, PosTag, readable, Str } from '../common';

type Sel = { kind: 'xi'; i: number } | { kind: 'bench'; i: number } | null;

export const MENTALITY_LABEL: Record<Mentality, string> = { defensiva: 'Defensiva', equilibrada: 'Equilibrada', ofensiva: 'Ofensiva' };
export const MARKING_LABEL: Record<Marking, string> = { zona: 'Por zona', pressao: 'Pressão alta' };
export const STYLE_LABEL: Record<Style, string> = { toque: 'Toque de bola', contra: 'Contra-ataque', longa: 'Bola longa' };

export function Escalacao() {
  const { state, club } = useMe();
  const squad = useMemo(() => (state && club ? squadOf(state, club.id) : []), [state, club]);
  const [tactics, setTactics] = useState<Tactics | null>(null);
  const [lineup, setLineup] = useState<Lineup | null>(null);
  const [auto, setAuto] = useState(true);
  const [sel, setSel] = useState<Sel>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!club || dirty) return;
    setTactics(club.tactics);
    const fresh = club.lineup.xi.length === FORMATIONS[club.tactics.formation].length && club.lineup.xi.some((x) => x != null);
    setLineup(fresh ? club.lineup : autoLineup(squad, club.tactics.formation, null));
    setAuto(club.autoLineup);
  }, [club, squad, dirty]);

  if (!state || !club || !tactics || !lineup) return null;
  const byId = new Map(squad.map((p) => [p.id, p]));
  const slots = FORMATIONS[tactics.formation];
  const rating = lineupRating(squad, lineup, tactics.formation, tactics);

  const change = (t: Partial<Tactics>) => {
    const next = { ...tactics, ...t };
    if (t.formation && t.formation !== tactics.formation) {
      setLineup(autoLineup(squad, t.formation, null));
    }
    setTactics(next);
    setDirty(true);
  };

  const place = (pid: number) => {
    if (!sel) return;
    const xi = [...lineup.xi];
    const bench = [...lineup.bench];
    const inXi = xi.indexOf(pid);
    const inBench = bench.indexOf(pid);
    const current = sel.kind === 'xi' ? xi[sel.i] : (bench[sel.i] ?? null);
    // remove pid from where it is, putting the current occupant there (swap)
    if (inXi >= 0) xi[inXi] = current;
    if (inBench >= 0) {
      if (current != null) bench[inBench] = current;
      else bench.splice(inBench, 1);
    }
    if (sel.kind === 'xi') xi[sel.i] = pid;
    else if (sel.i < bench.length) bench[sel.i] = pid;
    else bench.push(pid);
    setLineup({ xi, bench: bench.filter((x): x is number => x != null).slice(0, BENCH_SIZE) });
    setSel(null);
    setDirty(true);
    setAuto(false);
  };

  const save = async () => {
    const r1 = await command({ c: 'setTactics', tactics }, true);
    if (!r1.ok) return;
    const r2 = await command({ c: 'setLineup', lineup, auto }, false);
    if (r2.ok) setDirty(false);
  };

  const used = new Set([...lineup.xi.filter((x): x is number => x != null), ...lineup.bench]);
  const reserves = squad.filter((p) => !used.has(p.id)).sort((a, b) => b.str - a.str);
  const selPos = sel?.kind === 'xi' ? slots[sel.i].pos : null;

  return (
    <div className="col">
      <div className="row">
        <h1 className="grow">Escalação e tática</h1>
        <span className="muted">
          Força da escalação: <Str v={rating} />
        </span>
        <button
          className="btn"
          onClick={() => {
            setLineup(autoLineup(squad, tactics.formation, null));
            setAuto(true);
            setDirty(true);
          }}
        >
          Escalar automaticamente
        </button>
        <button className="btn primary" disabled={!dirty} onClick={() => void save()}>
          Salvar
        </button>
      </div>
      <div className="panel row">
        <label className="field">
          Formação
          <select value={tactics.formation} onChange={(e) => change({ formation: e.target.value as Formation })}>
            {FORMATION_LIST.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Postura
          <select value={tactics.mentality} onChange={(e) => change({ mentality: e.target.value as Mentality })}>
            {Object.entries(MENTALITY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Marcação
          <select value={tactics.marking} onChange={(e) => change({ marking: e.target.value as Marking })}>
            {Object.entries(MARKING_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Estilo
          <select value={tactics.style} onChange={(e) => change({ style: e.target.value as Style })}>
            {Object.entries(STYLE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="row small" style={{ alignSelf: 'flex-end' }}>
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => {
              setAuto(e.target.checked);
              setDirty(true);
            }}
          />
          Escalação automática antes de cada jogo (usa os melhores disponíveis)
        </label>
      </div>
      <div className="grid2" style={{ alignItems: 'start', gridTemplateColumns: 'minmax(300px, 440px) 1fr' }}>
        <div className="col">
          <div className="lineup-pitch">
            {slots.map((sl, i) => {
              const p = lineup.xi[i] != null ? byId.get(lineup.xi[i]!) : undefined;
              const bad = p && !isAvailable(p, null);
              return (
                <div
                  key={i}
                  className={`slot ${sel?.kind === 'xi' && sel.i === i ? 'sel' : ''}`}
                  style={{ left: `${8 + sl.y * 84}%`, top: `${92 - sl.x * 84}%` }}
                  onClick={() => setSel(sel?.kind === 'xi' && sel.i === i ? null : { kind: 'xi', i })}
                >
                  <div className="shirt" style={{ background: club.colors[0], borderColor: club.colors[1], color: readable(club.colors[0], club.colors[1]) }}>
                    {p?.num ?? '?'}
                  </div>
                  <div className="nm" style={{ color: bad ? '#fca5a5' : undefined }}>
                    {p ? p.name.split(' ').slice(-1)[0] : sl.pos}
                  </div>
                  {p && (
                    <div className="small" style={{ color: '#d1fae5' }}>
                      {sl.pos} {Math.round(effective(p, sl.pos))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="small muted">Clique num jogador do campo ou do banco e depois em outro jogador para trocar.</div>
        </div>
        <div className="col">
          <div className="panel tight">
            <h3 style={{ padding: '4px 6px' }}>Banco ({lineup.bench.length}/{BENCH_SIZE})</h3>
            <PlayerList
              players={[...lineup.bench.map((id) => byId.get(id)).filter((p): p is Player => !!p)]}
              selPos={selPos}
              onClick={(p, i) => (sel ? place(p.id) : setSel({ kind: 'bench', i }))}
              selected={sel?.kind === 'bench' ? lineup.bench[sel.i] : null}
            />
            {lineup.bench.length < BENCH_SIZE && sel == null && (
              <button className="btn sm ghost" onClick={() => setSel({ kind: 'bench', i: lineup.bench.length })}>
                + adicionar ao banco
              </button>
            )}
          </div>
          <div className="panel tight">
            <h3 style={{ padding: '4px 6px' }}>Fora da lista ({reserves.length})</h3>
            <PlayerList players={reserves} selPos={selPos} onClick={(p) => sel && place(p.id)} selected={null} />
          </div>
        </div>
      </div>
    </div>
  );
}

function PlayerList({
  players,
  onClick,
  selPos,
  selected,
}: {
  players: Player[];
  onClick: (p: Player, i: number) => void;
  selPos: string | null;
  selected: number | null;
}) {
  return (
    <table className="t">
      <tbody>
        {players.map((p, i) => (
          <tr key={p.id} className={`click ${selected === p.id ? 'me' : ''}`} onClick={() => onClick(p, i)} style={{ opacity: isAvailable(p, null) ? 1 : 0.5 }}>
            <td className="faint num" style={{ width: 28 }}>
              {p.num}
            </td>
            <td style={{ width: 44 }}>
              <PosTag pos={p.pos} />
            </td>
            <td>
              {p.name}
              {p.injury > 0 && <span className="pill bad" style={{ marginLeft: 6 }}>lesão</span>}
              {Object.values(p.ban).some((n) => n > 0) && <span className="pill warn" style={{ marginLeft: 6 }}>suspenso</span>}
            </td>
            <td className="center" style={{ width: 50 }}>
              <Str v={selPos ? effective({ ...p, fitness: 100, morale: 60 }, selPos as Player['pos']) : p.str} />
            </td>
            <td style={{ width: 70 }}>
              <Bar v={p.fitness} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
