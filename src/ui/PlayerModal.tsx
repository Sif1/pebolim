import { useState, type ReactNode } from 'react';
import { preContractBlock } from '../engine/commands';
import { askingPrice, auctionCanClose, refusesClub, statureGap, wageDemand, windowOpen } from '../engine/transfers';
import type { Club, GameState, Player } from '../engine/types';
import { absDateLabel, age, expectedWage, formatMoney, playerValue, roundMoney, squadOf } from '../engine/util';
import { command, useMe } from '../store';
import { ask } from './Confirm';
import { Portrait } from './Portrait';
import { Bar, ClubName, compLabel, Energy, Flag, Modal, MoneyField, PosTag, Stars, Str } from './common';

const TRAIT_LABEL: Record<string, string> = {
  finalizacao: 'Finalização',
  cabeceio: 'Cabeceio',
  velocidade: 'Velocidade',
  drible: 'Drible',
  passe: 'Passe',
  marcacao: 'Marcação',
  lideranca: 'Liderança',
  reflexos: 'Reflexos',
  cobrancas: 'Cobranças',
};

/** What each trait does in a match (shown as a tooltip). */
export const TRAIT_INFO: Record<string, string> = {
  finalizacao: 'Finaliza melhor e é escolhido mais vezes para chutar.',
  cabeceio: 'Ganha mais bolas aéreas e cabeceia com mais perigo.',
  velocidade: 'Passa mais pelo marcador em velocidade.',
  drible: 'Dribla com mais sucesso.',
  passe: 'Acerta mais passes curtos e lançamentos.',
  marcacao: 'Desarma sem fazer falta: leva menos cartões.',
  lideranca: 'Organiza o time: todos rendem um pouco mais com ele em campo.',
  reflexos: 'Goleiro de reflexos: defende mais chutes.',
  cobrancas: 'Bate pênaltis e faltas com mais precisão.',
};

export function traitLabel(t: string) {
  return TRAIT_LABEL[t] ?? t;
}

/** Trait chips with a tooltip explaining each. */
export function Traits({ traits, small }: { traits: string[]; small?: boolean }) {
  if (!traits.length) return null;
  return (
    <span className={`traits ${small ? 'small' : ''}`}>
      {traits.map((t) => (
        <span key={t} className="trait" title={TRAIT_INFO[t]}>
          {traitLabel(t)}
        </span>
      ))}
    </span>
  );
}

/** Money input in the short form ("2,5kk"). */
function MoneyInput({ value, onChange, step, width = 130 }: { value: number; onChange: (v: number) => void; step?: number; width?: number }) {
  return <MoneyField value={value} onChange={onChange} step={step} width={width} />;
}

/** Market status pills for a player (for sale, loan, auction, on loan). */
export function MarketPills({ p, state, compact }: { p: Player; state: GameState; compact?: boolean }) {
  if (compact)
    return (
      <>
        {p.salePrice != null && <span className="pill good" title={`À venda por ${formatMoney(p.salePrice)}`}>à venda</span>}
        {p.loanListed && <span className="pill info" title={`Disponível para empréstimo de ${p.loanListed} meses`}>emp. {p.loanListed}m</span>}
        {p.auction && <span className="pill warn" title={`Lance mínimo ${formatMoney(p.auction.min)}`}>leilão</span>}
        {p.loan && <span className="pill" title={`Volta em ${absDateLabel(state, p.loan.until)}`}>emprestado</span>}
        {p.pre && <span className="pill info" title={`Pré-contrato com o ${state.clubs[p.pre.club]?.name}`}>pré-contrato</span>}
      </>
    );
  return (
    <>
      {p.salePrice != null && <span className="pill good">à venda · {formatMoney(p.salePrice)}</span>}
      {p.loanListed && <span className="pill info">empréstimo {p.loanListed}m</span>}
      {p.auction && <span className="pill warn">leilão · mín. {formatMoney(p.auction.min)}</span>}
      {p.loan && <span className="pill">emprestado até {absDateLabel(state, p.loan.until).slice(3)}</span>}
      {p.pre && <span className="pill info">pré-contrato com o {state.clubs[p.pre.club]?.name}</span>}
    </>
  );
}

