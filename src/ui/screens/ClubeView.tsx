import { useState } from 'react';
import { squadOf } from '../../engine/util';
import { useApp, useMe } from '../../store';
import { ClubBadge, compLabel, COUNTRY_NAME, FormDots, Str } from '../common';
import { PlayerModal } from '../PlayerModal';
import { SquadTable } from './Elenco';

export function ClubeView() {
  const { state } = useMe();
  const id = useApp((s) => s.viewClub);
  const [open, setOpen] = useState<number | null>(null);
  if (!state || id == null || !state.clubs[id]) return null;
  const c = state.clubs[id];
  const m = c.managerId ? state.managers[c.managerId] : null;
  const squad = squadOf(state, c.id);
  return (
    <div className="col">
      <div className="row">
        <ClubBadge club={c} size={56} />
        <div className="grow">
          <h1 style={{ margin: 0 }}>{c.name}</h1>
          <div className="muted">
            {c.city} · {COUNTRY_NAME[c.country] ?? c.country} · {c.league ? compLabel(state, c.league) : c.contOnly ? 'Copas continentais' : 'Estadual'} · {c.stadium} (
            {c.capacity.toLocaleString('pt-BR')})
          </div>
          <div className="small muted">
            Treinador: {m ? <b>{m.name}</b> : 'IA'} · reputação {Math.round(c.rep)} · forma <FormDots form={c.form} />
          </div>
        </div>
        <div className="center">
          <div className="small faint">FORÇA</div>
          <div style={{ fontSize: 28 }}>
            <Str v={c.power} />
          </div>
        </div>
      </div>
      <div className="panel tight">
        <SquadTable players={squad} onOpen={setOpen} season={state.meta.season} />
      </div>
      {open != null && <PlayerModal pid={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
