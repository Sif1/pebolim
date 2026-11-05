import { useState } from 'react';
import type { Fixture, GameState } from '../../engine/types';
import { dateLabel } from '../../engine/util';
import { useMe } from '../../store';
import { ClubBadge, compLabel, Empty } from '../common';
import { LeagueTable } from './Competicoes';
import { visibleNews } from './Painel';

export function FixtureRow({ f, state, highlight }: { f: Fixture; state: GameState; highlight?: number | null }) {
  const [open, setOpen] = useState(false);
  const h = state.clubs[f.home];
  const a = state.clubs[f.away];
  const mine = highlight != null && (f.home === highlight || f.away === highlight);
  return (
    <>
      <tr className={`click ${mine ? 'me' : ''}`} onClick={() => setOpen(!open)}>
        <td className="right">
          <span className="row" style={{ justifyContent: 'flex-end', gap: 6, flexWrap: 'nowrap' }}>
            {h.name} <ClubBadge club={h} size={18} />
          </span>
        </td>
        <td className="center num" style={{ fontWeight: 800, width: 70 }}>
          {f.hg != null ? `${f.hg} x ${f.ag}` : 'x'}
          {f.pens && <div className="small faint">pên. {f.pens[0]}-{f.pens[1]}</div>}
        </td>
        <td>
          <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <ClubBadge club={a} size={18} /> {a.name}
          </span>
        </td>
      </tr>
      {open && f.goals.length > 0 && (
        <tr>
          <td colSpan={3} className="small muted">
            {f.goals.map((g, i) => (
              <span key={i} style={{ marginRight: 12 }}>
                ⚽ {g.min}' {state.players[g.pid]?.name ?? '?'} ({g.side === 0 ? h.short : a.short}){g.pen ? ' pên.' : ''}
              </span>
            ))}
            {f.att > 0 && <span>· público {f.att.toLocaleString('pt-BR')}</span>}
          </td>
        </tr>
      )}
    </>
  );
}

export function Resumo() {
  const { state, club, manager } = useMe();
  if (!state) return null;
  const last = state.meta.date - 1;
  if (last < 0) {
    return (
      <div className="panel">
        <h2>Resumo da rodada</h2>
        <Empty>A temporada ainda não começou. Prepare o time e clique em “Pronto”.</Empty>
      </div>
    );
  }
  const fixtures = Object.values(state.fixtures).filter((f) => f.date === last && f.hg != null);
  const myComps = new Set(club ? Object.values(state.comps).filter((c) => c.clubs.includes(club.id)).map((c) => c.id) : []);
  const byComp = new Map<string, Fixture[]>();
  for (const f of fixtures) {
    let arr = byComp.get(f.comp);
    if (!arr) byComp.set(f.comp, (arr = []));
    arr.push(f);
  }
  const comps = [...byComp.keys()].sort((a, b) => Number(myComps.has(b)) - Number(myComps.has(a)));
  const myFixture = club ? fixtures.find((f) => f.home === club.id || f.away === club.id) : null;
  const news = visibleNews(state, manager?.id ?? null, club?.id ?? null).filter((n) => n.date === last && n.season === state.meta.season);

  return (
    <div className="col">
      <h1>Resumo · {dateLabel(state, last)}</h1>
      {myFixture && (
        <div className="panel">
          <h3>Seu jogo</h3>
          <table className="t">
            <tbody>
              <FixtureRow f={myFixture} state={state} highlight={club!.id} />
            </tbody>
          </table>
          <div className="small muted" style={{ marginTop: 6 }}>
            {myFixture.goals.map((g, i) => (
              <span key={i} style={{ marginRight: 12 }}>
                ⚽ {g.min}' {state.players[g.pid]?.name}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="col">
          {comps.length === 0 && <Empty>Nenhum jogo nesta data.</Empty>}
          {comps.map((cid) => (
            <div key={cid} className="panel tight">
              <h3 style={{ padding: '4px 6px' }}>{compLabel(state, cid)}</h3>
              <table className="t">
                <tbody>
                  {byComp.get(cid)!.map((f) => (
                    <FixtureRow key={f.id} f={f} state={state} highlight={club?.id} />
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
        <div className="col">
          {club?.league && state.comps[club.league] && (
            <div className="panel tight">
              <h3 style={{ padding: '4px 6px' }}>{state.comps[club.league].cfg.name}</h3>
              <LeagueTable compId={club.league} compact />
            </div>
          )}
          {news.length > 0 && (
            <div className="panel">
              <h3>Notícias do dia</h3>
              {news.map((n) => (
                <div key={n.id} style={{ padding: '4px 0' }}>
                  {n.text}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
