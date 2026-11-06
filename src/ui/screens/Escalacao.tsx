import { useEffect, useMemo, useState } from 'react';
import { autoLineup, BENCH_SIZE, isAvailable, lineupRating } from '../../engine/ai/lineup';
import { FORMATION_LIST, shapeLabel, slotsFor } from '../../engine/match/formations';
import { effective } from '../../engine/match/ratings';
import type { Formation, Lineup, Marking, Mentality, Player, Style, Tactics } from '../../engine/types';
import { squadOf } from '../../engine/util';
import { command, useMe } from '../../store';
import { Energy, PosTag, Str } from '../common';
import { dragProps, dropProps, moveSlotTo, TacticsBoard, type BoardToken, type DragSrc, type DropTarget } from '../TacticsBoard';

export const MENTALITY_LABEL: Record<Mentality, string> = { defensiva: 'Defensiva', equilibrada: 'Equilibrada', ofensiva: 'Ofensiva' };
export const MARKING_LABEL: Record<Marking, string> = { zona: 'Por zona', pressao: 'Pressão alta' };
export const STYLE_LABEL: Record<Style, string> = { toque: 'Toque de bola', contra: 'Contra-ataque', longa: 'Bola longa' };

type Sel = { kind: 'xi'; i: number } | { kind: 'bench'; i: number } | null;

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
    const fresh = club.lineup.xi.length === slotsFor(club.tactics).length && club.lineup.xi.some((x) => x != null);
    setLineup(fresh ? club.lineup : autoLineup(squad, club.tactics, null));
    setAuto(club.autoLineup);
  }, [club, squad, dirty]);

  if (!state || !club || !tactics || !lineup) return null;
  const byId = new Map(squad.map((p) => [p.id, p]));
  const slots = slotsFor(tactics);
  const rating = lineupRating(squad, lineup, tactics.formation, tactics);

  const touch = (l: Lineup, manual = true) => {
    setLineup({ xi: l.xi, bench: l.bench.filter((x): x is number => x != null).slice(0, BENCH_SIZE) });
    setDirty(true);
    if (manual) setAuto(false);
    setSel(null);
  };

  const change = (t: Partial<Tactics>) => {
    const next = { ...tactics, ...t };
    if (t.formation && t.formation !== tactics.formation) {
      next.shape = null;
      setLineup(autoLineup(squad, next, null));
    }
    setTactics(next);
    setDirty(true);
  };

  /** Put `pid` into slot `i`; the player there goes where `pid` came from. */
  const intoSlot = (i: number, pid: number) => {
    const xi = [...lineup.xi];
    const bench = [...lineup.bench];
    const occupant = xi[i] ?? null;
    const fromXi = xi.indexOf(pid);
    const fromBench = bench.indexOf(pid);
    if (fromXi >= 0) xi[fromXi] = occupant;
    if (fromBench >= 0) {
      if (occupant != null) bench[fromBench] = occupant;
      else bench.splice(fromBench, 1);
    }
    xi[i] = pid;
    touch({ xi, bench });
  };

  const onBoardDrop = (target: DropTarget, src: DragSrc) => {
    if (target.kind === 'cell') {
      if (src.kind !== 'slot') return;
      const shape = moveSlotTo(tactics, src.slot, target.cell);
      if (shape) change({ shape });
      return;
    }
    if (src.kind === 'slot') {
      const pid = lineup.xi[src.slot];
      if (pid != null) intoSlot(target.slot, pid);
      return;
    }
    intoSlot(target.slot, src.pid);
  };

  /** Drop on the bench (on a row: swap with it). */
  const toBench = (src: DragSrc, at: number | null) => {
    const xi = [...lineup.xi];
    const bench = [...lineup.bench];
    const pid = src.kind === 'slot' ? xi[src.slot] : src.pid;
    if (pid == null) return;
    const target = at != null ? (bench[at] ?? null) : null;
    if (src.kind === 'slot') {
      if (target != null) {
        xi[src.slot] = target;
        bench[at!] = pid;
      } else if (bench.length < BENCH_SIZE) {
        xi[src.slot] = null;
        bench.push(pid);
      } else return;
    } else if (src.from === 'bench') {
      const from = bench.indexOf(pid);
      if (target == null || from < 0) return;
      [bench[from], bench[at!]] = [bench[at!], bench[from]];
    } else {
      if (target != null) bench[at!] = pid;
      else if (bench.length < BENCH_SIZE) bench.push(pid);
      else return;
    }
    touch({ xi, bench });
  };

  const toReserves = (src: DragSrc) => {
    if (src.kind === 'slot') touch({ xi: lineup.xi.map((x, i) => (i === src.slot ? null : x)), bench: lineup.bench });
    else if (src.from === 'bench') touch({ xi: lineup.xi, bench: lineup.bench.filter((x) => x !== src.pid) });
  };

  // click fallback: pick a slot or bench row, then a player
  const place = (pid: number) => {
    if (!sel) return;
    if (sel.kind === 'xi') return intoSlot(sel.i, pid);
    toBench({ kind: 'player', pid, from: lineup.bench.includes(pid) ? 'bench' : 'res' }, sel.i < lineup.bench.length ? sel.i : null);
  };

  const save = async () => {
    const r1 = await command({ c: 'setTactics', tactics }, true);
    if (!r1.ok) return;
    const r2 = await command({ c: 'setLineup', lineup, auto }, false);
    if (r2.ok) setDirty(false);
  };

  const tokens = new Map<number, BoardToken>();
  lineup.xi.forEach((id, i) => {
    const p = id != null ? byId.get(id) : undefined;
    if (!p || !slots[i]) return;
    const eff = Math.round(effective(p, slots[i].pos));
    tokens.set(p.id, {
      id: p.id,
      num: p.num,
      name: p.name,
      pos: p.pos,
      fitness: p.fitness,
      dim: !isAvailable(p, null),
      meta: (
        <>
          {slots[i].pos} <b style={{ color: eff < p.str - 3 ? '#fca5a5' : '#d1fae5' }}>{eff}</b>
        </>
      ),
    });
  });

  const used = new Set([...lineup.xi.filter((x): x is number => x != null), ...lineup.bench]);
  const reserves = squad.filter((p) => !used.has(p.id)).sort((a, b) => b.str - a.str);
  const selPos = sel?.kind === 'xi' ? slots[sel.i].pos : null;
  const custom = !!tactics.shape;

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
            setLineup(autoLineup(squad, tactics, null));
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
          Formação base
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
          Escalação automática antes de cada jogo
        </label>
      </div>
      <div className="grid2" style={{ alignItems: 'start', gridTemplateColumns: 'minmax(300px, 430px) 1fr' }}>
        <div className="col">
          <div className="row small">
            <span className={`pill ${custom ? 'info' : ''}`}>{custom ? `Posições personalizadas · ${shapeLabel(tactics)}` : `Posições padrão · ${tactics.formation}`}</span>
            {custom && (
              <button className="btn sm ghost" onClick={() => change({ shape: null })}>
                Voltar ao padrão
              </button>
            )}
          </div>
          <TacticsBoard
            tactics={tactics}
            xi={lineup.xi}
            tokens={tokens}
            colors={club.colors}
            selected={sel?.kind === 'xi' ? sel.i : null}
            onSlotClick={(i) => {
              if (sel?.kind === 'bench' && lineup.bench[sel.i] != null) return intoSlot(i, lineup.bench[sel.i]);
              setSel(sel?.kind === 'xi' && sel.i === i ? null : { kind: 'xi', i });
            }}
            onDrop={onBoardDrop}
          />
          <div className="small muted">
            Arraste um jogador do banco ou da lista para cima de um titular para trocar. Arraste uma camisa para um círculo vazio para mudar a posição
            dele (a função muda conforme a área do campo). Também dá para clicar num jogador e depois em outro.
          </div>
        </div>
        <div className="col">
          <div className="panel tight drop-zone" {...dropProps((src) => toBench(src, null), (src) => !(src.kind === 'player' && src.from === 'bench'))}>
            <h3 style={{ padding: '4px 6px' }}>
              Banco ({lineup.bench.length}/{BENCH_SIZE})
            </h3>
            <PlayerList
              players={lineup.bench.map((id) => byId.get(id)).filter((p): p is Player => !!p)}
              from="bench"
              selPos={selPos}
              selected={sel?.kind === 'bench' ? (lineup.bench[sel.i] ?? null) : null}
              onClick={(p, i) => (sel ? place(p.id) : setSel({ kind: 'bench', i }))}
              onDropRow={(src, i) => toBench(src, i)}
            />
            {lineup.bench.length < BENCH_SIZE && sel == null && (
              <button className="btn sm ghost" onClick={() => setSel({ kind: 'bench', i: lineup.bench.length })}>
                + adicionar ao banco
              </button>
            )}
          </div>
          <div className="panel tight drop-zone" {...dropProps(toReserves, (src) => src.kind === 'slot' || src.from === 'bench')}>
            <h3 style={{ padding: '4px 6px' }}>Fora da lista ({reserves.length})</h3>
            <PlayerList players={reserves} from="res" selPos={selPos} selected={null} onClick={(p) => sel && place(p.id)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function PlayerList({
  players,
  from,
  onClick,
  onDropRow,
  selPos,
  selected,
}: {
  players: Player[];
  from: 'bench' | 'res';
  onClick: (p: Player, i: number) => void;
  onDropRow?: (src: DragSrc, i: number) => void;
  selPos: string | null;
  selected: number | null;
}) {
  return (
    <table className="t">
      <tbody>
        {players.map((p, i) => (
          <tr
            key={p.id}
            className={`click ${selected === p.id ? 'me' : ''}`}
            onClick={() => onClick(p, i)}
            style={{ opacity: isAvailable(p, null) ? 1 : 0.5 }}
            {...dragProps({ kind: 'player', pid: p.id, from })}
            {...(onDropRow ? dropProps((src) => onDropRow(src, i)) : {})}
          >
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
            <td style={{ width: 110 }}>
              <Energy v={p.fitness} w={48} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
