// The season in review (shown on the Temporadas tab when the season ends) and the manager's trophy cabinet and
// career record (on the Treinador screen).
import { fansLabel } from '../../engine/board';
import type { CareerRecord, GameState, Manager, ReviewPlayer, SeasonReview } from '../../engine/types';
import { OBJECTIVE_LABEL } from '../../engine/world';
import { useApp } from '../../store';
import { ClubBadge, Empty, PosTag, readable, shortName } from '../common';

const rating = (rt: number) => (rt / 10).toFixed(1).replace('.', ',');

function PlayerCard({ title, p, state, extra }: { title: string; p: ReviewPlayer | null; state: GameState; extra?: string }) {
  const openClub = useApp((s) => s.openClub);
  return (
    <div className="review-card">
      <div className="small faint">{title}</div>
      {p ? (
        <>
          <div className="row" style={{ gap: 6 }}>
            <PosTag pos={p.pos} />
            <b>{p.name}</b>
          </div>
          <div className="small muted">{`${p.apps} jogos · ${p.goals} gols · ${p.ast} assist. · nota ${rating(p.rt)}${extra ? ` · ${extra}` : ''}`}</div>
          {p.clubId != null && state.clubs[p.clubId] && (
            <div className="small faint click" onClick={() => openClub(p.clubId!)}>
              {state.clubs[p.clubId].name}
            </div>
          )}
        </>
      ) : (
        <div className="small faint">—</div>
      )}
    </div>
  );
}

