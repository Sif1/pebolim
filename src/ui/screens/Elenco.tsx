import { useState } from 'react';
import type { Player } from '../../engine/types';
import { age, formatMoney, playerValue, squadOf } from '../../engine/util';
import { useMe } from '../../store';
import { Bar, compLabel, Energy, Flag, PosTag, Rating, Stars, Str, useSort } from '../common';
import { MarketPills, PlayerModal, Traits } from '../PlayerModal';

const POS_ORDER = { GOL: 0, LAT: 1, ZAG: 2, VOL: 3, MEI: 4, ATA: 5 };

export function SquadTable({ players, onOpen, season, showValue = true }: { players: Player[]; onOpen: (id: number) => void; season: number; showValue?: boolean }) {
  const { state, club } = useMe();
  const { sorted, th } = useSort(players, { key: 'pos', dir: 1 }, {
    num: (p) => p.num,
    name: (p) => p.name,
    pos: (p) => POS_ORDER[p.pos] * 100 - p.str,
    age: (p) => age(p, season),
    str: (p) => p.str,
    pot: (p) => p.stars * 100 + p.pot,
    fit: (p) => p.fitness,
    mor: (p) => p.morale,
    con: (p) => p.contractEnd,
    wage: (p) => p.wage,
    val: (p) => playerValue(p, season),
    g: (p) => p.s.goals,
    apps: (p) => p.s.apps,
    rt: (p) => avgRating(p) ?? 0,
  });
  if (!state) return null;
  const xi = new Set(club?.lineup.xi ?? []);
  return (
    <div className="scroll">
      <table className="t">
        <thead>
          <tr>
            {th('num', '#')}
            {th('pos', 'Pos')}
            {th('name', 'Nome')}
            {th('age', 'Idade', 'center')}
            {th('str', 'Força', 'center')}
            {th('pot', 'Pot.', 'center')}
            {th('fit', 'Físico')}
            {th('mor', 'Moral')}
            <th>Situação</th>
            {th('apps', 'J', 'center')}
            {th('g', 'G', 'center')}
            {th('rt', 'Nota', 'center')}
            {th('con', 'Contrato', 'center')}
            {th('wage', 'Salário', 'right')}
            {showValue && th('val', 'Valor', 'right')}
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => {
            const bans = Object.entries(p.ban).filter(([, n]) => n > 0);
            return (
              <tr key={p.id} className={`click ${xi.has(p.id) ? 'starter' : ''}`} onClick={() => onOpen(p.id)}>
                <td className="faint num">{p.num}</td>
                <td>
                  <PosTag pos={p.pos} />
                </td>
                <td>
                  <span className="nowrap">{p.name}</span> <Flag nat={p.nat} />
                  {p.traits.length > 0 && (
                    <div>
                      <Traits traits={p.traits} small />
                    </div>
                  )}
                </td>
                <td className="center num">{age(p, season)}</td>
                <td className="center">
                  <Str v={p.str} />
                </td>
                <td className="center"><Stars n={p.stars} /></td>
                <td style={{ width: 70 }}>
                  <Energy v={p.fitness} />
                </td>
                <td style={{ width: 60 }}>
                  <Bar v={p.morale} color="var(--info)" />
                </td>
                <td className="small">
                  {p.injury > 0 && <span className="pill bad">lesão {p.injury}</span>}
                  {bans.map(([c, n]) => (
                    <span key={c} className="pill warn" title={compLabel(state, c)}>
                      susp. {n}
                    </span>
                  ))}
                  <MarketPills p={p} state={state} compact />
                </td>
                <td className="center num">{p.s.apps}</td>
                <td className="center num">{p.s.goals}</td>
                <td className="center">
                  <Rating v={avgRating(p)} />
                </td>
                <td className={`center num ${p.contractEnd <= season ? 'warn' : ''}`}>{p.contractEnd}</td>
                <td className="right small num">{formatMoney(p.wage)}</td>
                {showValue && <td className="right small num">{formatMoney(playerValue(p, season))}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Elenco() {
  const { state, club } = useMe();
  const [open, setOpen] = useState<number | null>(null);
  if (!state || !club) return null;
  const squad = squadOf(state, club.id);
  const wages = squad.reduce((a, p) => a + p.wage, 0);
  return (
    <div className="col">
      <div className="row">
        <h1 className="grow">Elenco ({squad.length})</h1>
        <span className="muted">
          Folha salarial: <b>{formatMoney(wages)}</b>/mês
        </span>
      </div>
      <div className="panel tight">
        <SquadTable players={squad} onOpen={setOpen} season={state.meta.season} />
      </div>
      <div className="small muted">Linhas destacadas: titulares da escalação atual. Clique em um jogador para ver detalhes.</div>
      {open != null && <PlayerModal pid={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Season average match rating, or null before the first rated match. */
function avgRating(p: { s: { apps: number; rt: number } }): number | null {
  return p.s.apps > 0 && p.s.rt > 0 ? p.s.rt / p.s.apps / 10 : null;
}
