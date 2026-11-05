import { useState } from 'react';
import { useMe } from '../../store';
import { ClubName, Empty } from '../common';

export function Temporada() {
  const { state, club } = useMe();
  const [idx, setIdx] = useState<number | null>(null);
  if (!state) return null;
  if (!state.history.length) {
    return (
      <div className="panel">
        <h2>Temporadas</h2>
        <Empty>Ainda não há temporadas encerradas.</Empty>
      </div>
    );
  }
  const i = idx ?? state.history.length - 1;
  const h = state.history[i];
  const cfgName = (id: string) => state.config.find((c) => c.id === id)?.name ?? id;
  const order = state.config.map((c) => c.id);
  const champs = Object.entries(h.champions).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  const promo = state.news.filter((n) => (n.kind === 'promo' || n.kind === 'releg') && n.season === h.season);

  return (
    <div className="col">
      <div className="row">
        <h1 className="grow">Temporada {h.season}</h1>
        <select value={i} onChange={(e) => setIdx(Number(e.target.value))}>
          {state.history.map((x, k) => (
            <option key={x.season} value={k}>
              {x.season}
            </option>
          ))}
        </select>
      </div>
      {state.meta.seasonOver && i === state.history.length - 1 && (
        <div className="panel" style={{ borderColor: 'var(--accent2)' }}>
          <b>Fim de temporada!</b> A temporada {state.meta.season} começa na próxima rodada. Confira os campeões, os acessos e os rebaixamentos.
          {club && <> Sua diretoria definiu um novo objetivo no painel.</>}
        </div>
      )}
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="panel">
          <h3>Campeões</h3>
          <table className="t">
            <tbody>
              {champs.map(([comp, cid]) => (
                <tr key={comp} className={club && cid === club.id ? 'me' : ''}>
                  <td className="muted">{cfgName(comp)}</td>
                  <td>
                    <ClubName id={cid} state={state} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="col">
          <div className="panel">
            <h3>Artilheiros</h3>
            <table className="t">
              <tbody>
                {Object.entries(h.topScorers)
                  .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
                  .map(([comp, s]) => (
                    <tr key={comp}>
                      <td className="muted">{cfgName(comp)}</td>
                      <td>{s.name}</td>
                      <td className="right num">{s.goals} gols</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {promo.length > 0 && i === state.history.length - 1 && (
            <div className="panel">
              <h3>Acessos e rebaixamentos</h3>
              {promo.map((n) => (
                <div key={n.id} className={n.kind === 'promo' ? 'good' : 'bad'} style={{ padding: '2px 0' }}>
                  {n.kind === 'promo' ? '▲' : '▼'} {n.text}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
