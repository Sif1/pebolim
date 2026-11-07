import { useMemo, useState } from 'react';
import { windowOpen } from '../../engine/transfers';
import { POSITIONS, TRAITS, type Player, type Pos, type Trait } from '../../engine/types';
import { age, formatMoney, playerValue } from '../../engine/util';
import { useMe } from '../../store';
import { ClubBadge, COUNTRY_NAME, Flag, MoneyField, PosTag, Stars, Str, useSort } from '../common';
import { MarketPills, PlayerModal, Traits, traitLabel } from '../PlayerModal';


interface Filters {
  q: string;
  pos: Pos | '';
  ageMin: number;
  ageMax: number;
  strMin: number;
  strMax: number;
  maxValue: number;
  nat: string;
  league: string;
  status: 'todos' | 'livres' | 'fim' | 'venda' | 'emprestimo' | 'leilao' | 'negociaveis';
  trait: Trait | '';
  stars: number;
}

const DEFAULT: Filters = {
  q: '',
  pos: '',
  ageMin: 16,
  ageMax: 40,
  strMin: 1,
  strMax: 99,
  maxValue: 0,
  nat: '',
  league: '',
  status: 'todos',
  trait: '',
  stars: 0,
};

/** Brasfoot-style player search. Runs entirely on this player's replica: nobody else sees it. */
export function Mercado() {
  const { state, club } = useMe();
  const [f, setF] = useState<Filters>(() => {
    try {
      return { ...DEFAULT, ...JSON.parse(localStorage.getItem('pebolim.search') ?? '{}') };
    } catch {
      return DEFAULT;
    }
  });
  const [open, setOpen] = useState<number | null>(null);
  const set = (p: Partial<Filters>) => {
    const next = { ...f, ...p };
    setF(next);
    try {
      localStorage.setItem('pebolim.search', JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const season = state?.meta.season ?? 0;
  const nats = useMemo(() => (state ? [...new Set(Object.values(state.players).map((p) => p.nat))].sort() : []), [state?.meta.season]);
  const results = useMemo(() => {
    if (!state || !club) return [];
    const q = f.q.trim().toLowerCase();
    const out: Player[] = [];
    for (const id in state.players) {
      const p = state.players[id];
      // own players and other clubs' youth teams are not on the market
      if (p.clubId === club.id || p.junior) continue;
      if (q && !p.name.toLowerCase().includes(q)) continue;
      if (f.pos && p.pos !== f.pos) continue;
      const a = season - p.birth;
      if (a < f.ageMin || a > f.ageMax) continue;
      if (p.str < f.strMin || p.str > f.strMax + 0.99) continue;
      if (f.nat && p.nat !== f.nat) continue;
      const pc = p.clubId != null ? state.clubs[p.clubId] : null;
      if (f.league) {
        if (f.league === 'livres' ? pc != null : pc?.league !== f.league && !(f.league === 'cont' && pc?.contOnly)) continue;
      }
      if (f.status === 'livres' && p.clubId != null) continue;
      if (f.status === 'fim' && !(p.clubId != null && p.contractEnd <= season)) continue;
      if (f.status === 'venda' && p.salePrice == null) continue;
      if (f.status === 'emprestimo' && !p.loanListed) continue;
      if (f.status === 'leilao' && !p.auction) continue;
      if (f.status === 'negociaveis' && p.salePrice == null && !p.loanListed && !p.auction) continue;
      if (f.trait && !p.traits.includes(f.trait)) continue;
      if (f.stars && p.stars < f.stars) continue;
      if (f.maxValue > 0 && playerValue(p, season) > f.maxValue) continue;
      out.push(p);
    }
    return out;
  }, [state, club, f, season]);

  const { sorted, th } = useSort(results, { key: 'str', dir: -1 }, {
    name: (p) => p.name,
    pos: (p) => p.pos,
    age: (p) => age(p, season),
    str: (p) => p.str,
    pot: (p) => p.stars * 100 + p.pot,
    nat: (p) => COUNTRY_NAME[p.nat] ?? p.nat,
    ask: (p) => p.auction?.min ?? p.salePrice ?? playerValue(p, season),
    val: (p) => playerValue(p, season),
    wage: (p) => p.wage,
    club: (p) => (p.clubId != null ? state!.clubs[p.clubId].name : ''),
    con: (p) => p.contractEnd,
  });

  if (!state || !club) return null;
  const leagues = state.config.filter((c) => c.kind === 'league');
  const shown = sorted.slice(0, 250);

  return (
    <div className="col">
      <div className="row">
        <h1 className="grow">Buscar jogadores</h1>
        {windowOpen(state) ? <span className="pill good">Janela aberta</span> : <span className="pill warn">Janela fechada · só jogadores livres</span>}
        <span className="muted">Caixa: {formatMoney(club.balance)}</span>
      </div>
      <div className="panel col">
        <div className="row">
          <input type="search" placeholder="Nome do jogador" value={f.q} onChange={(e) => set({ q: e.target.value })} style={{ width: 200 }} />
          <select value={f.pos} onChange={(e) => set({ pos: e.target.value as Pos | '' })}>
            <option value="">Todas as posições</option>
            {POSITIONS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <select value={f.league} onChange={(e) => set({ league: e.target.value })}>
            <option value="">Todas as ligas</option>
            <option value="livres">Sem clube</option>
            <option value="cont">Clubes de outros países (copas)</option>
            {leagues.map((l) => (
              <option key={l.id} value={l.id}>
                {COUNTRY_NAME[l.country ?? ''] ?? l.country} — {l.short}
              </option>
            ))}
          </select>
          <select value={f.nat} onChange={(e) => set({ nat: e.target.value })}>
            <option value="">Qualquer nacionalidade</option>
            {nats.map((n) => (
              <option key={n} value={n}>
                {COUNTRY_NAME[n] ?? n}
              </option>
            ))}
          </select>
          <select value={f.status} onChange={(e) => set({ status: e.target.value as Filters['status'] })}>
            <option value="todos">Todos</option>
            <option value="negociaveis">À venda, empréstimo ou leilão</option>
            <option value="venda">À venda</option>
            <option value="emprestimo">Para empréstimo</option>
            <option value="leilao">Em leilão</option>
            <option value="livres">Livres</option>
            <option value="fim">Fim de contrato</option>
          </select>
          <select value={f.trait} onChange={(e) => set({ trait: e.target.value as Trait | '' })}>
            <option value="">Qualquer característica</option>
            {TRAITS.map((t) => (
              <option key={t} value={t}>
                {traitLabel(t)}
              </option>
            ))}
          </select>
          <select value={f.stars} onChange={(e) => set({ stars: Number(e.target.value) })}>
            <option value={0}>Qualquer potencial</option>
            {[1, 2, 3, 4, 5].map((s) => (
              <option key={s} value={s}>
                {'★'.repeat(s)} ou mais
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <label className="row small">
            Idade
            <input type="number" value={f.ageMin} min={15} max={45} style={{ width: 64 }} onChange={(e) => set({ ageMin: Number(e.target.value) })} />–
            <input type="number" value={f.ageMax} min={15} max={45} style={{ width: 64 }} onChange={(e) => set({ ageMax: Number(e.target.value) })} />
          </label>
          <label className="row small">
            Força
            <input type="number" value={f.strMin} min={1} max={99} style={{ width: 64 }} onChange={(e) => set({ strMin: Number(e.target.value) })} />–
            <input type="number" value={f.strMax} min={1} max={99} style={{ width: 64 }} onChange={(e) => set({ strMax: Number(e.target.value) })} />
          </label>
          <label className="row small">
            Valor máx.
            <MoneyField value={f.maxValue} allowZero={false} placeholder="sem limite" width={110} onChange={(v) => set({ maxValue: v })} />
          </label>
          <button className="btn sm ghost" onClick={() => set(DEFAULT)}>
            Limpar filtros
          </button>
          <span className="grow" />
          <span className="small muted">
            {results.length} jogadores{results.length > shown.length ? ` (mostrando ${shown.length})` : ''}
          </span>
        </div>
      </div>
      <div className="panel tight scroll" style={{ maxHeight: '64vh' }}>
        <table className="t">
          <thead>
            <tr>
              {th('pos', 'Pos')}
              {th('name', 'Nome')}
              {th('age', 'Idade', 'center')}
              {th('str', 'Força', 'center')}
              {th('pot', 'Pot.', 'center')}
              {th('nat', 'Nac.')}
              {th('club', 'Clube')}
              {th('con', 'Contrato', 'center')}
              {th('wage', 'Salário', 'right')}
              {th('val', 'Valor', 'right')}
              {th('ask', 'Pedida', 'right')}
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => {
              const pc = p.clubId != null ? state.clubs[p.clubId] : null;
              return (
                <tr key={p.id} className="click" onClick={() => setOpen(p.id)}>
                  <td>
                    <PosTag pos={p.pos} />
                  </td>
                  <td>
                    <span className="row" style={{ gap: 4 }}>
                      <span className="nowrap">{p.name}</span>
                      <MarketPills p={p} state={state} compact />
                    </span>
                    <Traits traits={p.traits} small />
                  </td>
                  <td className="center num">{age(p, season)}</td>
                  <td className="center">
                    <Str v={p.str} />
                  </td>
                  <td className="center"><Stars n={p.stars} /></td>
                  <td>
                    <Flag nat={p.nat} />
                  </td>
                  <td>
                    {pc ? (
                      <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                        <ClubBadge club={pc} size={18} />
                        <span className="small nowrap">{pc.name}</span>
                        {pc.managerId && <span className="pill info">humano</span>}
                      </span>
                    ) : (
                      <span className="pill good">livre</span>
                    )}
                  </td>
                  <td className={`center num ${p.clubId != null && p.contractEnd <= season ? 'warn' : ''}`}>{p.clubId != null ? p.contractEnd : '—'}</td>
                  <td className="right small num">{formatMoney(p.wage)}</td>
                  <td className="right small num">{formatMoney(playerValue(p, season))}</td>
                  <td className="right small num">
                    {p.auction ? (
                      <span className="warn" title="Lance mínimo do leilão">
                        {formatMoney(p.auction.min)}
                      </span>
                    ) : p.salePrice != null ? (
                      <span className="good">{formatMoney(p.salePrice)}</span>
                    ) : p.loanListed ? (
                      <span className="info">empr.</span>
                    ) : (
                      <span className="faint">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {open != null && <PlayerModal pid={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
