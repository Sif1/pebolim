import { useState } from 'react';
import { absDateLabel, age, expectedWage, formatMoney, squadOf } from '../../engine/util';
import { command, useMe } from '../../store';
import { ask } from '../Confirm';
import { Flag, MoneyField, PosTag, Str, useSort } from '../common';

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
    auto: (p) => (club?.autoRenewAll || club?.autoRenew?.includes(p.id) ? 1 : 0),
  });
  if (!state || !club) return null;
  const marked = new Set(club.autoRenew ?? []);
  const all = !!club.autoRenewAll;
  const own = squad.filter((p) => !p.loan);
  const expiring = own.filter((p) => p.contractEnd <= season);
  const autoCount = all ? expiring.length : expiring.filter((p) => marked.has(p.id)).length;

  return (
    <div className="col">
      <h1>Contratos</h1>
      <div className="small muted">
        Jogadores com contrato até {season} saem de graça no fim da temporada se não renovarem. A pretensão salarial é uma estimativa.
      </div>
      <div className="panel row auto-renew">
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={all} onChange={(e) => void command({ c: 'setAutoRenewAll', on: e.target.checked })} />
          <b>Renovar automaticamente todos os contratos que vencem</b>
        </label>
        {!all && (
          <>
            <button className="btn sm ghost" onClick={() => void command({ c: 'setAutoRenew', pids: own.map((p) => p.id), on: true }, true)}>
              Marcar todos
            </button>
            <button className="btn sm ghost" onClick={() => void command({ c: 'setAutoRenew', pids: own.map((p) => p.id), on: false }, true)}>
              Desmarcar todos
            </button>
          </>
        )}
        <span className="grow small muted">
          {expiring.length
            ? `${autoCount} de ${expiring.length} contrato${expiring.length > 1 ? 's' : ''} vencendo em ${season} ${autoCount === 1 ? 'será renovado' : 'serão renovados'} no fim da temporada.`
            : `Nenhum contrato vence em ${season}.`}{' '}
          A renovação automática paga a pretensão do jogador (quem tem 35+ anos ou está insatisfeito não aceita).
        </span>
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
              {th('auto', <span title="Renovação automática no fim da temporada">Auto</span>, 'center')}
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
                    <PosTag pos={p.pos} flank={p.flank} />
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
                  <td className="center">
                    {!p.loan && (
                      <input
                        type="checkbox"
                        title={all ? 'Todos os contratos renovam automaticamente' : 'Renovar automaticamente no fim da temporada'}
                        checked={all || marked.has(p.id)}
                        disabled={all}
                        onChange={(e) => void command({ c: 'setAutoRenew', pids: [p.id], on: e.target.checked }, true)}
                      />
                    )}
                  </td>
                  <td>
                    {!p.loan && (
                      <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                        <MoneyField value={o.wage} width={100} onChange={(v) => setOffer({ ...offer, [p.id]: { ...o, wage: v } })} />
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
                        void ask(
                          p.loan
                            ? { title: `Devolver ${p.name}?`, text: 'Ele volta ao clube de origem agora.', ok: 'Devolver' }
                            : { title: `Dispensar ${p.name}?`, text: 'O clube paga metade dos salários que faltam no contrato.', ok: 'Dispensar', danger: true },
                        ).then((yes) => {
                          if (yes) void command({ c: 'release', pid: p.id });
                        })
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
