import { useState } from 'react';
import { busAllowed, seatCost, TC_BUILD, TC_DEV, TC_REC, TC_UPKEEP, tcUpgradeCost, travelCost, travelFatigue, travelModeFor, TRAVEL_LABEL } from '../../engine/economy';
import type { TrainingFocus, TravelMode } from '../../engine/types';
import { dateLabel, distanceKm, formatMoney } from '../../engine/util';
import { command, useMe } from '../../store';
import { ClubBadge, compLabel } from '../common';

const FOCUS_LABEL: Record<TrainingFocus, string> = {
  equilibrado: 'Equilibrado',
  fisico: 'Físico (recupera mais rápido)',
  tecnico: 'Técnico (jovens evoluem mais)',
};

export function Estrutura() {
  const { state, club } = useMe();
  const [seats, setSeats] = useState(5000);
  if (!state || !club) return null;
  const tcCost = tcUpgradeCost(club);
  const nextLvl = club.tc.level + 1;
  const away = Object.values(state.fixtures)
    .filter((f) => f.away === club.id && f.hg == null && f.date >= state.meta.date)
    .sort((a, b) => a.date - b.date)
    .slice(0, 6);

  return (
    <div className="col">
      <h1>Estádio, CT e viagens</h1>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="panel col">
          <h3>Estádio</h3>
          <div>
            <b>{club.stadium}</b> · {club.capacity.toLocaleString('pt-BR')} lugares
          </div>
          {club.stadiumWork ? (
            <div className="warn">
              Obra em andamento: +{club.stadiumWork.seats.toLocaleString('pt-BR')} lugares, faltam {club.stadiumWork.left} rodadas.
            </div>
          ) : (
            <div className="row">
              <select value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
                {[2000, 5000, 10000, 15000, 20000].map((s) => (
                  <option key={s} value={s}>
                    +{s.toLocaleString('pt-BR')} lugares
                  </option>
                ))}
              </select>
              <span className="small muted">
                {formatMoney(seats * seatCost(club))} · {Math.max(4, Math.ceil(seats / 2000))} rodadas
              </span>
              <button className="btn primary" disabled={club.balance < seats * seatCost(club)} onClick={() => void command({ c: 'expandStadium', seats })}>
                Ampliar
              </button>
            </div>
          )}
        </div>
        <div className="panel col">
          <h3>Centro de treinamento</h3>
          <div className="row">
            {[1, 2, 3, 4, 5].map((l) => (
              <span key={l} className={`pill ${l <= club.tc.level ? 'good' : ''}`}>
                {l}
              </span>
            ))}
            <span className="muted">Nível {club.tc.level}</span>
          </div>
          <div className="small muted">
            Evolução dos jogadores ×{TC_DEV[club.tc.level].toFixed(2)} · recuperação física ×{TC_REC[club.tc.level].toFixed(2)} · manutenção{' '}
            {formatMoney(TC_UPKEEP[club.tc.level])}/rodada
          </div>
          {club.tc.building > 0 ? (
            <div className="warn">Obra do nível {nextLvl} em andamento: faltam {club.tc.building} rodadas.</div>
          ) : nextLvl <= 5 ? (
            <div className="row">
              <button className="btn primary" disabled={club.balance < tcCost} onClick={() => void command({ c: 'upgradeTC' })}>
                Construir nível {nextLvl}
              </button>
              <span className="small muted">
                {formatMoney(tcCost)} · {TC_BUILD[nextLvl]} rodadas · depois: evolução ×{TC_DEV[nextLvl].toFixed(2)}, manutenção {formatMoney(TC_UPKEEP[nextLvl])}/rodada
              </span>
            </div>
          ) : (
            <div className="good">CT no nível máximo.</div>
          )}
          <label className="field">
            Foco do treino
            <select value={club.focus} onChange={(e) => void command({ c: 'setFocus', focus: e.target.value as TrainingFocus })}>
              {Object.entries(FOCUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="panel col">
        <h3>Logística de viagem</h3>
        <div className="small muted">
          Viajar mais rápido e confortável custa mais, mas os jogadores chegam mais descansados. Ônibus só até 1.500 km.
        </div>
        <label className="field" style={{ maxWidth: 360 }}>
          Meio de transporte padrão
          <select value={club.travel} onChange={(e) => void command({ c: 'setTravel', mode: e.target.value as TravelMode | 'auto' })}>
            <option value="auto">Automático (ônibus perto, avião longe)</option>
            {(Object.keys(TRAVEL_LABEL) as TravelMode[]).map((m) => (
              <option key={m} value={m}>
                {TRAVEL_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        {away.length > 0 && (
          <table className="t">
            <thead>
              <tr>
                <th>Próximas viagens</th>
                <th>Data</th>
                <th className="right">Distância</th>
                {(Object.keys(TRAVEL_LABEL) as TravelMode[]).map((m) => (
                  <th key={m} className="right">
                    {TRAVEL_LABEL[m]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {away.map((f) => {
                const host = state.clubs[f.home];
                const km = distanceKm(host, club);
                const chosen = travelModeFor(club, km);
                return (
                  <tr key={f.id}>
                    <td>
                      <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                        <ClubBadge club={host} size={18} /> {host.name} <span className="faint small">({compLabel(state, f.comp)})</span>
                      </span>
                    </td>
                    <td className="small">{dateLabel(state, f.date).slice(0, 5)}</td>
                    <td className="right num">{Math.round(km).toLocaleString('pt-BR')} km</td>
                    {(Object.keys(TRAVEL_LABEL) as TravelMode[]).map((m) => (
                      <td key={m} className={`right small ${m === chosen ? 'good' : ''}`}>
                        {m === 'onibus' && !busAllowed(km) ? (
                          <span className="faint">—</span>
                        ) : (
                          <>
                            {formatMoney(travelCost(m, km))}
                            <div className="faint">−{travelFatigue(m, km).toFixed(0)} físico</div>
                          </>
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
