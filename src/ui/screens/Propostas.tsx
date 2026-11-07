import { useState } from 'react';
import type { Bid } from '../../engine/types';
import { bidDeadline, bidRoundsLeft } from '../../engine/transfers';
import { dateLabel, formatMoney } from '../../engine/util';
import { command, useMe } from '../../store';
import { ClubName, Empty, MoneyField, PosTag, Str, useSort } from '../common';
import { PlayerModal } from '../PlayerModal';

const STATUS: Record<Bid['status'], [string, string]> = {
  pendente: ['Pendente', 'info'],
  aceita: ['Aceita', 'good'],
  recusada: ['Recusada', 'bad'],
  contraproposta: ['Contraproposta', 'warn'],
  expirada: ['Expirada', ''],
  cancelada: ['Cancelada', ''],
};

export function Propostas() {
  const { state, club } = useMe();
  const [tab, setTab] = useState<'recebidas' | 'enviadas'>('recebidas');
  const [open, setOpen] = useState<number | null>(null);
  const [counter, setCounter] = useState<Record<number, number>>({});
  const bids = state && club ? Object.values(state.bids).sort((a, b) => b.id - a.id) : [];
  const received = bids.filter((b) => b.seller === club?.id);
  const sent = bids.filter((b) => b.buyer === club?.id);
  const other = (b: Bid) => (tab === 'recebidas' ? b.buyer : b.seller);
  const { sorted: list, th } = useSort(tab === 'recebidas' ? received : sent, { key: 'id', dir: -1 }, {
    id: (b) => b.id,
    name: (b) => state?.players[b.player]?.name ?? '',
    club: (b) => (other(b) != null ? (state?.clubs[other(b)!]?.name ?? '') : ''),
    kind: (b) => b.kind,
    fee: (b) => b.fee,
    wage: (b) => b.wage,
    status: (b) => b.status,
  });
  if (!state || !club) return null;

  return (
    <div className="col">
      <h1>Propostas</h1>
      <div className="tabs">
        <button className={tab === 'recebidas' ? 'active' : ''} onClick={() => setTab('recebidas')}>
          Recebidas ({received.filter((b) => b.status === 'pendente').length} pendentes)
        </button>
        <button className={tab === 'enviadas' ? 'active' : ''} onClick={() => setTab('enviadas')}>
          Enviadas
        </button>
      </div>
      <div className="panel tight">
        {list.length === 0 && <Empty>Nenhuma proposta.</Empty>}
        {list.length > 0 && (
          <table className="t">
            <thead>
              <tr>
                {th('name', 'Jogador')}
                {th('club', tab === 'recebidas' ? 'Comprador' : 'Vendedor')}
                {th('kind', 'Tipo')}
                {th('fee', 'Valor', 'right')}
                {th('wage', 'Salário', 'right')}
                {th('status', 'Situação')}
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((b) => {
                const p = state.players[b.player];
                const otherId = other(b);
                const [label, cls] = STATUS[b.status];
                return (
                  <tr key={b.id}>
                    <td>
                      {p ? (
                        <span className="row click" style={{ gap: 6, flexWrap: 'nowrap', cursor: 'pointer' }} onClick={() => setOpen(p.id)}>
                          <PosTag pos={p.pos} /> {p.name} <Str v={p.str} />
                        </span>
                      ) : (
                        <span className="faint">jogador aposentado</span>
                      )}
                    </td>
                    <td>{otherId != null ? <ClubName id={otherId} state={state} /> : <span className="pill good">livre</span>}</td>
                    <td className="small">{b.kind === 'emprestimo' ? `Empréstimo · ${b.months ?? 12} meses` : `Compra · ${b.years} ano(s)`}</td>
                    <td className="right num">{b.kind === 'emprestimo' ? <span className="faint">—</span> : formatMoney(b.fee)}</td>
                    <td className="right small num">{formatMoney(b.wage)}/mês</td>
                    <td>
                      <span className={`pill ${cls}`}>{label}</span>
                      {b.late && b.status === 'pendente' && (
                        <span className="pill bad pulse" style={{ marginLeft: 4 }} title="Proposta do último dia da janela: só vale nesta rodada">
                          ⏰ última hora
                        </span>
                      )}
                      {b.status === 'contraproposta' && b.counter != null && <div className="small warn">pede {formatMoney(b.counter)}</div>}
                      {b.msg && b.status !== 'pendente' && <div className="small faint">{b.msg}</div>}
                      {b.status === 'pendente' || b.status === 'contraproposta' ? (
                        <div className={`small ${bidRoundsLeft(state, b) <= 1 ? 'warn' : 'faint'}`} title="Sem resposta até lá, a proposta expira">
                          {bidRoundsLeft(state, b) <= 1 ? 'última rodada' : `${bidRoundsLeft(state, b)} rodadas`} · expira{' '}
                          {dateLabel(state, Math.min(bidDeadline(b), state.calendar.length - 1)).slice(0, 5)}
                        </div>
                      ) : (
                        <div className="small faint">{dateLabel(state, Math.min(b.date, state.calendar.length - 1)).slice(0, 5)}</div>
                      )}
                    </td>
                    <td className="right">
                      {tab === 'recebidas' && b.status === 'pendente' && (
                        <div className="col" style={{ gap: 4, alignItems: 'flex-end' }}>
                          <div className="row" style={{ gap: 4 }}>
                            <button className="btn sm primary" onClick={() => void command({ c: 'respondBid', bid: b.id, action: 'aceitar' })}>
                              Aceitar
                            </button>
                            <button className="btn sm danger" onClick={() => void command({ c: 'respondBid', bid: b.id, action: 'recusar' })}>
                              Recusar
                            </button>
                          </div>
                          {b.kind === 'compra' && (
                          <div className="row" style={{ gap: 4 }}>
                            <MoneyField
                              placeholder="Contraproposta"
                              width={130}
                              allowZero={false}
                              value={counter[b.id] ?? 0}
                              onChange={(v) => setCounter({ ...counter, [b.id]: v })}
                            />
                            <button
                              className="btn sm"
                              disabled={!counter[b.id]}
                              onClick={() => void command({ c: 'respondBid', bid: b.id, action: 'contraproposta', fee: counter[b.id] })}
                            >
                              Pedir
                            </button>
                          </div>
                          )}
                        </div>
                      )}
                      {tab === 'enviadas' && b.status === 'contraproposta' && (
                        <button className="btn sm primary" onClick={() => void command({ c: 'acceptCounter', bid: b.id })}>
                          Aceitar {formatMoney(b.counter ?? 0)}
                        </button>
                      )}
                      {tab === 'enviadas' && (b.status === 'pendente' || b.status === 'contraproposta') && (
                        <button className="btn sm ghost" onClick={() => void command({ c: 'cancelBid', bid: b.id })}>
                          Cancelar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {open != null && <PlayerModal pid={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
