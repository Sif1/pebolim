import { useState } from 'react';
import { AWARD_PTS, coachRanking, type RankRow } from '../../engine/coaches';
import { useMe } from '../../store';
import { ClubName, Empty } from '../common';

const PAGE = 50;

/**
 * The coaching ranking: every human manager and AI coach, by ranking points (all time or this season). Points
 * come from results (weighted by competition), titles and coaching awards.
 */
export function Tecnicos() {
  const { state, manager } = useMe();
  const [by, setBy] = useState<'pts' | 'spts'>('pts');
  const [humans, setHumans] = useState(false);
  const [shown, setShown] = useState(PAGE);
  if (!state) return null;
  const all = coachRanking(state, by);
  const pos = new Map(all.map((r, i) => [r, i + 1]));
  const rows = humans ? all.filter((r) => r.human) : all;
  const mine = manager ? all.findIndex((r) => r.managerId === manager.id) + 1 : 0;
  return (
    <div className="col">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <h1 className="grow">Ranking de técnicos</h1>
        {mine > 0 && <span className="pill info">{`Você está em ${mine}º de ${all.length}`}</span>}
      </div>
      <div className="panel row" style={{ flexWrap: 'wrap' }}>
        <div className="section-tabs" style={{ margin: 0 }}>
          <button className={by === 'pts' ? 'active' : ''} onClick={() => setBy('pts')}>
            Carreira
          </button>
          <button className={by === 'spts' ? 'active' : ''} onClick={() => setBy('spts')}>
            Temporada
          </button>
        </div>
        <label className="row small">
          <input type="checkbox" checked={humans} onChange={(e) => setHumans(e.target.checked)} />
          Só os técnicos humanos
        </label>
        <span className="small faint grow" style={{ minWidth: 220 }}>
          {`Pontos: vitória vale 1 (×1,5 na Libertadores e Champions, ×0,6 na 2ª divisão, ×0,4 nos estaduais), empate 35% disso; títulos de 5 a 30; treinador do mês ${AWARD_PTS.month}, da temporada ${AWARD_PTS.season}.`}{' '}
          <span>Os campeonatos de cada país pesam pelo nível da liga (Brasil ×0,9, Argentina ×0,8, Uruguai ×0,6).</span>
        </span>
      </div>
      {rows.length === 0 ? (
        <Empty>Ninguém no ranking ainda.</Empty>
      ) : (
        <div className="panel tight scroll">
          <table className="t">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Técnico</th>
                <th>Clube</th>
                <th className="num" title="Jogos">J</th>
                <th className="num" title="Vitórias">V</th>
                <th className="num" title="Empates">E</th>
                <th className="num" title="Derrotas">D</th>
                <th className="num" title="Aproveitamento">%</th>
                <th className="num" title="Títulos">🏆</th>
                <th className="num" title="Prêmios de treinador (do mês, da temporada)">🏅</th>
                <th className="num">Pontos</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((r) => (
                <Row key={`${r.human ? 'h' : 'c'}:${r.managerId ?? r.name}:${r.clubId}`} r={r} pos={pos.get(r)!} me={r.managerId === manager?.id} by={by} />
              ))}
            </tbody>
          </table>
          {rows.length > shown && (
            <div className="row" style={{ justifyContent: 'center', padding: 8 }}>
              <button className="btn sm ghost" onClick={() => setShown(shown + PAGE)}>
                {`Mostrar mais (${rows.length - shown})`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ r, pos, me, by }: { r: RankRow; pos: number; me: boolean; by: 'pts' | 'spts' }) {
  const { state } = useMe();
  const club = r.clubId != null ? state!.clubs[r.clubId] : null;
  const rec = r.rec;
  const pct = rec.p ? Math.round(((rec.w * 3 + rec.d) / (rec.p * 3)) * 100) : 0;
  return (
    <tr className={me ? 'me' : ''}>
      <td className="num faint">{pos}</td>
      <td>
        <b>{r.name}</b> {r.human && <span className="pill info">humano</span>}
      </td>
      <td>{club ? <ClubName id={club.id} state={state!} /> : <span className="faint">sem clube</span>}</td>
      <td className="num">{rec.p}</td>
      <td className="num">{rec.w}</td>
      <td className="num">{rec.d}</td>
      <td className="num">{rec.l}</td>
      <td className="num">{rec.p ? `${pct}%` : '—'}</td>
      <td className="num">{rec.titles || '—'}</td>
      <td className="num">{rec.awards || '—'}</td>
      <td className="num">
        <b>{rec[by].toFixed(1)}</b>
      </td>
    </tr>
  );
}