/** A team of the season drawn on a pitch, 4-3-3. */
export function TeamPitch({ team, state }: { team: ReviewPlayer[]; state: GameState }) {
  const by = (pos: string) => team.filter((p) => p.pos === pos);
  const mid = [by('MEI')[0], ...by('VOL'), by('MEI')[1]].filter(Boolean);
  const lat = by('LAT');
  const rows = [by('ATA'), mid, [lat[0], ...by('ZAG'), lat[1]].filter(Boolean), by('GOL')];
  return (
    <div className="tos-pitch">
      {rows.map((row, i) => (
        <div key={i} className="tos-row">
          {row.map((p) => {
            const c = p.clubId != null ? state.clubs[p.clubId] : null;
            const kit: [string, string] = c?.colors ?? ['#5b6b7d', '#d9e1ea'];
            return (
              <div key={p.pid} className="tos-player" title={`${p.name} · ${c?.name ?? 'sem clube'} · nota ${rating(p.rt)} · ${p.goals} gols`}>
                <span className="tos-shirt" style={{ background: kit[0], borderColor: kit[1], color: readable(kit[0], kit[1]) }}>
                  {rating(p.rt)}
                </span>
                <span className="tos-name">{shortName(p.name)}</span>
                <span className="tos-club">{c?.short ?? '—'}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** One manager's season in review. */
export function SeasonReviewPanel({ r, state }: { r: SeasonReview; state: GameState }) {
  const club = state.clubs[r.clubId];
  if (!club) return null;
  const cfg = (id: string) => state.config.find((c) => c.id === id);
  const [w, d, l, gf, ga] = r.record;
  const opp = r.biggestWin ? state.clubs[r.biggestWin.opp] : null;
  const trophies = r.cups.filter((c) => c.reached === 'Campeão').length + (r.pos === 1 ? 1 : 0);
  return (
    <div className="col">
      <div className="panel review">
        <div className="review-head" style={{ background: `linear-gradient(110deg, ${club.colors[0]}, ${club.colors[0]} 55%, ${club.colors[1]})` }}>
          <ClubBadge club={club} size={64} />
          <div className="grow" style={{ color: readable(club.colors[0], club.colors[1]) }}>
            <div className="small" style={{ opacity: 0.85 }}>
              {`Retrospectiva da temporada ${r.season}`}
            </div>
            <h2 style={{ margin: 0 }}>{club.name}</h2>
            <div>
              {r.league && r.pos != null ? `${cfg(r.league)?.name ?? r.league}: ${r.pos}º de ${r.of}` : 'Sem divisão nacional'}
              {trophies > 0 && ` · ${'🏆'.repeat(Math.min(trophies, 5))}`}
            </div>
          </div>
          <div className={`review-goal ${r.met ? 'met' : 'missed'}`}>
            <div>{r.met ? '✓ Objetivo cumprido' : '✗ Objetivo não cumprido'}</div>
            <div className="small">{OBJECTIVE_LABEL[r.goal]}</div>
          </div>
        </div>
        <div className="review-stats">
          <div className="stat">
            <span className="label">Campanha</span>
            <span className="value">{`${w}V ${d}E ${l}D`}</span>
            <span className="small muted">{`${w + d + l ? Math.round(((w * 3 + d) / ((w + d + l) * 3)) * 100) : 0}% de aproveitamento`}</span>
          </div>
          <div className="stat">
            <span className="label">Gols</span>
            <span className="value">
              {gf} x {ga}
            </span>
            <span className="small muted">{`saldo ${gf - ga > 0 ? '+' : ''}${gf - ga}`}</span>
          </div>
          <div className="stat">
            <span className="label">Maior vitória</span>
            <span className="value">{r.biggestWin && opp ? `${r.biggestWin.gf} x ${r.biggestWin.ga}` : '—'}</span>
            <span className="small muted">{opp ? `contra o ${opp.name}` : ''}</span>
          </div>
          <div className="stat">
            <span className="label">Torcida</span>
            <span className="value">{fansLabel(r.fans)}</span>
            <span className="small muted">{`diretoria: ${r.conf}% de confiança`}</span>
          </div>
        </div>
        {r.cups.length > 0 && (
          <div className="review-cups">
            {r.cups.map((c) => (
              <span key={c.comp} className={`pill ${c.reached === 'Campeão' ? 'good' : c.reached === 'Vice-campeão' ? 'info' : ''}`}>
                {c.reached === 'Campeão' ? '🏆 ' : ''}
                {cfg(c.comp)?.name ?? c.comp}: {c.reached}
              </span>
            ))}
          </div>
        )}
        <div className="review-cards">
          <PlayerCard title="Craque da temporada" p={r.best} state={state} />
          <PlayerCard title="Artilheiro" p={r.scorer} state={state} />
          <PlayerCard title="Melhor contratação" p={r.signing} state={state} />
        </div>
      </div>
      {r.team.length > 0 && r.league && (
        <div className="panel">
          <h3>Seleção da temporada · {cfg(r.league)?.name ?? r.league}</h3>
          <TeamPitch team={r.team} state={state} />
        </div>
      )}
    </div>
  );
}

/** Trophies grouped by competition, like a cabinet. */
export function TrophyCabinet({ m, state }: { m: Manager; state: GameState }) {
  if (!m.trophies.length) return <Empty>Nenhum título ainda. A estante está esperando.</Empty>;
  const groups = new Map<string, { season: number; clubId: number }[]>();
  for (const t of m.trophies) groups.set(t.comp, [...(groups.get(t.comp) ?? []), t]);
  const order = (id: string) => {
    const c = state.config.find((x) => x.id === id);
    return c ? (c.scope === 'continental' ? 0 : c.kind === 'league' ? 1 + (c.level ?? 1) : c.scope === 'national' ? 4 : 6) : 9;
  };
  return (
    <div className="cabinet">
      {[...groups.entries()]
        .sort((a, b) => order(a[0]) - order(b[0]))
        .map(([comp, list]) => {
          const cfg = state.config.find((c) => c.id === comp);
          return (
            <div key={comp} className="trophy" style={{ ['--tc' as string]: cfg?.color ?? '#e8c25a' }}>
              <div className="trophy-icon">🏆</div>
              <div className="trophy-count">{list.length > 1 ? `${list.length}×` : ''}</div>
              <div className="trophy-name">{cfg?.name ?? comp}</div>
              <div className="trophy-years small faint">
                {list
                  .map((t) => `${t.season}${state.clubs[t.clubId] ? ` (${state.clubs[t.clubId].short})` : ''}`)
                  .join(', ')}
              </div>
            </div>
          );
        })}
    </div>
  );
}

/** The manager's numbers over the whole career. */
export function CareerRecordPanel({ m, state }: { m: Manager; state: GameState }) {
  const r: CareerRecord | undefined = m.rec;
  if (!r || !r.p) return <Empty>Os números da carreira aparecem depois do primeiro jogo.</Empty>;
  const score = (s: CareerRecord['bigWin']) =>
    s ? `${s.gf} x ${s.ga} ${state.clubs[s.club]?.short ?? ''} contra o ${state.clubs[s.opp]?.name ?? '?'} (${s.season})` : '—';
  const clubs = new Set(m.history.map((h) => h.clubId));
  if (m.clubId != null) clubs.add(m.clubId);
  // seasons at a club, the current one included
  const seasons = new Set([...m.history.map((h) => h.season), ...(m.clubId != null ? [state.meta.season] : [])]).size;
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="review-stats">
        <div className="stat">
          <span className="label">Partidas</span>
          <span className="value">{r.p}</span>
          <span className="small muted">{`${r.w}V ${r.d}E ${r.l}D`}</span>
        </div>
        <div className="stat">
          <span className="label">Aproveitamento</span>
          <span className="value">{Math.round(((r.w * 3 + r.d) / (r.p * 3)) * 100)}%</span>
          <span className="small muted">{`${Math.round((r.w / r.p) * 100)}% de vitórias`}</span>
        </div>
        <div className="stat">
          <span className="label">Gols</span>
          <span className="value">
            {r.gf} x {r.ga}
          </span>
          <span className="small muted">{`${(r.gf / r.p).toFixed(2).replace('.', ',')} por jogo`}</span>
        </div>
        <div className="stat">
          <span className="label">Clássicos</span>
          <span className="value">{r.derbies ? `${r.derbies[0]}V ${r.derbies[1]}E ${r.derbies[2]}D` : '—'}</span>
          <span className="small muted">{`${clubs.size} clube${clubs.size === 1 ? '' : 's'} · ${seasons} temporada${seasons === 1 ? '' : 's'}`}</span>
        </div>
      </div>
      <div className="small">
        <span className="good">Maior vitória:</span> {score(r.bigWin)}
      </div>
      <div className="small">
        <span className="bad">Pior derrota:</span> {score(r.bigLoss)}
      </div>
    </div>
  );
}
