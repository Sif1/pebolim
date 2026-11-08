import { useState } from 'react';
import type { Club, GameState, Player } from '../engine/types';
import { age, dateLabel, formatMoney, marketValue, roundMoney } from '../engine/util';
import { command, useMe } from '../store';
import { ClubBadge, Empty, Flag, MoneyField, PosTag, PotStars, seenStars, Str, useSort } from './common';
import { PlayerModal, Traits } from './PlayerModal';

/** Players up for auction right now (own ones included, marked). */
export function openAuctions(state: GameState): Player[] {
  return Object.values(state.players).filter((p) => p.auction && p.clubId != null);
}

/** Inline sealed bid: amount box plus a button; shows your current bid. */
function QuickBid({ p, club, state }: { p: Player; club: Club; state: GameState }) {
  const mine = state.auctionBids[p.id]?.[club.id] ?? null;
  const [amount, setAmount] = useState(mine ?? p.auction!.min);
  return (
    <span className="row" style={{ gap: 4, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
      <MoneyField value={amount} onChange={setAmount} width={110} />
      <button
        className="btn sm primary"
        disabled={amount < p.auction!.min || amount > club.balance}
        onClick={(e) => {
          e.stopPropagation();
          void command({ c: 'auctionBid', pid: p.id, amount: roundMoney(amount) });
        }}
      >
        {mine != null ? 'Atualizar' : 'Lance'}
      </button>
      {mine != null && (
        <button
          className="btn sm ghost"
          title="Retirar lance"
          onClick={(e) => {
            e.stopPropagation();
            void command({ c: 'auctionBid', pid: p.id, amount: null });
          }}
        >
          ✕
        </button>
      )}
    </span>
  );
}

/** Table of open auctions with sealed bids. */
export function AuctionList() {
  const { state, club } = useMe();
  const [open, setOpen] = useState<number | null>(null);
  const list = state ? openAuctions(state) : [];
  const season = state?.meta.season ?? 0;
  const { sorted, th } = useSort(list, { key: 'str', dir: -1 }, {
    name: (p) => p.name,
    pos: (p) => p.pos,
    age: (p) => age(p, season),
    str: (p) => p.str,
    pot: (p) => seenStars(state, club?.id ?? null, p) * 100 + p.str,
    min: (p) => p.auction!.min,
    val: (p) => marketValue(p, state!),
    mine: (p) => (club ? (state!.auctionBids[p.id]?.[club.id] ?? 0) : 0),
  });
  if (!state || !club) return null;
  if (!list.length) return <Empty>Nenhum jogador em leilão agora. Clubes da IA leiloam jogadores durante as janelas de transferência.</Empty>;
  return (
    <>
      <table className="t">
        <thead>
          <tr>
            {th('pos', 'Pos')}
            {th('name', 'Nome')}
            {th('age', 'Idade', 'center')}
            {th('str', 'Força', 'center')}
            {th('pot', 'Pot.', 'center')}
            <th>Clube</th>
            {th('val', 'Valor', 'right')}
            {th('min', 'Lance mín.', 'right')}
            {th('mine', 'Seu lance', 'right')}
            <th />
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => {
            const pc = state.clubs[p.clubId!];
            const own = pc.id === club.id;
            const mine = state.auctionBids[p.id]?.[club.id];
            return (
              <tr key={p.id} className="click" onClick={() => setOpen(p.id)}>
                <td>
                  <PosTag pos={p.pos} flank={p.flank} />
                </td>
                <td>
                  <span className="nowrap">{p.name}</span> <Flag nat={p.nat} />
                  <div>
                    <Traits traits={p.traits} small />
                  </div>
                </td>
                <td className="center num">{age(p, season)}</td>
                <td className="center">
                  <Str v={p.str} />
                </td>
                <td className="center">
                  <PotStars p={p} />
                </td>
                <td>
                  <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <ClubBadge club={pc} size={18} />
                    <span className="small nowrap">{pc.name}</span>
                  </span>
                </td>
                <td className="right small num">{formatMoney(marketValue(p, state))}</td>
                <td className="right num warn">{formatMoney(p.auction!.min)}</td>
                <td className="right num">{mine != null ? <b className="good">{formatMoney(mine)}</b> : <span className="faint">—</span>}</td>
                <td className="right">{own ? <span className="pill">seu jogador</span> : <QuickBid p={p} club={club} state={state} />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="small muted" style={{ padding: '6px 8px' }}>
        Lances fechados: ninguém vê o lance dos outros. Os leilões fecham no início da próxima rodada e o maior lance leva (a IA também dá lances). Seu caixa:{' '}
        {formatMoney(club.balance)}.
      </div>
      {open != null && <PlayerModal pid={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Finished auctions: who bought, for how much, or why nobody did. Newest first. */
export function AuctionHistory() {
  const { state, club } = useMe();
  const log = state?.auctionLog ?? [];
  const { sorted, th } = useSort(log, { key: 'when', dir: -1 }, {
    when: (r) => r.season * 100 + r.date,
    name: (r) => r.name,
    str: (r) => r.str,
    age: (r) => r.age,
    amount: (r) => r.amount ?? -1,
    min: (r) => r.min,
    bids: (r) => r.bids,
  });
  if (!state) return null;
  if (!log.length) return <Empty>Nenhum leilão terminou ainda.</Empty>;
  return (
    <table className="t">
      <thead>
        <tr>
          {th('when', 'Data')}
          {th('name', 'Jogador')}
          {th('age', 'Idade', 'center')}
          {th('str', 'Força', 'center')}
          <th>Vendedor</th>
          <th>Resultado</th>
          {th('amount', 'Valor', 'right')}
          {th('min', 'Mínimo', 'right')}
          {th('bids', 'Lances', 'center')}
          {club && <th className="right">Seu lance</th>}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r, i) => {
          const from = state.clubs[r.from];
          const to = r.to != null ? state.clubs[r.to] : null;
          const mine = club ? r.human[club.id] : undefined;
          const won = club != null && r.to === club.id;
          return (
            <tr key={`${r.pid}-${r.season}-${r.date}-${i}`} className={won || (club && r.from === club.id) ? 'me' : ''}>
              <td className="small nowrap">{r.season === state.meta.season ? dateLabel(state, Math.min(r.date, state.calendar.length - 1)).slice(0, 5) : r.season}</td>
              <td>
                <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                  <PosTag pos={r.pos} /> <span className="nowrap">{r.name}</span>
                </span>
              </td>
              <td className="center num">{r.age}</td>
              <td className="center">
                <Str v={r.str} />
              </td>
              <td>
                <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                  <ClubBadge club={from} size={16} />
                  <span className="small nowrap">{from?.name}</span>
                </span>
              </td>
              <td>
                {to ? (
                  <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <span className="pill good">vendido</span>
                    <ClubBadge club={to} size={16} />
                    <span className="small nowrap">{to.name}</span>
                  </span>
                ) : r.cancelled ? (
                  <span className="pill">cancelado (janela fechou)</span>
                ) : (
                  <span className="pill bad">sem lance mínimo</span>
                )}
              </td>
              <td className="right num">{r.amount != null ? <b>{formatMoney(r.amount)}</b> : <span className="faint">—</span>}</td>
              <td className="right small num">{formatMoney(r.min)}</td>
              <td className="center num">{r.bids || '—'}</td>
              {club && (
                <td className="right small num">
                  {mine != null ? <span className={won ? 'good' : 'bad'}>{formatMoney(mine)} {won ? '· levou' : '· perdeu'}</span> : <span className="faint">—</span>}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
