import { leaveGame, useApp } from '../store';
import { Home } from './Home';
import { Lobby } from './Lobby';
import { MatchDay } from './match/MatchDay';
import { Shell } from './Shell';

export function App() {
  const client = useApp((s) => s.client);
  const state = useApp((s) => s.state);
  const lobby = useApp((s) => s.lobby);
  const status = useApp((s) => s.status);
  const error = useApp((s) => s.error);
  const md = useApp((s) => s.md);

  let body;
  if (status === 'closed') {
    body = (
      <div className="hero">
        <div className="panel col" style={{ maxWidth: 460 }}>
          <h2>Sessão encerrada</h2>
          <div className="muted">{error ?? 'A conexão foi encerrada.'}</div>
          <div className="small muted">Se você tem o arquivo .pebolim (ou o último jogo salvo automaticamente), qualquer jogador pode virar anfitrião e continuar de onde parou.</div>
          <button className="btn primary" onClick={leaveGame}>
            Voltar ao início
          </button>
        </div>
      </div>
    );
  } else if (!client) body = <Home />;
  else if (!state || !lobby) body = <div className="hero">Sincronizando o jogo…</div>;
  else if (lobby.phase === 'lobby') body = <Lobby />;
  else if (lobby.phase === 'matchday' && md) body = <MatchDay />;
  else body = <Shell />;

  return (
    <>
      {body}
      <Notices />
    </>
  );
}

function Notices() {
  const notices = useApp((s) => s.notices);
  const dismiss = useApp((s) => s.dismiss);
  return (
    <div className="notices">
      {notices.map((n) => (
        <div key={n.id} className={`notice ${n.level}`} onClick={() => dismiss(n.id)}>
          {n.text}
        </div>
      ))}
    </div>
  );
}