export function PlayerModal({ pid, onClose }: { pid: number; onClose: () => void }) {
  const { state, club } = useMe();
  const p = state?.players[pid];
  if (!state || !p) return null;
  const season = state.meta.season;
  const a = age(p, season);
  const value = playerValue(p, season);
  const mine = club && p.clubId === club.id;
  const owner = p.clubId != null ? state.clubs[p.clubId] : null;
  const banned = Object.entries(p.ban).filter(([, n]) => n > 0);

  return (
    <Modal onClose={onClose} wide>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Portrait id={p.id} nat={p.nat} age={a} pos={p.pos} kit={owner?.colors ?? ['#5b6b7d', '#d9e1ea']} num={p.num} size={76} />
        <div className="grow">
          <div className="row">
            <PosTag pos={p.pos} />
            <h2 style={{ margin: 0 }}>{p.name}</h2>
            <span className="muted">#{p.num}</span>
          </div>
          <div className="muted row" style={{ marginTop: 4, gap: 6 }}>
            <span>{a} anos</span>·<Flag nat={p.nat} label />·
            <span>{owner ? <ClubName id={owner.id} state={state} /> : 'Sem clube (livre)'}</span>
            {p.loan && <span className="pill warn">emprestado pelo {state.clubs[p.loan.from]?.name} até {absDateLabel(state, p.loan.until)}</span>}
          </div>
        </div>
        <div className="center">
          <div className="small faint">FORÇA</div>
          <div style={{ fontSize: 34 }}>
            <Str v={p.str} />
          </div>
        </div>
      </div>
      <div className="spacer" />
      <div className="grid3">
        <div className="stat">
          <span className="label">Valor de mercado</span>
          <span className="value">{formatMoney(value)}</span>
        </div>
        <div className="stat">
          <span className="label">Salário</span>
          <span className="value">{formatMoney(p.wage)}/mês</span>
        </div>
        <div className="stat">
          <span className="label">Contrato até</span>
          <span className="value">{p.clubId != null ? p.contractEnd : '—'}</span>
        </div>
        <div className="stat">
          <span className="label">Condição física</span>
          <Energy v={p.fitness} />
        </div>
        <div className="stat">
          <span className="label">Moral</span>
          <Bar v={p.morale} color="var(--info)" />
        </div>
        <div className="stat">
          <span className="label">Potencial (olheiros)</span>
          <span className="value">
            <Stars n={p.stars} />
            <span className="small muted"> até {Math.round(p.pot)}</span>
          </span>
        </div>
      </div>
      <div className="spacer" />
      <div className="row">
        {p.traits.length ? <Traits traits={p.traits} /> : <span className="small faint">Sem características especiais</span>}
        {p.injury > 0 && <span className="pill bad">Lesionado ({p.injury} jogos)</span>}
        {banned.map(([c, n]) => (
          <span key={c} className="pill warn">
            Suspenso {n}x ({compLabel(state, c)})
          </span>
        ))}
        <MarketPills p={{ ...p, loan: null }} state={state} />
      </div>
      <div className="spacer" />
      <div className="small muted">
        Temporada: {p.s.apps} jogos, {p.s.goals} gols, {p.s.ast} assistências, {p.s.yel} amarelos, {p.s.red} vermelhos · Carreira: {p.c.apps} jogos,{' '}
        {p.c.goals} gols
      </div>

      {club && !mine && !p.junior && <Compare p={p} club={club} state={state} />}
      {club && !mine && (p.auction ? <AuctionBid p={p} club={club} state={state} /> : <Offer key={p.id} p={p} club={club} state={state} onDone={onClose} />)}
      {mine && <Listing key={p.id} p={p} club={club} state={state} />}
      <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>
          Fechar
        </button>
      </div>
    </Modal>
  );
}

/**
 * The player next to your man at the same position (your starter there, else your best): who is better,
 * and would he play?
 */
