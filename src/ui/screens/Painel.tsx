import { travelCost, travelFatigue, travelModeFor, TRAVEL_LABEL } from '../../engine/economy';
import type { GameState, News, Ultimatum } from '../../engine/types';
import { dateLabel, distanceKm, formatMoney, sortTable, squadOf } from '../../engine/util';
import { OBJECTIVE_LABEL } from '../../engine/world';
import { command, useApp, useMe } from '../../store';
import { fansLabel } from '../../engine/board';
import { aiPreMatchTactics, cupRotation } from '../../engine/matchday';
import { Bar, ClubBadge, ClubName, compLabel, Empty, FormDots, PosTag, Str } from '../common';
import { Traits } from '../PlayerModal';
import { nextFixture } from '../Shell';
import { headToHead, isDerby } from '../../engine/rivals';
import { inCharge } from '../../engine/coaches';
import { pitchLevel } from '../../engine/pitch';
import { deadlineDay } from '../../engine/transfers';

export function visibleNews(state: GameState, managerId: string | null, clubId: number | null): News[] {
  return state.news.filter((n) => n.to == null || n.to === managerId || (clubId != null && n.to == null && n.clubs.includes(clubId)));
}

export function Painel() {
  const { state, manager, club } = useMe();
  const setScreen = useApp((s) => s.setScreen);
  if (!state || !manager) return null;

  const offers = manager.offers.filter((o) => state.clubs[o.clubId] && !state.clubs[o.clubId].managerId);
  const news = visibleNews(state, manager.id, club?.id ?? null)
    .filter((n) => n.to === manager.id || (club && n.clubs.includes(club.id)) || ['title', 'fired', 'hired'].includes(n.kind))
    .slice(-14)
    .reverse();

  return (
    <div className="col">
      {!club && (
        <div className="panel">
          <h2>Você está sem clube</h2>
          <p className="muted">Propostas de emprego chegam ao longo das rodadas. Fique de olho aqui e na tela do treinador.</p>
        </div>
      )}
      {club && deadlineDay(state) && (
        <div className="panel deadline-banner">
          <span className="deadline-clock">⏰</span>
          <div className="grow">
            <b>Último dia da janela de transferências!</b>
            <div className="small">Depois desta rodada, só jogadores livres. Propostas de última hora só valem hoje.</div>
          </div>
          <button className="btn primary" onClick={() => setScreen('mercado', 'propostas')}>
            Ver propostas
          </button>
          <button className="btn" onClick={() => setScreen('mercado', 'buscar')}>
            Ir ao mercado
          </button>
        </div>
      )}
      {offers.length > 0 && (
        <div className="panel col" style={{ borderColor: 'var(--accent2)' }}>
          <h2>Propostas de emprego</h2>
          {offers.map((o) => {
            const c = state.clubs[o.clubId];
            return (
              <div key={o.clubId} className="row">
                <ClubBadge club={c} size={30} />
                <div className="grow">
                  <b>{c.name}</b>
                  <div className="small muted">
                    {c.league ? compLabel(state, c.league) : ''} · reputação {Math.round(c.rep)} · válida até {dateLabel(state, Math.min(o.until, state.calendar.length - 1)).slice(0, 5)}
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
        </div>
      )}
      {club && (
        <div className="grid2">
          <NextMatch />
          <div className="panel col">
            <h3>Diretoria</h3>
            <div>
              Objetivo: <b>{OBJECTIVE_LABEL[club.board.goal]}</b>
            </div>
            <div className="row">
              <span className="small muted" style={{ width: 90 }}>
                Confiança
              </span>
              <div className="grow">
                <Bar v={club.board.conf} />
              </div>
              <span className="num">{Math.round(club.board.conf)}%</span>
            </div>
            {club.board.ult ? (
              <UltimatumBox u={club.board.ult} />
            ) : (
              club.board.conf < 25 && <div className="bad small">A diretoria está perdendo a paciência. Resultados ruins podem levar à demissão.</div>
            )}
            <div className="row">
              <span className="small muted" style={{ width: 90 }}>
                Torcida
              </span>
              <div className="grow">
                <Bar v={club.fans ?? 60} color={(club.fans ?? 60) < 35 ? 'var(--bad)' : (club.fans ?? 60) > 75 ? 'var(--good)' : 'var(--info)'} />
              </div>
              <span className="small nowrap" style={{ width: 80, textAlign: 'right' }}>
                {fansLabel(club.fans ?? 60)}
              </span>
            </div>
            <div className="small faint">Torcida feliz enche o estádio e ajuda com a diretoria; vitórias, contratações de peso e preços justos animam.</div>
            <div className="row">
              <span className="small muted" style={{ width: 90 }}>
                Últimos jogos
              </span>
              <FormDots form={club.form} />
            </div>
          </div>
        </div>
      )}
      {club && <ScoutReport />}
      {club && (
        <div className="grid2">
          <Upcoming />
          <TableSnippet />
        </div>
      )}
      {club && <ClubSummary />}
      <div className="panel">
        <div className="row">
          <h3 className="grow">Caixa de entrada</h3>
          <button className="btn sm ghost" onClick={() => setScreen('noticias')}>
            Ver todas
          </button>
        </div>
        {news.length === 0 && <Empty>Nenhuma notícia ainda.</Empty>}
        {news.map((n) => (
          <div key={n.id} className="row" style={{ padding: '6px 0', borderBottom: '1px solid #1c2733' }}>
            <span className="small faint num" style={{ width: 50 }}>
              {dateLabel(state, Math.min(n.date, state.calendar.length - 1)).slice(0, 5)}
            </span>
            {n.to && <span className="pill info">privado</span>}
            <span className="grow">{n.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A stadium's pitch condition as a small pill (red for poor and terrible). */
export function PitchPill({ v }: { v: number | undefined }) {
  const l = pitchLevel(v);
  return (
    <span className={`pill ${l >= 3 ? 'bad' : l === 2 ? 'warn' : ''}`} title="Gramado ruim ou péssimo: os jogadores cansam mais, e a bola longa rende um pouco mais que o toque">
      {(['Gramado: excelente', 'Gramado: muito bom', 'Gramado: ruim', 'Gramado: péssimo'] as const)[l]}
    </span>
  );
}

/** The board's ultimatum: points so far against the target, and matches left. */
function UltimatumBox({ u }: { u: Ultimatum }) {
  const left = u.games - u.played;
  return (
    <div className="ultimatum">
      <div className="row">
        <b className="bad grow">{`⚠ Ultimato: ${u.pts} de ${u.need} pontos`}</b>
        <span className="small muted">{left === 1 ? 'falta 1 jogo' : `faltam ${left} jogos`}</span>
      </div>
      <Bar v={u.pts} max={u.need} color={u.pts >= u.need ? 'var(--good)' : 'var(--bad)'} />
      <div className="small muted">{`Faça pelo menos ${u.need} pontos em ${u.games} jogos, ou você será demitido. Cumprindo a meta, a diretoria renova a confiança.`}</div>
    </div>
  );
}

function NextMatch() {
  const { state, club } = useMe();
  if (!state || !club) return null;
  const f = nextFixture(state, club.id);
  if (!f) return <div className="panel muted">Sem jogos marcados nesta temporada.</div>;
  const home = f.home === club.id;
  const km = distanceKm(state.clubs[f.home], state.clubs[f.away]);
  const mode = travelModeFor(club, km);
  const opp = state.clubs[home ? f.away : f.home];
  const derby = isDerby(state, f.home, f.away);
  const [w, d, l, gf, ga] = headToHead(state, club.id, opp.id);
  return (
    <div className={`panel col ${derby ? 'derby' : ''}`}>
      <h3>
        {f.date === state.meta.date ? 'Jogo de hoje' : 'Próximo jogo'}
        {derby && <span className="pill bad" style={{ marginLeft: 8 }}>🔥 clássico</span>}
      </h3>
      <div className="fixture-card">
        <div className="fc-team">
          <ClubBadge club={state.clubs[f.home]} size={58} />
          <span>{state.clubs[f.home].name}</span>
        </div>
        <div className="fc-mid">
          <div className="fc-vs">X</div>
          <div className="fc-comp">
            {compLabel(state, f.comp)}
            {f.stage != null ? ` · ${state.comps[f.comp]?.stages[f.stage]?.name ?? ''}` : f.round ? ` · rodada ${f.round}` : ''}
            {f.leg === 2 ? ' (volta)' : ''}
          </div>
          <div className="small">{dateLabel(state, f.date)}</div>
          <div className="small faint">{state.clubs[f.home].stadium}</div>
          <PitchPill v={state.clubs[f.home].pitch} />
        </div>
        <div className="fc-team">
          <ClubBadge club={state.clubs[f.away]} size={58} />
          <span>{state.clubs[f.away].name}</span>
        </div>
      </div>
      {derby && <div className="small warn">É clássico: a vitória vale o dobro para a torcida, e a derrota dói o dobro. A diretoria também cobra mais.</div>}
      {w + d + l > 0 && (
        <div className="small muted">
          {`Retrospecto contra o ${opp.name}: ${w}V ${d}E ${l}D · gols ${gf} x ${ga}`}
        </div>
      )}
      {!home && (
        <div className="small muted">
          Viagem: {Math.round(km)} km de {TRAVEL_LABEL[mode]} · custo ~{formatMoney(travelCost(mode, km))} · desgaste −{travelFatigue(mode, km).toFixed(0)} de condição
        </div>
      )}
    </div>
  );
}

/** The next few matches after the one above: date, competition, home or away, opponent and his strength. */
function Upcoming() {
  const { state, club } = useMe();
  if (!state || !club) return null;
  const next = nextFixture(state, club.id);
  const list = Object.values(state.fixtures)
    .filter((f) => (f.home === club.id || f.away === club.id) && f.hg == null && f.date >= state.meta.date && f.id !== next?.id)
    .sort((a, b) => a.date - b.date)
    .slice(0, 6);
  return (
    <div className="panel col">
      <h3>Próximos jogos</h3>
      {list.length === 0 && <Empty>Nada marcado depois deste jogo.</Empty>}
      <table className="t">
        <tbody>
          {list.map((f) => {
            const home = f.home === club.id;
            const opp = state.clubs[home ? f.away : f.home];
            return (
              <tr key={f.id}>
                <td className="faint num nowrap">{dateLabel(state, f.date).slice(0, 5)}</td>
                <td className="small muted nowrap">{compLabel(state, f.comp)}</td>
                <td>
                  <span className={`pill ${home ? 'good' : 'info'}`}>{home ? 'casa' : 'fora'}</span>
                </td>
                <td className="grow">{opp ? <ClubName id={opp.id} state={state} /> : '—'}</td>
                <td>{opp && <Str v={opp.power} />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The club's league table around its own position. */
function TableSnippet() {
  const { state, club } = useMe();
  const setScreen = useApp((s) => s.setScreen);
  if (!state || !club || !club.league) return null;
  const league = state.comps[club.league];
  if (!league) return null;
  const order = sortTable(league.table, state.clubs);
  const at = order.indexOf(club.id);
  const from = Math.max(0, Math.min(order.length - 7, at - 3));
  const rows = order.slice(from, from + 7);
  return (
    <div className="panel col">
      <div className="row">
        <h3 className="grow">{league.cfg.name}</h3>
        <button className="btn sm ghost" onClick={() => setScreen('competicoes')}>
          Tabela completa
        </button>
      </div>
      <table className="t">
        <thead>
          <tr>
            <th>#</th>
            <th>Clube</th>
            <th className="right">J</th>
            <th className="right">SG</th>
            <th className="right">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((cid) => {
            const r = league.table[cid];
            return (
              <tr key={cid} className={cid === club.id ? 'me' : ''}>
                <td className="num">{order.indexOf(cid) + 1}</td>
                <td>
                  <ClubName id={cid} state={state} />
                </td>
                <td className="right num">{r?.p ?? 0}</td>
                <td className="right num">{(r?.gf ?? 0) - (r?.ga ?? 0)}</td>
                <td className="right num">
                  <b>{r?.pts ?? 0}</b>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const MENT: Record<string, string> = { defensiva: 'defensiva', equilibrada: 'equilibrada', ofensiva: 'ofensiva' };
const STY: Record<string, string> = { toque: 'toque de bola', contra: 'contra-ataque', longa: 'bola longa' };

/** What the scouts say about the next opponent: likely plan, form, key players, absences and a tip. */
function ScoutReport() {
  const { state, club } = useMe();
  if (!state || !club) return null;
  const f = nextFixture(state, club.id);
  if (!f) return null;
  const opp = state.clubs[f.home === club.id ? f.away : f.home];
  const mine = squadOf(state, club.id);
  const theirs = squadOf(state, opp.id);
  const human = opp.managerId ? state.managers[opp.managerId] : null;
  // the AI decides its plan before kick-off from the same information: this is what it will do
  const rested = human ? [] : cupRotation(state, f, opp, theirs, club);
  const plan = human ? opp.tactics : aiPreMatchTactics(state, f, opp, rested.length ? theirs.filter((p) => !rested.includes(p)) : theirs, club, mine, true);
  const avail = theirs.filter((p) => p.injury === 0 && !((p.ban[f.comp] ?? 0) > 0) && !rested.includes(p));
  const key = [...avail].sort((a, b) => b.str - a.str).slice(0, 3);
  const out = [...theirs]
    .sort((a, b) => b.str - a.str)
    .slice(0, 16)
    .filter((p) => p.injury > 0 || (p.ban[f.comp] ?? 0) > 0);
  const energy = key.length ? Math.round([...avail].sort((a, b) => b.str - a.str).slice(0, 11).reduce((a, p) => a + p.fitness, 0) / Math.min(11, avail.length)) : 0;
  const league = opp.league ? state.comps[opp.league] : null;
  const pos = league ? sortTable(league.table, state.clubs).indexOf(opp.id) + 1 : 0;
  const edge = club.power - opp.power + (f.home === club.id ? 2 : -2);
  const tips: string[] = [];
  if (plan.style === 'contra') tips.push('Joga no contra-ataque: postura ofensiva abre espaço nas suas costas.');
  if (plan.style === 'longa') tips.push('Aposta na bola longa: marcar pressão não adianta contra eles.');
  if (plan.style === 'toque' && plan.marking !== 'pressao') tips.push('Gosta de tocar a bola: uma pressão alta em momentos certos atrapalha a saída deles.');
  if (plan.mentality === 'defensiva') tips.push('Vai se fechar atrás: chances claras serão raras, tenha paciência.');
  if (plan.mentality === 'ofensiva') tips.push('Vem para cima: o contra-ataque pode render.');
  if (energy && energy < 85) tips.push(`Chega cansado (energia média ${energy}%): acelerar no segundo tempo pode decidir.`);
  if (rested.length) tips.push(`Deve vir com time misto e poupar ${rested.map((p) => p.name).join(', ')} (no banco): a chance de surpreender é agora.`);
  if (plan.focus === 'lados') tips.push('Ataca pelas pontas: laterais fortes (e no lado certo) e zagueiros que cabeceiam seguram.');
  if (plan.focus === 'meio') tips.push('Ataca pelo meio: volantes e zagueiros fortes fecham o caminho.');
  const venue = state.clubs[f.home];
  const pl = pitchLevel(venue.pitch);
  if (pl === 3) tips.push(`Gramado péssimo no ${venue.stadium}: cansa mais, e a bola longa rende um pouco mais que o toque.`);
  else if (pl === 2) tips.push(`Gramado ruim no ${venue.stadium}: cansa mais, e a bola longa rende um pouco mais que o toque.`);
  const coach = human ? null : inCharge(state, opp);
  return (
    <div className="panel col scout">
      <h3>Relatório do adversário · {opp.name}</h3>
      <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
        <div className="col" style={{ gap: 4, minWidth: 220 }}>
          <div className="small">
            {human ? (
              <>
                Treinador: <b>{human.name}</b> (humano)
              </>
            ) : (
              <>
                Treinador: <b>{coach?.name ?? '—'}</b>
              </>
            )}
          </div>
          <div className="small">
            Provável esquema: <b>{plan.formation}</b> · {`postura ${MENT[plan.mentality]}`} · {STY[plan.style]}
            {plan.marking === 'pressao' ? ' · pressão alta' : ''}
            {plan.focus === 'lados' ? ' · ataques pelas pontas' : plan.focus === 'meio' ? ' · ataques pelo meio' : ''}
          </div>
          <div className="small row" style={{ gap: 6 }}>
            Forma: <FormDots form={opp.form} />
            {pos > 0 && <span className="faint">· {pos}º no {league!.cfg.short}</span>}
          </div>
          <div className="small">
            Força <Str v={opp.power} /> contra a sua <Str v={club.power} /> ·{' '}
            <span className={edge >= 3 ? 'good' : edge <= -3 ? 'bad' : 'warn'}>{edge >= 3 ? 'você é favorito' : edge <= -3 ? 'eles são favoritos' : 'jogo equilibrado'}</span>
          </div>
        </div>
        <div className="col" style={{ gap: 4, minWidth: 220 }}>
          <div className="small faint">Destaques</div>
          {key.map((p) => (
            <div key={p.id} className="row small" style={{ gap: 6 }}>
              <PosTag pos={p.pos} flank={p.flank} /> <span className="nowrap">{p.name}</span> <Str v={p.str} /> <Traits traits={p.traits} small />
            </div>
          ))}
          {out.length > 0 && (
            <div className="small warn">
              Desfalques: {out.map((p) => `${p.name} (${p.injury > 0 ? 'lesão' : 'suspenso'})`).join(', ')}
            </div>
          )}
        </div>
        <div className="col grow" style={{ gap: 4, minWidth: 220 }}>
          <div className="small faint">Dicas do olheiro</div>
          {(tips.length ? tips : ['Sem pontos fracos claros: escale os melhores e mantenha o equilíbrio.']).map((t) => (
            <div key={t} className="small">
              • {t}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ClubSummary() {
  const { state, club } = useMe();
  if (!state || !club) return null;
  const league = club.league ? state.comps[club.league] : null;
  const pos = league ? sortTable(league.table, state.clubs).indexOf(club.id) + 1 : null;
  return (
    <div className="panel grid3">
      <div className="stat">
        <span className="label">Caixa</span>
        <span className="value">{formatMoney(club.balance)}</span>
      </div>
      <div className="stat">
        <span className="label">Força do time</span>
        <span className="value">
          <Str v={club.power} />
        </span>
      </div>
      <div className="stat">
        <span className="label">{league ? league.cfg.short : 'Liga'}</span>
        <span className="value">{pos ? `${pos}º lugar` : '—'}</span>
      </div>
      <div className="stat">
        <span className="label">Estádio</span>
        <span className="value small">
          {club.stadium} ({club.capacity.toLocaleString('pt-BR')})
        </span>
      </div>
      <div className="stat">
        <span className="label">Centro de treinamento</span>
        <span className="value">Nível {club.tc.level}</span>
      </div>
      <div className="stat">
        <span className="label">Reputação</span>
        <span className="value">{Math.round(club.rep)}</span>
      </div>
    </div>
  );
}
