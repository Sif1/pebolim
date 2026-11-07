import { dateLabel } from '../../engine/util';
import { command, useMe } from '../../store';
import { ask } from '../Confirm';
import { Bar, ClubBadge, ClubName, compLabel, Empty } from '../common';

export function Treinador() {
  const { state, manager, club } = useMe();
  if (!state || !manager) return null;
  const offers = manager.offers.filter((o) => state.clubs[o.clubId] && !state.clubs[o.clubId].managerId);
  return (
    <div className="col">
      <h1>{manager.name}</h1>
      <div className="panel grid3">
        <div className="stat">
          <span className="label">Clube atual</span>
          <span className="value">{club ? <ClubName id={club.id} state={state} /> : 'Desempregado'}</span>
        </div>
        <div className="stat">
          <span className="label">Reputação</span>
          <Bar v={manager.rep} color="var(--info)" />
          <span className="small muted">{Math.round(manager.rep)} / 100</span>
        </div>
        <div className="stat">
          <span className="label">Títulos</span>
          <span className="value">{manager.trophies.length}</span>
        </div>
      </div>
      <div className="panel col">
        <h3>Propostas de emprego</h3>
        {offers.length === 0 && <Empty>Nenhuma proposta no momento.</Empty>}
        {offers.map((o) => {
          const c = state.clubs[o.clubId];
          return (
            <div key={o.clubId} className="row">
              <ClubBadge club={c} size={30} />
              <div className="grow">
                <b>{c.name}</b>
                <div className="small muted">
                  {c.league ? compLabel(state, c.league) : ''} · reputação {Math.round(c.rep)} · até {dateLabel(state, Math.min(o.until, state.calendar.length - 1)).slice(0, 5)}
                </div>
              </div>
              <button className="btn primary" onClick={() => void command({ c: 'acceptJob', clubId: c.id })}>
                Aceitar
              </button>
              <button className="btn ghost" onClick={() => void command({ c: 'declineJob', clubId: c.id })}>
                Recusar
              </button>
            </div>
          );
        })}
        {club && offers.length > 0 && <div className="small warn">Aceitar uma proposta deixa o {club.name} disponível para outro treinador.</div>}
      </div>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="panel">
          <h3>Títulos</h3>
          {manager.trophies.length === 0 && <Empty>Nenhum título ainda.</Empty>}
          {manager.trophies.map((t, i) => (
            <div key={i}>
              🏆 {t.season} · {state.config.find((c) => c.id === t.comp)?.name ?? t.comp} ({state.clubs[t.clubId]?.name})
            </div>
          ))}
        </div>
        <div className="panel">
          <h3>Carreira</h3>
          {manager.history.length === 0 && <Empty>Primeira temporada.</Empty>}
          {[...manager.history].reverse().map((h, i) => (
            <div key={i} className="small">
              {h.season} · {state.clubs[h.clubId]?.name} · {h.note}
            </div>
          ))}
        </div>
      </div>
      {club && (
        <button
          className="btn danger"
          style={{ alignSelf: 'flex-start' }}
          onClick={() =>
            void ask({ title: `Pedir demissão do ${club.name}?`, text: 'O clube fica disponível para outro treinador e você passa a receber propostas.', ok: 'Pedir demissão', danger: true }).then(
              (yes) => {
                if (yes) void command({ c: 'resign' });
              },
            )
          }
        >
          Pedir demissão
        </button>
      )}
    </div>
  );
}
