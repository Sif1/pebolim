import { useEffect, useState } from 'react';
import type { Club, GameState, Player } from '../engine/types';
import { age, formatMoney, playerValue, roundMoney } from '../engine/util';
import { command, useMe } from '../store';
import { ClubBadge, Empty, Flag, Modal, PosTag, Stars, Str, useSort } from './common';
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
      <input
        type="number"
        min={p.auction!.min}
        step={p.auction!.min > 5_000_000 ? 250_000 : 50_000}
        value={amount}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setAmount(Number(e.target.value))}
        style={{ width: 110 }}
      />
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
    pot: (p) => p.stars * 100 + p.pot,
    min: (p) => p.auction!.min,
    val: (p) => playerValue(p, season),
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
                  <PosTag pos={p.pos} />
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
                  <Stars n={p.stars} />
                </td>
                <td>
                  <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <ClubBadge club={pc} size={18} />
                    <span className="small nowrap">{pc.name}</span>
                  </span>
                </td>
                <td className="right small num">{formatMoney(playerValue(p, season))}</td>
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

/** After each match day: if other clubs have players up for auction, show them once. */
export function AuctionPopup() {
  const { state, club, manager } = useMe();
  const [show, setShow] = useState(false);
  const key = state ? `${state.meta.season}-${state.meta.date}` : '';
  const count = state && club ? openAuctions(state).filter((p) => p.clubId !== club.id).length : 0;
  useEffect(() => {
    if (!manager || !count) return;
    const storeKey = `pebolim.auctionsSeen.${manager.id}`;
    let seen = '';
    try {
      seen = localStorage.getItem(storeKey) ?? '';
    } catch {
      /* private mode */
    }
    if (seen === key) return;
    setShow(true);
    try {
      localStorage.setItem(storeKey, key);
    } catch {
      /* ignore */
    }
  }, [key, count, manager]);
  if (!show || !count) return null;
  return (
    <Modal onClose={() => setShow(false)} wide>
      <div className="row">
        <h2 className="grow" style={{ margin: 0 }}>
          Leilões abertos ({count})
        </h2>
        <button className="btn ghost" onClick={() => setShow(false)}>
          Fechar
        </button>
      </div>
      <div className="small muted" style={{ margin: '6px 0 10px' }}>
        Estes jogadores vão para quem der o maior lance até o início da próxima rodada. Você também os encontra em Mercado → Leilões.
      </div>
      <div className="panel tight scroll" style={{ maxHeight: '60vh' }}>
        <AuctionList />
      </div>
    </Modal>
  );
}
