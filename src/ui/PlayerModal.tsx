import { useState } from 'react';
import { askingPrice, wageDemand, windowOpen } from '../engine/transfers';
import { age, expectedWage, formatMoney, playerValue } from '../engine/util';
import { command, useMe } from '../store';
import { Bar, ClubName, compLabel, Energy, Modal, PosTag, Str } from './common';

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

export function traitLabel(t: string) {
  return TRAIT_LABEL[t] ?? t;
}

/** Rough public estimate of potential (scouting is imprecise for young players). */
export function potentialHint(str: number, pot: number, ageY: number): string {
  if (ageY > 24 || pot - str < 3) return '—';
  const gap = pot - str;
  return gap > 14 ? '★★★' : gap > 8 ? '★★' : '★';
}

export function PlayerModal({ pid, onClose }: { pid: number; onClose: () => void }) {
  const { state, club } = useMe();
  const p = state?.players[pid];
  const [fee, setFee] = useState<number | null>(null);
  const [wage, setWage] = useState<number | null>(null);
  const [years, setYears] = useState(3);
  const [kind, setKind] = useState<'compra' | 'emprestimo'>('compra');
  if (!state || !p) return null;
  const season = state.meta.season;
  const a = age(p, season);
  const value = playerValue(p, season);
  const mine = club && p.clubId === club.id;
  const owner = p.clubId != null ? state.clubs[p.clubId] : null;
  const ask = p.clubId != null && owner && !owner.managerId ? askingPrice(state, p) : null;
  const demand = club ? wageDemand(state, p, club) : expectedWage(p, season);
  const f = fee ?? ask ?? value;
  const w = wage ?? demand;
  const banned = Object.entries(p.ban).filter(([, n]) => n > 0);
  const winOpen = windowOpen(state);

  return (
    <Modal onClose={onClose} wide>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <div className="row">
            <PosTag pos={p.pos} />
            <h2 style={{ margin: 0 }}>{p.name}</h2>
            <span className="muted">#{p.num}</span>
          </div>
          <div className="muted" style={{ marginTop: 4 }}>
            {a} anos · {p.nat} · {owner ? <ClubName id={owner.id} state={state} /> : 'Sem clube (livre)'}
            {p.loan && <span className="pill warn" style={{ marginLeft: 6 }}>emprestado pelo {state.clubs[p.loan.from]?.name}</span>}
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
          <span className="value">{potentialHint(p.str, p.pot, a)}</span>
        </div>
      </div>
      <div className="spacer" />
      <div className="row">
        {p.traits.map((t) => (
          <span key={t} className="pill info">
            {traitLabel(t)}
          </span>
        ))}
        {p.injury > 0 && <span className="pill bad">Lesionado ({p.injury} jogos)</span>}
        {banned.map(([c, n]) => (
          <span key={c} className="pill warn">
            Suspenso {n}x ({compLabel(state, c)})
          </span>
        ))}
        {p.listed && <span className="pill good">À venda</span>}
      </div>
      <div className="spacer" />
      <div className="small muted">
        Temporada: {p.s.apps} jogos, {p.s.goals} gols, {p.s.ast} assistências, {p.s.yel} amarelos, {p.s.red} vermelhos · Carreira: {p.c.apps} jogos,{' '}
        {p.c.goals} gols
      </div>

      {club && !mine && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h3>Fazer proposta</h3>
          {p.clubId != null && !winOpen && <div className="warn small">A janela de transferências está fechada. Só jogadores livres podem ser contratados agora.</div>}
          {p.loan && <div className="warn small">Jogador emprestado: não pode ser negociado agora.</div>}
          <div className="row" style={{ marginTop: 8 }}>
            {p.clubId != null && (
              <label className="field">
                Tipo
                <select value={kind} onChange={(e) => setKind(e.target.value as 'compra' | 'emprestimo')}>
                  <option value="compra">Compra</option>
                  <option value="emprestimo">Empréstimo (até o fim da temporada)</option>
                </select>
              </label>
            )}
            {p.clubId != null && kind === 'compra' && (
              <label className="field">
                Valor (R$)
                <input type="number" step={100000} value={f} onChange={(e) => setFee(Number(e.target.value))} style={{ width: 150 }} />
              </label>
            )}
            <label className="field">
              Salário mensal (R$)
              <input type="number" step={1000} value={w} onChange={(e) => setWage(Number(e.target.value))} style={{ width: 130 }} />
            </label>
            {kind === 'compra' && (
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
              style={{ alignSelf: 'flex-end' }}
              disabled={!!p.loan || (p.clubId != null && !winOpen)}
              onClick={async () => {
                const r = await command({ c: 'bid', pid: p.id, kind: p.clubId == null ? 'compra' : kind, fee: kind === 'compra' ? f : 0, wage: w, years });
                if (r.ok) onClose();
              }}
            >
              {p.clubId == null ? 'Contratar' : 'Enviar proposta'}
            </button>
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>
            {ask != null && <>Pedida pelo clube: ~{formatMoney(ask)} · </>}
            {owner?.managerId && <>Clube de outro treinador: ele decide se aceita · </>}
            Pretensão salarial: ~{formatMoney(demand)}/mês · Seu caixa: {formatMoney(club.balance)}
          </div>
        </div>
      )}
      {mine && (
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn" onClick={() => void command({ c: 'listPlayer', pid: p.id, listed: !p.listed })}>
            {p.listed ? 'Tirar da lista de vendas' : 'Colocar à venda'}
          </button>
        </div>
      )}
      <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>
          Fechar
        </button>
      </div>
    </Modal>
  );
}
