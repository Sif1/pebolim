import { useState } from 'react';
import { YOUTH_MAX, juniorsOf } from '../../engine/youth';
import type { Player } from '../../engine/types';
import { age, formatMoney } from '../../engine/util';
import { command, useMe } from '../../store';
import { ask } from '../Confirm';
import { Empty, Flag, PosTag, Rating, Stars, useSort } from '../common';
import { Portrait } from '../Portrait';
import { Traits } from '../PlayerModal';

const POS_ORDER = { GOL: 0, LAT: 1, ZAG: 2, VOL: 3, MEI: 4, ATA: 5 };

/** The youth team: academy players kept apart from the first team, força hidden until promoted. */
export function Base() {
  const { state, club } = useMe();
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const season = state?.meta.season ?? 0;
  const youth = state && club ? juniorsOf(state, club.id) : [];
  const avg = (p: Player) => (p.ys && p.ys[0] ? p.ys[3] / p.ys[0] / 10 : null);
  const { sorted, th } = useSort(youth, { key: 'pot', dir: -1 }, {
    pos: (p) => POS_ORDER[p.pos] * 10 - p.stars,
    name: (p) => p.name,
    age: (p) => age(p, season),
    pot: (p) => p.stars * 100 - age(p, season),
    apps: (p) => p.ys?.[0] ?? 0,
    goals: (p) => p.ys?.[1] ?? 0,
    ast: (p) => p.ys?.[2] ?? 0,
    rt: (p) => avg(p) ?? 0,
  });
  if (!state || !club) return null;

  const save = (p: Player) => {
    const name = draft.trim();
    setEditing(null);
    if (name && name !== p.name) void command({ c: 'renameYouth', pid: p.id, name });
  };

  return (
    <div className="col">
      <div className="row">
        <h1 className="grow">Base ({youth.length}/{YOUTH_MAX})</h1>
        <span className="small muted">CT nível {club.tc.level}: quanto melhor o CT, mais promessas chegam e mais rápido elas evoluem.</span>
      </div>
      <div className="small muted">
        A força dos garotos só aparece quando sobem ao profissional: até lá, julgue pelo potencial e pelo desempenho nos jogos da base. Aos 20 anos,
        quem tem futuro sobe sozinho e quem não tem deixa o clube. A peneira traz 2 a 5 garotos no fim de cada temporada.
      </div>
      <div className="panel tight scroll">
        {youth.length === 0 ? (
          <Empty>Nenhum jogador na base. A próxima peneira acontece no fim da temporada.</Empty>
        ) : (
          <table className="t">
            <thead>
              <tr>
                <th />
                {th('pos', 'Pos')}
                {th('name', 'Nome')}
                <th>Nac.</th>
                {th('age', 'Idade', 'center')}
                {th('pot', 'Potencial', 'center')}
                <th className="center" title="Só aparece depois de promovido">
                  Força
                </th>
                {th('apps', 'J', 'center')}
                {th('goals', 'G', 'center')}
                {th('ast', 'A', 'center')}
                {th('rt', 'Nota', 'center')}
                <th className="right">Bolsa</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.id}>
                  <td style={{ width: 34 }}>
                    <Portrait id={p.id} nat={p.nat} age={age(p, season)} pos={p.pos} kit={club.colors} num={0} size={26} />
                  </td>
                  <td>
                    <PosTag pos={p.pos} flank={p.flank} />
                  </td>
                  <td>
                    {editing === p.id ? (
                      <input
                        autoFocus
                        value={draft}
                        maxLength={30}
                        style={{ width: 180 }}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => save(p)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') save(p);
                          if (e.key === 'Escape') setEditing(null);
                        }}
                      />
                    ) : (
                      <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                        <span className="nowrap">{p.name}</span>
                        <button
                          className="btn sm ghost"
                          title="Mudar o nome"
                          onClick={() => {
                            setEditing(p.id);
                            setDraft(p.name);
                          }}
                        >
                          ✎
                        </button>
                      </span>
                    )}
                    <Traits traits={p.traits} small />
                  </td>
                  <td>
                    <Flag nat={p.nat} />
                  </td>
                  <td className="center num">{age(p, season)}</td>
                  <td className="center">
                    <Stars n={p.stars} />
                  </td>
                  <td className="center faint" title="Só aparece depois de promovido">
                    ?
                  </td>
                  <td className="center num">{p.ys?.[0] ?? 0}</td>
                  <td className="center num">{p.ys?.[1] ?? 0}</td>
                  <td className="center num">{p.ys?.[2] ?? 0}</td>
                  <td className="center">
                    <Rating v={avg(p)} />
                  </td>
                  <td className="right small num">{formatMoney(p.wage)}</td>
                  <td className="right nowrap">
                    <button className="btn sm primary" onClick={() => void command({ c: 'promoteYouth', pid: p.id })}>
                      Promover
                    </button>{' '}
                    <button
                      className="btn sm danger"
                      onClick={() =>
                        void ask({ title: `Dispensar ${p.name}?`, text: 'Ele deixa a base e vira jogador livre.', ok: 'Dispensar', danger: true }).then((yes) => {
                          if (yes) void command({ c: 'releaseYouth', pid: p.id });
                        })
                      }
                    >
                      Dispensar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
