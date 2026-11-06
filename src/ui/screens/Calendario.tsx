import { dateLabel } from '../../engine/util';
import { useMe } from '../../store';
import { ClubBadge, compLabel, useSort } from '../common';

export function Calendario() {
  const { state, club } = useMe();
  const mine = state && club ? Object.values(state.fixtures).filter((f) => f.home === club.id || f.away === club.id) : [];
  const opp = (f: (typeof mine)[number]) => state!.clubs[f.home === club!.id ? f.away : f.home];
  const { sorted: fixtures, th } = useSort(mine, { key: 'date', dir: 1 }, {
    date: (f) => f.date,
    comp: (f) => (state ? compLabel(state, f.comp) : f.comp) + String(f.date).padStart(3, '0'),
    venue: (f) => (f.home === club?.id ? 0 : 1) * 1000 + f.date,
    opp: (f) => opp(f).name,
  });
  if (!state || !club) return null;
  return (
    <div className="col">
      <h1>Calendário {state.meta.season}</h1>
      <div className="panel tight">
        <table className="t">
          <thead>
            <tr>
              {th('date', 'Data')}
              {th('comp', 'Competição')}
              {th('venue', 'Local')}
              {th('opp', 'Adversário')}
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
