import { dateLabel } from '../../engine/util';
import { useMe } from '../../store';
import { ClubBadge, compLabel } from '../common';

export function Calendario() {
  const { state, club } = useMe();
  if (!state || !club) return null;
  const fixtures = Object.values(state.fixtures)
    .filter((f) => f.home === club.id || f.away === club.id)
    .sort((a, b) => a.date - b.date);
  return (
    <div className="col">
      <h1>Calendário {state.meta.season}</h1>
      <div className="panel tight">
        <table className="t">
          <thead>
            <tr>
              <th>Data</th>
              <th>Competição</th>
              <th />
              <th>Adversário</th>
              <th className="center">Placar</th>
            </tr>
          </thead>
          <tbody>
            {fixtures.map((f) => {
              const home = f.home === club.id;
              const opp = state.clubs[home ? f.away : f.home];
              const gf = home ? f.hg : f.ag;
              const ga = home ? f.ag : f.hg;
              const res = gf == null ? '' : gf > ga! ? 'good' : gf === ga ? '' : 'bad';
              const comp = state.comps[f.comp];
              return (
                <tr key={f.id} className={f.date === state.meta.date ? 'me' : ''}>
                  <td className="small nowrap">{dateLabel(state, f.date)}</td>
                  <td className="small">
                    {compLabel(state, f.comp)}
                    {f.stage != null && comp ? <span className="faint"> · {comp.stages[f.stage]?.name}</span> : f.round ? <span className="faint"> · R{f.round}</span> : null}
                  </td>
                  <td className="small faint">{home ? 'casa' : 'fora'}</td>
                  <td>
                    <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                      <ClubBadge club={opp} size={18} /> {opp.name}
                    </span>
                  </td>
                  <td className={`center num ${res}`} style={{ fontWeight: 700 }}>
                    {gf == null ? '—' : `${gf} x ${ga}`}
                    {f.pens && <span className="small faint"> (pên. {home ? f.pens[0] : f.pens[1]}-{home ? f.pens[1] : f.pens[0]})</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