function Compare({ p, club, state }: { p: Player; club: Club; state: GameState }) {
  const season = state.meta.season;
  const same = squadOf(state, club.id).filter((x) => x.pos === p.pos && !x.junior);
  if (!same.length)
    return (
      <div className="panel compare" style={{ marginTop: 14 }}>
        <h3>Comparação com o seu elenco</h3>
        <div className="good small">Você não tem nenhum jogador nessa posição: ele chegaria como titular.</div>
      </div>
    );
  const xi = new Set(club.lineup.xi.filter((x): x is number => x != null));
  const mine = [...same].sort((a, b) => Number(xi.has(b.id)) - Number(xi.has(a.id)) || b.str - a.str)[0];
  const d = Math.round(p.str) - Math.round(mine.str);
  const verdict =
    d >= 2
      ? { cls: 'good', text: `Seria titular: ${d} pontos de força acima de ${mine.name}.` }
      : d >= -1
        ? { cls: 'warn', text: `Disputaria posição com ${mine.name}.` }
        : { cls: 'bad', text: `Seria reserva: ${-d} pontos de força abaixo de ${mine.name}.` };
  const rt = (x: Player) => (x.s.apps ? (x.s.rt / x.s.apps / 10).toFixed(1) : '—');
  const rows: { k: string; a: ReactNode; b: ReactNode; better?: 0 | 1 | null }[] = [
    { k: 'Força', a: <Str v={p.str} />, b: <Str v={mine.str} />, better: cmp(p.str, mine.str) },
    { k: 'Idade', a: age(p, season), b: age(mine, season), better: cmp(age(mine, season), age(p, season)) },
    { k: 'Potencial', a: <Stars n={p.stars} />, b: <Stars n={mine.stars} />, better: cmp(p.stars, mine.stars) },
    { k: 'Salário', a: formatMoney(p.clubId != null ? wageDemand(state, p, club) : expectedWage(p, season, club.rep)), b: formatMoney(mine.wage), better: null },
    { k: 'Temporada', a: `${p.s.apps} j · ${p.s.goals} g · nota ${rt(p)}`, b: `${mine.s.apps} j · ${mine.s.goals} g · nota ${rt(mine)}`, better: null },
    { k: 'Características', a: <Traits traits={p.traits} small />, b: <Traits traits={mine.traits} small />, better: null },
  ];
  return (
    <div className="panel compare" style={{ marginTop: 14 }}>
      <h3>Comparação com o seu elenco</h3>
      <table className="t compare-t">
        <thead>
          <tr>
            <th />
            <th>{p.name}</th>
            <th>
              {mine.name} <span className="faint small">{xi.has(mine.id) ? '(titular)' : '(seu melhor)'}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.k}>
              <td className="muted small">{r.k}</td>
              <td className={r.better === 0 ? 'better' : ''}>{r.a}</td>
              <td className={r.better === 1 ? 'better' : ''}>{r.b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={`small ${verdict.cls}`} style={{ marginTop: 6 }}>
        {verdict.text}
      </div>
    </div>
  );
}

/** Which side is better: 0 = the first, 1 = the second, null = about the same. */
const cmp = (a: number, b: number): 0 | 1 | null => (a > b + 0.5 ? 0 : b > a + 0.5 ? 1 : null);

