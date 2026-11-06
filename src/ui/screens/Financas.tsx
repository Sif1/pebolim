import { useState } from 'react';
import { clubComps, DATES_PER_SEASON, estimateGate, SECTORS, sectorBounds, usableCapacity } from '../../engine/economy';
import type { Club, GameState, SectorPrices } from '../../engine/types';
import { formatMoney, squadOf } from '../../engine/util';
import { command, useMe } from '../../store';
import { Money } from '../common';

export function Financas() {
  const { state, club } = useMe();
  if (!state || !club) return null;
  const l = club.ledger;
  const income = l.tickets + l.sponsors + l.tv + l.prizes + l.sales;
  const expense = l.wages + l.upkeep + l.travel + l.purchases + l.works;
  const wages = squadOf(state, club.id).reduce((a, p) => a + p.wage, 0);
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
        <h3>Ingressos por setor e competição</h3>
        <div className="small muted">
          Cada setor tem seu público: a geral reage muito ao preço, o camarote quase nada. Defina um preço padrão e, se quiser, preços próprios
          para cada competição. Fase do time, adversário e fase da competição também mudam o público.
          {lastHome && (
            <>
              {' '}
              Último jogo em casa: {lastHome.att.toLocaleString('pt-BR')} torcedores de {usableCapacity(club).toLocaleString('pt-BR')} lugares.
            </>
          )}
        </div>
        <TicketTable state={state} club={club} />
      </div>
    </div>
  );
}

function TicketTable({ state, club }: { state: GameState; club: Club }) {
  const comps = clubComps(state, club.id);
  const [draft, setDraft] = useState<Record<string, SectorPrices>>({});
  const rows: { id: string | null; name: string }[] = [{ id: null, name: 'Padrão' }, ...comps.map((c) => ({ id: c.id, name: c.cfg.name }))];
  const key = (id: string | null) => id ?? '_base';
  const saved = (id: string | null) => (id == null ? club.tickets.base : (club.tickets.comps[id] ?? null));
  const current = (id: string | null) => draft[key(id)] ?? saved(id) ?? club.tickets.base;
  const setPrice = (id: string | null, i: number, v: number) => {
    const next = [...current(id)] as SectorPrices;
    next[i] = v;
    setDraft({ ...draft, [key(id)]: next });
  };
  const clear = (id: string | null) => {
    const d = { ...draft };
    delete d[key(id)];
    setDraft(d);
  };
  return (
    <table className="t">
      <thead>
        <tr>
          <th>Competição</th>
          {SECTORS.map((s, i) => (
            <th key={s.label} className="right" title={`${Math.round(s.share * 100)}% dos lugares`}>
              {s.label}
              <div className="faint small">
                R$ {sectorBounds(club, i)[0]}–{sectorBounds(club, i)[1]}
              </div>
            </th>
          ))}
          <th className="right">Público estimado</th>
          <th className="right">Renda estimada</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const prices = current(r.id);
          const own = r.id == null || saved(r.id) != null || draft[key(r.id)] != null;
          const est = estimateGate(state, club, r.id ?? club.league ?? comps[0]?.id ?? '', prices);
          const dirty = draft[key(r.id)] != null;
          return (
            <tr key={key(r.id)} style={{ opacity: own ? 1 : 0.6 }}>
              <td>
                {r.name}
                {!own && <div className="faint small">usa o padrão</div>}
              </td>
              {prices.map((p, i) => (
                <td key={i} className="right">
                  <input
                    type="number"
                    value={p}
                    min={sectorBounds(club, i)[0]}
                    max={sectorBounds(club, i)[1]}
                    style={{ width: 76, textAlign: 'right' }}
                    onChange={(e) => setPrice(r.id, i, Number(e.target.value))}
                  />
                </td>
              ))}
              <td className="right num">
                {est.total.toLocaleString('pt-BR')}
                <div className="faint small">{Math.round((est.total / Math.max(1, usableCapacity(club))) * 100)}% lotado</div>
              </td>
              <td className="right num">{formatMoney(est.revenue)}</td>
              <td className="right nowrap">
                <button
                  className="btn sm primary"
                  disabled={!dirty}
                  onClick={() => void command({ c: 'setTickets', comp: r.id, prices }).then((res) => res.ok && clear(r.id))}
                >
                  Salvar
                </button>
                {r.id != null && saved(r.id) != null && (
                  <button className="btn sm ghost" onClick={() => void command({ c: 'setTickets', comp: r.id, prices: null }).then(() => clear(r.id))}>
                    Usar padrão
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
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
