import { MATCH_MINUTES } from '../../net/validate';
import { useApp } from '../../store';
import { IceSettings } from '../Home';

const MINUTES_LABEL: Record<number, string> = {
  1: '1 minuto (relâmpago)',
  2: '2 minutos (rápido)',
  3: '3 minutos',
  5: '5 minutos',
  8: '8 minutos (detalhado)',
};

export function Opcoes() {
  const state = useApp((s) => s.state);
  const host = useApp((s) => s.host);
  const client = useApp((s) => s.client);
  const lobby = useApp((s) => s.lobby);
  const online = useApp((s) => s.online);
  if (!state || !client) return null;
  const minutes = state.meta.settings.matchMinutes;
  const link = lobby ? `${location.origin}${location.pathname}#/join/${lobby.code}` : '';

  return (
    <div className="col">
      <h1>Opções do jogo</h1>
      <div className="panel col" style={{ maxWidth: 640 }}>
        <h3>Duração das partidas ao vivo</h3>
        <div className="small muted">
          Quanto tempo real dura cada jogo assistido (os 90 minutos mais acréscimos). Vale para todos os treinadores da sala e muda na hora, até
          durante uma rodada.
        </div>
        {host ? (
          <div className="row">
            {MATCH_MINUTES.map((m) => (
              <button key={m} className={`btn ${m === minutes ? 'primary' : ''}`} onClick={() => m !== minutes && client.setMatchMinutes(m)}>
                {MINUTES_LABEL[m] ?? `${m} min`}
              </button>
            ))}
          </div>
        ) : (
          <div>
            <b>{MINUTES_LABEL[minutes] ?? `${minutes} min`}</b> <span className="small muted">· só o anfitrião pode mudar</span>
          </div>
        )}
      </div>
      <div className="panel col" style={{ maxWidth: 640 }}>
        <h3>Sala</h3>
        {online && lobby ? (
          <div className="row">
            <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: '0.18em' }}>{lobby.code}</span>
            <button className="btn sm" onClick={() => void navigator.clipboard?.writeText(link)}>
              Copiar link de convite
            </button>
          </div>
        ) : (
          <div className="muted">Jogo offline (só neste navegador).</div>
        )}
        <div className="small muted">
          Carreira <b>{state.meta.name}</b> · temporada {state.meta.season} · janelas de transferência {state.meta.settings.windows ? 'ligadas' : 'desligadas'}
        </div>
      </div>
      <div className="panel" style={{ maxWidth: 640 }}>
        <IceSettings />
      </div>
    </div>
  );
}
