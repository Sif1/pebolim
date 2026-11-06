import { useState } from 'react';
import { dateLabel } from '../../engine/util';
import { useMe } from '../../store';
import { Empty } from '../common';
import { visibleNews } from './Painel';

export function Noticias() {
  const { state, manager, club } = useMe();
  const [onlyMine, setOnlyMine] = useState(false);
  if (!state) return null;
  let news = visibleNews(state, manager?.id ?? null, club?.id ?? null);
  if (onlyMine) news = news.filter((n) => n.to === manager?.id || (club && n.clubs.includes(club.id)));
  news = news.slice(-200).reverse();
  return (
    <div className="col">
      <div className="row">
        <h1 className="grow">Notícias</h1>
        <label className="row small">
          <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
          Só do meu clube
        </label>
      </div>
      <div className="panel">
        {news.length === 0 && <Empty>Nada por aqui ainda.</Empty>}
        {news.map((n) => (
          <div key={n.id} className="row" style={{ padding: '6px 0', borderBottom: '1px solid #1c2733' }}>
            <span className="small faint num" style={{ width: 80 }}>
              {n.season !== state.meta.season ? n.season : dateLabel(state, Math.min(n.date, state.calendar.length - 1)).slice(0, 5)}
            </span>
            {n.kind === 'award' && <span title="Prêmios e destaques">🏅</span>}
            {n.to && <span className="pill info">privado</span>}
            <span className="grow">{n.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
