import comps from '../data/db/competitions.json';
import type { Database, DbClub } from '../src/engine/db';
import type { CompConfig } from '../src/engine/types';

/** A database with generated clubs for every configured competition (no curated players). */
export function synthDb(): Database {
  const cfgs = comps as unknown as CompConfig[];
  const clubs: DbClub[] = [];
  const states = cfgs.filter((c) => c.scope === 'state').map((c) => c.id.replace('EST-', ''));
  let k = 0;
  const mk = (country: string, continent: 'SA' | 'EU', league: string, rep: number, extra: Partial<DbClub> = {}): DbClub => {
    k++;
    return {
      key: `c${k}`,
      name: `Clube ${k}`,
      short: `C${k}`,
      country,
      city: `Cidade ${k}`,
      lat: (continent === 'SA' ? -23 : 48) + ((k * 7) % 15) - 7,
      lon: (continent === 'SA' ? -46 : 5) + ((k * 13) % 17) - 8,
      colors: ['#ffffff', '#000000'],
      stadium: `Estádio ${k}`,
      capacity: 15000 + ((k * 3571) % 50000),
      rep,
      league,
      continent,
      ...extra,
    };
  };
  for (const cfg of cfgs) {
    if (cfg.kind !== 'league') continue;
    const n = cfg.size ?? 20;
    const base = cfg.level === 1 ? 72 : cfg.level === 2 ? 50 : 35;
    for (let i = 0; i < n; i++) {
      const extra: Partial<DbClub> = {};
      if (cfg.country === 'BRA') {
        extra.estadual = states[i % states.length];
        extra.state = extra.estadual;
      }
      clubs.push(mk(cfg.country!, cfg.continent!, cfg.id, base + 20 - (i * 20) / n, extra));
    }
  }
  for (const st of states) {
    for (let i = 0; i < 8; i++) clubs.push(mk('BRA', 'SA', '', 20 + i, { estadual: st, state: st }));
  }
  const sa = ['CHI', 'COL', 'PAR', 'ECU', 'PER', 'BOL', 'VEN'];
  const eu = ['POR', 'NED', 'BEL', 'SCO', 'TUR', 'AUT'];
  for (let i = 0; i < 36; i++) clubs.push(mk(sa[i % sa.length], 'SA', '', 40 + (i % 25), { contOnly: true }));
  for (let i = 0; i < 36; i++) clubs.push(mk(eu[i % eu.length], 'EU', '', 50 + (i % 30), { contOnly: true }));
  return { version: 1, season: 2026, clubs, players: [], comps: cfgs };
}