/** Buy or borrow another club's player (or sign a free agent). */
function Offer({ p, club, state, onDone }: { p: Player; club: Club; state: GameState; onDone: () => void }) {
  const season = state.meta.season;
  const owner = p.clubId != null ? state.clubs[p.clubId] : null;
  const value = playerValue(p, season);
  const ask = owner && !owner.managerId ? askingPrice(state, p) : p.salePrice;
  const demand = wageDemand(state, p, club);
  const preOk = owner != null && !preContractBlock(state, p) && !p.pre;
  const [kind, setKind] = useState<'compra' | 6 | 12 | 'pre'>(preOk && !windowOpen(state) ? 'pre' : p.salePrice == null && p.loanListed ? p.loanListed : 'compra');
  const [fee, setFee] = useState(ask ?? value);
  const [wage, setWage] = useState(owner ? demand : expectedWage(p, season, club.rep));
  const [years, setYears] = useState(3);
  const winOpen = windowOpen(state);
  const pre = kind === 'pre';
  const loan = kind === 6 || kind === 12;
  const blocked = !!p.loan || (owner != null && !winOpen && !pre);

  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <h3>{owner ? 'Fazer proposta' : 'Contratar jogador livre'}</h3>
      {owner && !winOpen && <div className="warn small">A janela de transferências está fechada. Só jogadores livres podem ser contratados agora.</div>}
      {p.loan && <div className="warn small">Jogador emprestado: não pode ser negociado agora.</div>}
      {p.pre && <div className="warn small">Já assinou pré-contrato com o {state.clubs[p.pre.club]?.name}: chega lá em {season + 1}.</div>}
      {refusesClub(state, p, club) ? (
        <div className="bad small">{`${p.name} não quer jogar no ${club.name}: ele espera um clube maior.`}</div>
      ) : statureGap(state, p, club) > 0 ? (
        <div className="warn small">{`O ${club.name} está abaixo do que ele espera: ele só vem por um salário mais alto.`}</div>
      ) : null}
      {preOk && (
        <div className="small good">Contrato até {season}: dá para assinar um pré-contrato. Ele chega de graça em {season + 1}, mesmo com a janela fechada.</div>
      )}
      {(p.salePrice != null || p.loanListed) && (
        <div className="small good">
          {p.salePrice != null && <>O {owner?.name} aceita vender por {formatMoney(p.salePrice)}. </>}
          {p.loanListed && <>Disponível para empréstimo de {p.loanListed} meses.</>}
        </div>
      )}
      <div className="row" style={{ marginTop: 8, alignItems: 'flex-end' }}>
        {owner && (
          <label className="field">
            Tipo
            <select
              value={String(kind)}
              onChange={(e) => setKind(e.target.value === 'compra' || e.target.value === 'pre' ? e.target.value : (Number(e.target.value) as 6 | 12))}
            >
              <option value="compra">Compra</option>
              {preOk && <option value="pre">Pré-contrato (de graça em {season + 1})</option>}
              {(p.loanListed ? [p.loanListed] : [6, 12]).map((m) => (
                <option key={m} value={m}>
                  Empréstimo ({m} meses)
                </option>
              ))}
            </select>
          </label>
        )}
        {owner && !loan && !pre && (
          <label className="field">
            Valor
            <MoneyInput value={fee} onChange={setFee} step={value > 5_000_000 ? 250_000 : 50_000} />
          </label>
        )}
        {!loan && (
          <label className="field">
            Salário mensal
            <MoneyInput value={wage} onChange={setWage} step={1000} width={110} />
          </label>
        )}
        {!loan && (
          <label className="field">
            Anos
            <select value={years} onChange={(e) => setYears(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </label>
        )}
        <button
          className="btn primary"
          disabled={blocked}
          onClick={async () => {
            if (pre) {
              const r = await command({ c: 'preContract', pid: p.id, wage: Math.round(wage), years });
              if (r.ok) onDone();
              return;
            }
            const r = await command({
              c: 'bid',
              pid: p.id,
              kind: loan && owner ? 'emprestimo' : 'compra',
              fee: loan ? 0 : roundMoney(fee),
              wage: loan ? p.wage : Math.round(wage),
              years,
              ...(loan ? { months: kind as 6 | 12 } : {}),
            });
            if (r.ok) onDone();
          }}
        >
          {!owner ? 'Contratar' : pre ? 'Assinar pré-contrato' : loan ? 'Pedir emprestado' : 'Enviar proposta'}
        </button>
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>
        {loan ? (
          <>
            Sem custo de transferência: você paga o salário dele ({formatMoney(p.wage)}/mês) durante o empréstimo e ele volta ao {owner?.name} no fim. ·{' '}
          </>
        ) : (
          <>
            {ask != null && <>Pedida: ~{formatMoney(ask)} · </>}
            Pretensão salarial: ~{formatMoney(owner ? demand : expectedWage(p, season, club.rep))}/mês ·{' '}
          </>
        )}
        {owner?.managerId && <>Clube de outro treinador: ele decide{p.salePrice != null || p.loanListed ? ', a menos que você aceite as condições dele' : ''} · </>}
        Seu caixa: {formatMoney(club.balance)}
      </div>
    </div>
  );
}

/** Sealed bid on a player up for auction. */
function AuctionBid({ p, club, state }: { p: Player; club: Club; state: GameState }) {
  const a = p.auction!;
  const mineBid = state.auctionBids[p.id]?.[club.id] ?? null;
  const [amount, setAmount] = useState(mineBid ?? a.min);
  const value = playerValue(p, state.meta.season);
  return (
    <div className="panel auction" style={{ marginTop: 14 }}>
      <h3>Leilão</h3>
      <div className="small">
        Lance mínimo <b>{formatMoney(a.min)}</b> (valor de mercado {formatMoney(value)}). Os lances são fechados: ninguém vê o lance dos outros. O maior
        lance leva o jogador no início da próxima rodada, e clubes da IA também participam.
      </div>
      <div className="row" style={{ marginTop: 8, alignItems: 'flex-end' }}>
        <label className="field">
          Seu lance
          <MoneyInput value={amount} onChange={setAmount} step={value > 5_000_000 ? 250_000 : 50_000} />
        </label>
        <button className="btn primary" disabled={amount < a.min || amount > club.balance} onClick={() => void command({ c: 'auctionBid', pid: p.id, amount: roundMoney(amount) })}>
          {mineBid != null ? 'Atualizar lance' : 'Dar lance'}
        </button>
        {mineBid != null && (
          <button className="btn ghost" onClick={() => void command({ c: 'auctionBid', pid: p.id, amount: null })}>
            Retirar lance
          </button>
        )}
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>
        {mineBid != null ? <>Seu lance atual: {formatMoney(mineBid)} · </> : null}O vencedor paga o salário que ele pedir (~{formatMoney(wageDemand(state, p, club))}/mês) ·
        Seu caixa: {formatMoney(club.balance)}
      </div>
    </div>
  );
}

/** Your own player: set a sale price, offer him on loan, or put him up for auction. */
function Listing({ p, club, state }: { p: Player; club: Club; state: GameState }) {
  const value = playerValue(p, state.meta.season);
  const [price, setPrice] = useState(p.salePrice ?? roundMoney(value));
  const [months, setMonths] = useState<6 | 12>(p.loanListed ?? 12);
  const [min, setMin] = useState(roundMoney(value * 0.6));
  const winOpen = windowOpen(state) && auctionCanClose(state);
  const step = value > 5_000_000 ? 250_000 : 50_000;
  const squadSize = squadOf(state, club.id).length;

  if (p.loan) {
    return (
      <div className="panel" style={{ marginTop: 14 }}>
        <div className="small muted">
          Emprestado pelo {state.clubs[p.loan.from]?.name}: volta para lá em {absDateLabel(state, p.loan.until)}. Você paga o salário até lá.
        </div>
      </div>
    );
  }
  if (p.auction) {
    const n = Object.keys(state.auctionBids[p.id] ?? {}).length;
    return (
      <div className="panel auction" style={{ marginTop: 14 }}>
        <h3>Em leilão</h3>
        <div className="small">
          Lance mínimo {formatMoney(p.auction.min)}. O leilão fecha no início da próxima rodada: o maior lance (de treinadores ou da IA) leva o jogador.
          {n > 0 && <> Já há {n} lance{n > 1 ? 's' : ''} de treinadores.</>}
        </div>
      </div>
    );
  }
  return (
    <div className="panel col" style={{ marginTop: 14, gap: 10 }}>
      <h3>Negociar jogador</h3>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field">
          Preço de venda
          <MoneyInput value={price} onChange={setPrice} step={step} />
        </label>
        <button className="btn primary" onClick={() => void command({ c: 'setSale', pid: p.id, price: roundMoney(price) })}>
          {p.salePrice != null ? 'Atualizar preço' : 'Colocar à venda'}
        </button>
        {p.salePrice != null && (
          <button className="btn ghost" onClick={() => void command({ c: 'setSale', pid: p.id, price: null })}>
            Tirar da venda
          </button>
        )}
        <span className="small muted grow">Quem pagar o preço leva na hora (clubes da IA e outros treinadores).</span>
      </div>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field">
          Empréstimo
          <select value={months} onChange={(e) => setMonths(Number(e.target.value) as 6 | 12)}>
            <option value={6}>6 meses</option>
            <option value={12}>12 meses</option>
          </select>
        </label>
        <button className="btn" onClick={() => void command({ c: 'setLoanList', pid: p.id, months })}>
          {p.loanListed ? 'Atualizar' : 'Disponibilizar para empréstimo'}
        </button>
        {p.loanListed && (
          <button className="btn ghost" onClick={() => void command({ c: 'setLoanList', pid: p.id, months: null })}>
            Retirar
          </button>
        )}
        <span className="small muted grow">Quem pegar emprestado paga o salário dele ({formatMoney(p.wage)}/mês).</span>
      </div>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field">
          Leilão: lance mínimo
          <MoneyInput value={min} onChange={setMin} step={step} />
        </label>
        <button
          className="btn warn-btn"
          disabled={!winOpen || squadSize <= 17}
          onClick={async () => {
            const yes = await ask({
              title: `Leiloar ${p.name}?`,
              text: `Não dá para cancelar: o maior lance acima de ${formatMoney(min)} leva o jogador no início da próxima rodada.`,
              ok: 'Leiloar',
              danger: true,
            });
            if (yes) void command({ c: 'startAuction', pid: p.id, min: roundMoney(min) });
          }}
        >
          Leiloar
        </button>
        <span className="small muted grow">
          {!winOpen ? 'Só com a janela aberta até a próxima rodada. ' : squadSize <= 17 ? 'Elenco curto demais para leiloar. ' : ''}
          Todos os treinadores e a IA dão lances até a próxima rodada; sem lance mínimo, ele fica.
        </span>
      </div>
    </div>
  );
}
