import { useEffect, useState } from 'react';
import { loadDefaultDb, type Database } from '../engine/db';
import { buildDatabase } from '../engine/dbcsv';
import { idbGet, type AutoSave } from '../idb';
import { hostFromBytes, hostNewGame, joinGame, useApp } from '../store';

export function Home() {
  const [name, setName] = useState(() => localStorage.getItem('pebolim.name') ?? '');
  const [code, setCode] = useState(() => {
    const m = location.hash.match(/join\/([A-Z0-9]{6})/i);
    return m ? m[1].toUpperCase() : '';
  });
  const [tab, setTab] = useState<'novo' | 'entrar' | 'carregar'>(code ? 'entrar' : 'novo');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [auto, setAuto] = useState<AutoSave | null>(null);
  const status = useApp((s) => s.status);
  const appErr = useApp((s) => s.error);

  // new game options
  const [gameName, setGameName] = useState('Minha carreira');
  const [minutes, setMinutes] = useState(5);
  const [windows, setWindows] = useState(true);
  const [online, setOnline] = useState(true);
  const [customDb, setCustomDb] = useState<Database | null>(null);
  const [dbMsg, setDbMsg] = useState<string | null>(null);

  useEffect(() => {
    void idbGet<AutoSave>('last').then((a) => setAuto(a ?? null));
  }, []);

  const saveName = (n: string) => {
    setName(n);
    localStorage.setItem('pebolim.name', n);
  };
  const needName = !name.trim();

  async function run(fn: () => Promise<void>) {
    setErr(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const newGame = () =>
    run(async () => {
      const db = customDb ?? (await loadDefaultDb());
      await hostNewGame(db, { name: gameName.trim() || 'Carreira', seed: `${Date.now()}-${Math.random()}`, settings: { matchMinutes: minutes, windows } }, name.trim(), online);
    });

  const loadFile = (f: File) =>
    run(async () => {
      const bytes = new Uint8Array(await f.arrayBuffer());
      await hostFromBytes(bytes, name.trim(), online);
    });

  const importCsv = async (files: FileList | null) => {
    if (!files) return;
    const arr = [...files];
    const clubs = arr.find((f) => /club/i.test(f.name));
    const players = arr.find((f) => /player|jogador/i.test(f.name));
    if (!clubs) return setDbMsg('Selecione pelo menos o arquivo clubs.csv (e players.csv).');
    const base = await loadDefaultDb();
    const { db, issues } = buildDatabase(await clubs.text(), players ? await players.text() : 'club,name,pos,birth,str,nat\n', base.comps, base.season);
    if (issues.errors.length) {
      setCustomDb(null);
      setDbMsg(`Erros: ${issues.errors.slice(0, 5).join(' · ')}`);
    } else {
      setCustomDb(db);
      setDbMsg(`Banco personalizado: ${db.clubs.length} clubes, ${db.players.length} jogadores.${issues.warnings.length ? ` Avisos: ${issues.warnings.slice(0, 3).join(' · ')}` : ''}`);
    }
  };

  return (
    <div className="hero">
      <div style={{ width: 'min(760px, 100%)' }} className="col">
        <div className="logo">
          Pebolim <span>Manager</span>
        </div>
        <div className="muted" style={{ marginTop: -6 }}>
          Futebol de treinador para jogar com os amigos, direto no navegador.
        </div>
        <div className="spacer" />
        <div className="panel col">
          <label className="field">
            Seu nome (aparece para os outros jogadores)
            <input type="text" value={name} maxLength={24} placeholder="Ex.: Souto" onChange={(e) => saveName(e.target.value)} />
          </label>
          <div className="tabs">
            <button className={tab === 'novo' ? 'active' : ''} onClick={() => setTab('novo')}>
              Novo jogo
            </button>
            <button className={tab === 'carregar' ? 'active' : ''} onClick={() => setTab('carregar')}>
              Carregar jogo
            </button>
            <button className={tab === 'entrar' ? 'active' : ''} onClick={() => setTab('entrar')}>
              Entrar numa sala
            </button>
          </div>

          {tab === 'novo' && (
            <div className="col">
              <div className="grid2">
                <label className="field">
                  Nome da carreira
                  <input type="text" value={gameName} maxLength={40} onChange={(e) => setGameName(e.target.value)} />
                </label>
                <label className="field">
                  Duração de cada partida ao vivo
                  <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                    <option value={1}>1 minuto (relâmpago)</option>
                    <option value={2}>2 minutos (rápido)</option>
                    <option value={3}>3 minutos</option>
                    <option value={5}>5 minutos</option>
                    <option value={8}>8 minutos (detalhado)</option>
                  </select>
                  <span className="small faint">Dá para mudar depois, em Opções.</span>
                </label>
              </div>
              <label className="row">
                <input type="checkbox" checked={windows} onChange={(e) => setWindows(e.target.checked)} />
                Janelas de transferência (início do ano e meio do ano)
              </label>
              <OnlineToggle online={online} setOnline={setOnline} />
              <details>
                <summary className="muted" style={{ cursor: 'pointer' }}>
                  Banco de dados personalizado (opcional)
                </summary>
                <div className="col" style={{ marginTop: 8 }}>
                  <div className="small muted">
                    Envie seus arquivos <b>clubs.csv</b> e <b>players.csv</b> editados (mesmo formato da pasta <code>data/db</code> do projeto).
                  </div>
                  <input type="file" accept=".csv" multiple onChange={(e) => void importCsv(e.target.files)} />
                  {dbMsg && <div className="small">{dbMsg}</div>}
                </div>
              </details>
              <div className="row">
                <button className="btn primary lg" disabled={busy || needName} onClick={newGame}>
                  {busy ? 'Criando o mundo…' : 'Criar jogo'}
                </button>
                {needName && <span className="small warn">Digite seu nome primeiro.</span>}
              </div>
            </div>
          )}

          {tab === 'carregar' && (
            <div className="col">
              <div className="muted">Carregue um arquivo .pebolim. Você será o anfitrião e os amigos entram com o código da sala.</div>
              <OnlineToggle online={online} setOnline={setOnline} />
              {auto && (
                <div className="panel tight row">
                  <div className="grow">
                    <b>Continuar último jogo</b>
                    <div className="small muted">
                      {auto.name}
                      {auto.club ? ` · ${auto.club}` : ''} · temporada {auto.season} · salvo em {new Date(auto.savedAt).toLocaleString('pt-BR')}
                    </div>
                  </div>
                  <button className="btn primary" disabled={busy || needName} onClick={() => run(() => hostFromBytes(auto.bytes, name.trim(), online))}>
                    Continuar
                  </button>
                </div>
              )}
              <label className="btn" style={{ alignSelf: 'flex-start', opacity: needName ? 0.5 : 1 }}>
                Escolher arquivo .pebolim
                <input type="file" accept=".pebolim" hidden disabled={needName} onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
              </label>
              {needName && <span className="small warn">Digite seu nome primeiro.</span>}
            </div>
          )}

          {tab === 'entrar' && (
            <div className="col">
              <div className="muted">Peça ao anfitrião o código de 6 letras da sala.</div>
              <div className="row">
                <input
                  type="text"
                  value={code}
                  maxLength={6}
                  placeholder="CÓDIGO"
                  style={{ fontSize: 22, letterSpacing: '0.2em', width: 190, textTransform: 'uppercase' }}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                />
                <button className="btn primary lg" disabled={needName || code.length !== 6 || status === 'connecting'} onClick={() => void joinGame(code, name.trim())}>
                  {status === 'connecting' ? 'Conectando…' : 'Entrar'}
                </button>
              </div>
              {needName && <span className="small warn">Digite seu nome primeiro.</span>}
            </div>
          )}
          {(err || appErr) && <div className="bad">{err ?? appErr}</div>}
        </div>
        <IceSettings />
        <div className="small faint">
          Projeto pessoal, sem fins comerciais. Elencos e forças são aproximados e podem ser editados no banco de dados.
        </div>
      </div>
    </div>
  );
}

/** Advanced: custom STUN/TURN servers for friends behind strict networks. */
export function IceSettings() {
  const [text, setText] = useState(() => localStorage.getItem('pebolim.ice') ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const save = () => {
    if (!text.trim()) {
      localStorage.removeItem('pebolim.ice');
      return setMsg('Usando os servidores padrão.');
    }
    try {
      const v = JSON.parse(text);
      if (!Array.isArray(v)) throw new Error();
      localStorage.setItem('pebolim.ice', JSON.stringify(v));
      setMsg('Salvo. Vale para as próximas conexões.');
    } catch {
      setMsg('JSON inválido: use uma lista, ex.: [{"urls":"turn:servidor:3478","username":"u","credential":"s"}]');
    }
  };
  return (
    <details className="small muted">
      <summary style={{ cursor: 'pointer' }}>Avançado: servidor TURN (se um amigo não conseguir conectar)</summary>
      <div className="col" style={{ marginTop: 8 }}>
        <div>
          Algumas redes (4G, redes corporativas) bloqueiam conexão direta. Cadastre um servidor TURN gratuito (ex.: Metered, Open Relay) e cole a
          lista de servidores aqui, em todos os navegadores da sessão.
        </div>
        <textarea rows={3} value={text} placeholder='[{"urls":"turn:...","username":"...","credential":"..."}]' onChange={(e) => setText(e.target.value)} />
        <div className="row">
          <button className="btn sm" onClick={save}>
            Salvar
          </button>
          {msg && <span>{msg}</span>}
        </div>
      </div>
    </details>
  );
}

function OnlineToggle({ online, setOnline }: { online: boolean; setOnline: (v: boolean) => void }) {
  return (
    <label className="row">
      <input type="checkbox" checked={online} onChange={(e) => setOnline(e.target.checked)} />
      Abrir sala online para os amigos entrarem
      <span className="small faint">(desmarque para jogar sozinho, sem internet)</span>
    </label>
  );
}
