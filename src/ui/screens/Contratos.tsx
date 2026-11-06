import { useState } from 'react';
import { absDateLabel, age, expectedWage, formatMoney, squadOf } from '../../engine/util';
import { command, useMe } from '../../store';
import { Flag, PosTag, Str, useSort } from '../common';

export function Contratos() {
  const { state, club } = useMe();
  const [offer, setOffer] = useState<Record<number, { wage: number; years: number }>>({});
  const season = state?.meta.season ?? 0;
  const demandOf = (p: Parameters<typeof expectedWage>[0]) => expectedWage(p, season, club?.rep ?? 50) * (age(p, season) < 30 ? 1.1 : 1);
  const { sorted: squad, th } = useSort(state && club ? squadOf(state, club.id) : [], { key: 'con', dir: 1 }, {
    pos: (p) => ({ GOL: 0, LAT: 1, ZAG: 2, VOL: 3, MEI: 4, ATA: 5 })[p.pos] * 100 - p.str,
    name: (p) => p.name,
    age: (p) => age(p, season),
    str: (p) => p.str,
    // loans end mid-season: sort them by their return date
    con: (p) => (p.loan ? p.loan.until / 100 - 0.5 : p.contractEnd) * 1000 - p.str,
    wage: (p) => p.wage,
    demand: (p) => demandOf(p),
  });
  if (!state || !club) return null;

  return (
    <div className="col">
      <h1>Contratos</h1>
      <div className="small muted">
        Jogadores com contrato até {season} saem de graça no fim da temporada se não renovarem. A pretensão salarial é uma estimativa.
      </div>
      <div className="panel tight scroll">
        <table className="t">
          <thead>
            <tr>
              {th('pos', 'Pos')}
              {th('name', 'Nome')}
              {th('age', 'Idade', 'center')}
              {th('str', 'Força', 'center')}
              {th('con', 'Contrato', 'center')}
              {th('wage', 'Salário', 'right')}
              {th('demand', 'Pretensão', 'right')}
              <th>Renovar</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {squad.map((p) => {
              const demand = demandOf(p);
              const o = offer[p.id] ?? { wage: Math.round(demand / 1000) * 1000, years: age(p, season) >= 33 ? 1 : 3 };
              return (
                <tr key={p.id}>
                  <td>
                    <PosTag pos={p.pos} />
                  </td>
                  <td>
                    {p.name} <Flag nat={p.nat} />
                    {p.loan && <span className="pill info" style={{ marginLeft: 6 }}>emprestado</span>}
                  </td>
                  <td className="center num">{age(p, season)}</td>
                  <td className="center">
                    <Str v={p.str} />
                  </td>
                  <td className={`center num ${p.contractEnd <= season ? 'warn' : ''}`}>{p.loan ? `volta ${absDateLabel(state, p.loan.until).slice(0, 5)}` : p.contractEnd}</td>
                  <td className="right small num">{formatMoney(p.wage)}</td>
                  <td className="right small num muted">~{formatMoney(demand)}</td>
                  <td>
                    {!p.loan && (
                      <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                        <input
                          type="number"
                          step={1000}
                          value={o.wage}
                          style={{ width: 110 }}
                          onChange={(e) => setOffer({ ...offer, [p.id]: { ...o, wage: Number(e.target.value) } })}
                        />
                        <select value={o.years} onChange={(e) => setOffer({ ...offer, [p.id]: { ...o, years: Number(e.target.value) } })}>
                          {[1, 2, 3, 4, 5].map((y) => (
                            <option key={y} value={y}>
                              {y} ano{y > 1 ? 's' : ''}
                            </option>
                          ))}
                        </select>
                        <button className="btn sm primary" onClick={() => void command({ c: 'renew', pid: p.id, wage: o.wage, years: o.years })}>
                          Propor
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="right">
                    <button
                      className="btn sm danger"
                      onClick={() =>
                        window.confirm(p.loan ? `Devolver ${p.name} ao clube de origem?` : `Dispensar ${p.name}? O clube paga metade dos salários restantes.`) &&
                        void command({ c: 'release', pid: p.id })
                      }
                    >
                      {p.loan ? 'Devolver' : 'Dispensar'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
