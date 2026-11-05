import { useMemo, useState } from 'react';
import { tieWinner } from '../../engine/competitions';
import type { Competition, GameState, TableRow } from '../../engine/types';
import { dateLabel, sortTable } from '../../engine/util';
import { useApp, useMe } from '../../store';
import { ClubBadge, ClubName, COUNTRY_NAME, Empty } from '../common';
import { FixtureRow } from './Resumo';

function zone(comp: Competition, pos: number, n: number): string {
  const cfg = comp.cfg;
  if (cfg.up && pos <= cfg.up.n) return 'zone-up';
  if (cfg.down && pos > n - cfg.down.n) return 'zone-down';
  if (cfg.level === 1 && cfg.kind === 'league' && pos <= Math.max(4, Math.round(n * 0.3))) return 'zone-cont';
  return '';
}

export function StandingsTable({ table, state, comp, compact, highlight }: { table: Record<number, TableRow>; state: GameState; comp?: Competition; compact?: boolean; highlight?: number | null }) {
  const openClub = useApp((s) => s.openClub);
  const order = sortTable(table, state.clubs);
  return (
    <table className="t">
      <thead>
        <tr>
          <th className="center">#</th>
          <th>Clube</th>
          <th className="center">P</th>
          <th className="center">J</th>
          {!compact && (
            <>
              <th className="center">V</th>
              <th className="center">E</th>
              <th className="center">D</th>
              <th className="center">GP</th>
              <th className="center">GC</th>
            </>
          )}
          <th className="center">SG</th>
        </tr>
      </thead>
      <tbody>
        {order.map((cid, i) => {
          const r = table[cid];
          const c = state.clubs[cid];
          return (
            <tr key={cid} className={`click ${comp ? zone(comp, i + 1, order.length) : ''} ${highlight === cid ? 'me' : ''}`} onClick={() => openClub(cid)}>
              <td className="center num faint">{i + 1}</td>
              <td>
                <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                  <ClubBadge club={c} size={18} />
                  <span className="nowrap">{compact ? c.short === c.name ? c.name : c.name : c.name}</span>
                  {c.managerId && <span className="pill info" title={state.managers[c.managerId]?.name}>{state.managers[c.managerId]?.name.split(' ')[0]}</span>}
                </span>
              </td>
              <td className="center num">
                <b>{r.pts}</b>
              </td>
              <td className="center num">{r.p}</td>
              {!compact && (
                <>
                  <td className="center num">{r.w}</td>
                  <td className="center num">{r.d}</td>
                  <td className="center num">{r.l}</td>
                  <td className="center num">{r.gf}</td>
                  <td className="center num">{r.ga}</td>
                </>
              )}
              <td className="center num">{r.gf - r.ga}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function LeagueTable({ compId, compact }: { compId: string; compact?: boolean }) {
  const { state, club } = useMe();
  const comp = state?.comps[compId];
  if (!state || !comp) return null;
  return <StandingsTable table={comp.table} state={state} comp={comp} compact={compact} highlight={club?.id} />;
}

export function Competicoes() {
  const { state, club } = useMe();
  const comps = useMemo(() => (state ? Object.values(state.comps) : []), [state]);
  const mine = club ? comps.filter((c) => c.clubs.includes(club.id)) : [];
  const [sel, setSel] = useState<string>(() => mine[0]?.id ?? comps[0]?.id ?? '');
  const [tab, setTab] = useState<'tabela' | 'jogos' | 'artilharia'>('tabela');
  if (!state) return null;
  const comp = state.comps[sel] ?? comps[0];
  if (!comp) return <Empty>Sem competições.</Empty>;

  const groups = new Map<string, Competition[]>();
  for (const c of comps) {
    const key = c.cfg.scope === 'continental' ? 'Continentais' : (COUNTRY_NAME[c.cfg.country ?? ''] ?? c.cfg.country ?? 'Outras');
    let arr = groups.get(key);
    if (!arr) groups.set(key, (arr = []));
    arr.push(c);
  }

  return (
    <div className="col">
      <div className="row">
        <h1 className="grow">{comp.cfg.name}</h1>
        <select value={comp.id} onChange={(e) => setSel(e.target.value)}>
          {mine.length > 0 && (
            <optgroup label="Suas competições">
              {mine.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.cfg.name}
                </option>
              ))}
            </optgroup>
          )}
          {[...groups.entries()].map(([g, list]) => (
            <optgroup key={g} label={g}>
              {list.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.cfg.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {comp.champion != null && (
        <div className="panel row" style={{ borderColor: '#a16207' }}>
          🏆 Campeão: <ClubName id={comp.champion} state={state} />
        </div>
      )}
      <div className="tabs">
        <button className={tab === 'tabela' ? 'active' : ''} onClick={() => setTab('tabela')}>
          {comp.cfg.kind === 'cup' ? 'Chaveamento' : 'Classificação'}
        </button>
        <button className={tab === 'jogos' ? 'active' : ''} onClick={() => setTab('jogos')}>
          Jogos
        </button>
        <button className={tab === 'artilharia' ? 'active' : ''} onClick={() => setTab('artilharia')}>
          Artilharia
        </button>
      </div>
      {tab === 'tabela' && <CompStandings comp={comp} />}
      {tab === 'jogos' && <CompFixtures comp={comp} />}
      {tab === 'artilharia' && <Scorers comp={comp} />}
    </div>
  );
}

function CompStandings({ comp }: { comp: Competition }) {
  const { state, club } = useMe();
  if (!state) return null;
  return (
    <div className="col">
      {comp.cfg.kind === 'league' && (
        <div className="panel tight">
          <StandingsTable table={comp.table} state={state} comp={comp} highlight={club?.id} />
          <div className="small muted" style={{ padding: 8 }}>
            {comp.cfg.up && <span className="good">▌ acesso ({comp.cfg.up.n}) </span>}
            {comp.cfg.level === 1 && <span style={{ color: 'var(--info)' }}>▌ zona de copas continentais </span>}
            {comp.cfg.down && <span className="bad">▌ rebaixamento ({comp.cfg.down.n})</span>}
          </div>
        </div>
      )}
      {comp.groups.length > 0 && (
        <div className="grid2">
          {comp.groups.map((g) => (
            <div key={g.name} className="panel tight">
              <h3 style={{ padding: '4px 6px' }}>{g.name}</h3>
              <StandingsTable table={g.table} state={state} compact={comp.groups.length > 1} highlight={club?.id} />
            </div>
          ))}
        </div>
      )}
      {comp.stages.length > 0 && (
        <div className="grid3">
          {comp.stages.map((st, si) => (
            <div key={si} className="panel tight">
              <h3 style={{ padding: '4px 6px' }}>
                {st.name} {st.legs === 2 && <span className="faint small">(ida e volta)</span>}
              </h3>
              {st.ties.length === 0 && <div className="small faint" style={{ padding: 6 }}>A definir · {st.dates.map((d) => dateLabel(state, d).slice(0, 5)).join(', ')}</div>}
              {st.ties.map((t, ti) => {
                const w = t.winner ?? tieWinner(state, t);
                const legs = t.fixtures.map((id) => state.fixtures[id]);
                return (
                  <div key={ti} className="small" style={{ padding: '4px 6px', borderBottom: '1px solid #1c2733' }}>
                    {[t.a, t.b].map((cid, k) =>
                      cid == null ? (
                        <div key={k} className="faint">
                          (folga)
                        </div>
                      ) : (
                        <div key={k} className="row" style={{ gap: 6, flexWrap: 'nowrap', fontWeight: w === cid ? 700 : 400, opacity: w != null && w !== cid ? 0.55 : 1 }}>
                          <ClubBadge club={state.clubs[cid]} size={16} />
                          <span className="grow nowrap">{state.clubs[cid].name}</span>
                          {legs.map((f) => (
                            <span key={f.id} className="num" style={{ width: 14, textAlign: 'center' }}>
                              {f.hg == null ? '-' : f.home === cid ? f.hg : f.ag}
                            </span>
                          ))}
                        </div>
                      ),
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CompFixtures({ comp }: { comp: Competition }) {
  const { state, club } = useMe();
  const fixtures = useMemo(() => (state ? Object.values(state.fixtures).filter((f) => f.comp === comp.id) : []), [state, comp.id]);
  const dates = [...new Set(fixtures.map((f) => f.date))].sort((a, b) => a - b);
  const current = state ? (dates.find((d) => d >= state.meta.date - 1) ?? dates[dates.length - 1]) : 0;
  const [date, setDate] = useState<number | null>(null);
  if (!state) return null;
  const d = date ?? current;
  const list = fixtures.filter((f) => f.date === d);
  return (
    <div className="panel tight">
      <div className="row" style={{ padding: 6 }}>
        <button className="btn sm" disabled={dates.indexOf(d) <= 0} onClick={() => setDate(dates[dates.indexOf(d) - 1])}>
          ◀
        </button>
        <b>{dateLabel(state, d)}</b>
        {list[0]?.round ? <span className="muted">rodada {list[0].round}</span> : list[0]?.stage != null ? <span className="muted">{comp.stages[list[0].stage!]?.name}</span> : null}
        <button className="btn sm" disabled={dates.indexOf(d) >= dates.length - 1} onClick={() => setDate(dates[dates.indexOf(d) + 1])}>
          ▶
        </button>
      </div>
      <table className="t">
        <tbody>
          {list.map((f) => (
            <FixtureRow key={f.id} f={f} state={state} highlight={club?.id} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Scorers({ comp }: { comp: Competition }) {
  const { state } = useMe();
  const rows = useMemo(() => {
    if (!state) return [];
    const m = new Map<number, number>();
    for (const f of Object.values(state.fixtures)) {
      if (f.comp !== comp.id) continue;
      for (const g of f.goals) m.set(g.pid, (m.get(g.pid) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  }, [state, comp.id]);
  if (!state) return null;
  if (!rows.length) return <Empty>Nenhum gol ainda.</Empty>;
  return (
    <div className="panel tight">
      <table className="t">
        <tbody>
          {rows.map(([pid, g], i) => {
            const p = state.players[pid];
            return (
              <tr key={pid}>
                <td className="faint num center" style={{ width: 30 }}>
                  {i + 1}
                </td>
                <td>{p?.name ?? '?'}</td>
                <td>{p?.clubId != null ? <ClubName id={p.clubId} state={state} /> : '—'}</td>
                <td className="right num">
                  <b>{g}</b>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
