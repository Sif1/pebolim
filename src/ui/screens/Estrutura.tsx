import { useState } from 'react';
import {
  busAllowed,
  seatCost,
  stadiumBuildDates,
  tcLevelInfo,
  tcUpgradeCost,
  travelCost,
  travelFatigue,
  travelModeFor,
  TRAVEL_LABEL,
  usableCapacity,
} from '../../engine/economy';
import type { GameState, TrainingFocus, TravelMode } from '../../engine/types';
import { dateLabel, distanceKm, formatMoney } from '../../engine/util';
import { command, useMe } from '../../store';
import { Bar, ClubBadge, compLabel } from '../common';

/** "pronto em dd/mm" for works that end after `left` more dates. */
function readyLabel(state: GameState, left: number): string {
  const idx = state.meta.date + left;
  return idx < state.calendar.length ? `pronto a partir de ${dateLabel(state, idx).slice(0, 5)}` : 'pronto na próxima temporada';
}

function Works({ title, left, total, state }: { title: string; left: number; total: number; state: GameState }) {
  const done = Math.max(0, total - left);
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="row small" style={{ justifyContent: 'space-between' }}>
        <b className="warn">{title}</b>
        <span className="muted">
          {done}/{total} rodadas · faltam {left} · {readyLabel(state, left)}
        </span>
      </div>
      <Bar v={done} max={total} color="var(--warn)" />
    </div>
  );
}

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
      <div className="grid2" style={{ alignItems: 'start', gridTemplateColumns: 'minmax(280px, 1fr) minmax(480px, 1.7fr)' }}>
        <div className="panel col">
          <h3>Estádio</h3>
          <div>
            <b>{club.stadium}</b> · {club.capacity.toLocaleString('pt-BR')} lugares
            {club.stadiumWork && <span className="small muted"> ({usableCapacity(club).toLocaleString('pt-BR')} liberados durante a obra)</span>}
          </div>
          <div className="small muted">Manutenção do estádio: {formatMoney(Math.round(club.capacity * 0.6))}/rodada.</div>
          {club.stadiumWork ? (
            <Works
              state={state}
              title={`Ampliação: +${club.stadiumWork.seats.toLocaleString('pt-BR')} lugares`}
              left={club.stadiumWork.left}
              total={club.stadiumWork.total ?? club.stadiumWork.left}
            />
          ) : (
            <>
              <div className="row">
                <select value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
                  {[2000, 5000, 10000, 15000, 20000].map((s) => (
                    <option key={s} value={s}>
                      +{s.toLocaleString('pt-BR')} lugares
                    </option>
                  ))}
                </select>
                <span className="small muted">
                  {formatMoney(seats * seatCost(club))} · {stadiumBuildDates(seats)} rodadas
                </span>
                <button className="btn primary" disabled={club.balance < seats * seatCost(club)} onClick={() => void command({ c: 'expandStadium', seats })}>
                  Ampliar
                </button>
              </div>
              <div className="small faint">Durante a obra, 10% do estádio fica fechado. Os lugares novos abrem quando ela termina.</div>
            </>
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
          {club.tc.building > 0 ? (
            <Works state={state} title={`Obra do nível ${nextLvl}`} left={club.tc.building} total={club.tc.total ?? club.tc.building} />
          ) : nextLvl <= 5 ? (
            <div className="row">
              <button className="btn primary" disabled={club.balance < tcCost} onClick={() => void command({ c: 'upgradeTC' })}>
                Construir nível {nextLvl}
              </button>
              <span className="small muted">
                {formatMoney(tcCost)} · {tcLevelInfo(club, nextLvl).build} rodadas. O nível atual segue funcionando durante a obra.
              </span>
            </div>
          ) : (
            <div className="good">CT no nível máximo.</div>
          )}
          <table className="t compact tc-levels">
            <thead>
              <tr>
                <th>Nível</th>
                <th className="right">Custo</th>
                <th className="center">Obra</th>
                <th className="right">Manutenção</th>
                <th className="center" title="Velocidade de evolução dos jogadores jovens">Evolução</th>
                <th className="center" title="Recuperação da energia entre as rodadas">Recuperação</th>
                <th className="center" title="Chance por rodada de um lesionado voltar um dia antes">Lesões</th>
                <th className="center" title="Bônus de força e potencial dos jovens da base">Base</th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4, 5].map((l) => {
                const i = tcLevelInfo(club, l);
                return (
                  <tr key={l} className={l === club.tc.level ? 'me' : ''}>
                    <td>
                      <b>{l}</b> {l === club.tc.level && <span className="pill good">atual</span>}
                      {l === nextLvl && club.tc.building > 0 && <span className="pill warn">em obra</span>}
                    </td>
                    <td className="right small num">{l === 1 ? '—' : formatMoney(i.cost)}</td>
                    <td className="center small num">{i.build ? `${i.build} rod.` : '—'}</td>
                    <td className="right small num">{formatMoney(i.upkeep)}</td>
                    <td className="center num">×{i.dev.toFixed(2)}</td>
                    <td className="center num">×{i.rec.toFixed(2)}</td>
                    <td className="center num">{i.inj ? `+${Math.round(i.inj * 100)}%` : '—'}</td>
                    <td className="center small num">
                      +{i.youthStr} / +{i.youthPot.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="small faint">Manutenção por rodada (cerca de 78 rodadas por temporada). Custos dobram na Europa.</div>
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
