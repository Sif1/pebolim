import { useState } from 'react';
import { DATES_PER_SEASON } from '../../engine/economy';
import { formatMoney, squadOf } from '../../engine/util';
import { defaultTicket } from '../../engine/world';
import { command, useMe } from '../../store';
import { Money } from '../common';

export function Financas() {
  const { state, club } = useMe();
  const [ticket, setTicket] = useState<number | null>(null);
  if (!state || !club) return null;
  const l = club.ledger;
  const income = l.tickets + l.sponsors + l.tv + l.prizes + l.sales;
  const expense = l.wages + l.upkeep + l.travel + l.purchases + l.works;
  const wages = squadOf(state, club.id).reduce((a, p) => a + p.wage, 0);
  const ref = defaultTicket(club);
  const t = ticket ?? club.ticket;
  const lastHome = Object.values(state.fixtures)
    .filter((f) => f.home === club.id && f.hg != null)
    .sort((a, b) => b.date - a.date)[0];

  return (
    <div className="col">
      <h1>Finanças</h1>
      <div className="panel grid3">
        <div className="stat">
          <span className="label">Caixa</span>
          <span className="value">
            <Money v={club.balance} />
          </span>
        </div>
        <div className="stat">
          <span className="label">Saldo da temporada</span>
          <span className="value">
            <Money v={income - expense} />
          </span>
        </div>
        <div className="stat">
          <span className="label">Folha salarial</span>
          <span className="value">{formatMoney(wages)}/mês</span>
        </div>
        <div className="stat">
          <span className="label">Patrocínio + TV (ano)</span>
          <span className="value">{formatMoney(club.baseIncome)}</span>
        </div>
        <div className="stat">
          <span className="label">Custo por rodada (salários)</span>
          <span className="value">{formatMoney((wages * 12) / DATES_PER_SEASON)}</span>
        </div>
      </div>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="panel">
          <h3>Receitas da temporada</h3>
          <Ledger
            rows={[
              ['Bilheteria', l.tickets],
              ['Patrocínio', l.sponsors],
              ['Direitos de TV', l.tv],
              ['Premiações', l.prizes],
              ['Venda de jogadores', l.sales],
            ]}
            total={income}
          />
        </div>
        <div className="panel">
          <h3>Despesas da temporada</h3>
          <Ledger
            rows={[
              ['Salários e rescisões', l.wages],
              ['Manutenção (estádio e CT)', l.upkeep],
              ['Viagens', l.travel],
              ['Compra de jogadores', l.purchases],
              ['Obras', l.works],
            ]}
            total={expense}
          />
        </div>
      </div>
      <div className="panel col">
        <h3>Ingressos</h3>
        <div className="row">
          <input type="range" min={Math.round(ref * 0.3)} max={Math.round(ref * 3)} value={t} onChange={(e) => setTicket(Number(e.target.value))} style={{ width: 280 }} />
          <b>R$ {t}</b>
          <span className="small muted">(preço de referência para o clube: R$ {ref})</span>
          <button className="btn primary" disabled={t === club.ticket} onClick={() => void command({ c: 'setTicket', price: t }).then(() => setTicket(null))}>
            Salvar preço
          </button>
        </div>
        <div className="small muted">
          Ingresso caro reduz o público; barato lota o estádio mas rende menos por torcedor. Fase do time, adversário e competição também contam.
          {lastHome && (
            <>
              {' '}
              Último jogo em casa: {lastHome.att.toLocaleString('pt-BR')} torcedores de {club.capacity.toLocaleString('pt-BR')}.
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Ledger({ rows, total }: { rows: [string, number][]; total: number }) {
  return (
    <table className="t">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td>{k}</td>
            <td className="right">
              <Money v={v} />
            </td>
          </tr>
        ))}
        <tr>
          <td>
            <b>Total</b>
          </td>
          <td className="right">
            <b>
              <Money v={total} />
            </b>
          </td>
        </tr>
      </tbody>
    </table>
  );
}
