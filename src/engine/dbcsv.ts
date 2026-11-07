import type { Database, DbClub, DbPlayer } from './db';
import { defaultNamePools } from './names';
import { POSITIONS, TRAITS, type CompConfig, type Pos, type Trait } from './types';

/** Minimal RFC-4180 CSV parser (handles quotes, commas and newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') q = true;
    else if (ch === ',' || ch === ';') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

function records(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

export const CLUB_COLUMNS = ['key', 'name', 'short', 'country', 'state', 'city', 'lat', 'lon', 'color1', 'color2', 'stadium', 'capacity', 'rep', 'league', 'estadual', 'continent', 'contonly', 'crest', 'coach', 'coach_nat'];
export const PLAYER_COLUMNS = ['club', 'name', 'pos', 'birth', 'str', 'nat', 'traits', 'pot', 'stars', 'side'];

/** A side as written in a CSV: L/E (left), R/D (right), C (central). */
export function parseSide(v: string | undefined): 'L' | 'R' | 'C' | undefined {
  const s = (v || '').trim().toUpperCase();
  return s === 'L' || s === 'E' ? 'L' : s === 'R' || s === 'D' ? 'R' : s === 'C' ? 'C' : undefined;
}

export interface DbIssues {
  errors: string[];
  warnings: string[];
}

export function clubsFromCsv(text: string, issues: DbIssues): DbClub[] {
  const out: DbClub[] = [];
  const keys = new Set<string>();
  records(text).forEach((r, i) => {
    const line = i + 2;
    if (!r.key || !r.name) return issues.errors.push(`clubs.csv linha ${line}: key e name são obrigatórios`);
    if (keys.has(r.key)) return issues.errors.push(`clubs.csv linha ${line}: key repetida "${r.key}"`);
    keys.add(r.key);
    const continent = (r.continent || 'SA').toUpperCase() === 'EU' ? 'EU' : 'SA';
    out.push({
      key: r.key,
      name: r.name,
      short: r.short || r.name.slice(0, 3).toUpperCase(),
      country: (r.country || 'BRA').toUpperCase(),
      state: r.state || undefined,
      city: r.city || r.name,
      lat: Number(r.lat) || 0,
      lon: Number(r.lon) || 0,
      colors: [r.color1 || '#ffffff', r.color2 || '#000000'],
      stadium: r.stadium || `Estádio ${r.name}`,
      capacity: Math.max(1000, Number(r.capacity) || 10000),
      rep: Math.min(99, Math.max(1, Number(r.rep) || 30)),
      league: r.league || '',
      estadual: r.estadual || undefined,
      continent,
      contOnly: ['1', 'true', 'sim', 'yes', 'x'].includes((r.contonly || '').toLowerCase()),
      ...(/^https?:\/\//.test(r.crest || '') ? { crest: r.crest } : {}),
      ...(r.coach ? { coach: r.coach.trim(), coachNat: (r.coach_nat || r.country || 'BRA').toUpperCase() } : {}),
    });
  });
  return out;
}

export function playersFromCsv(text: string, clubKeys: Set<string>, issues: DbIssues): DbPlayer[] {
  const out: DbPlayer[] = [];
  records(text).forEach((r, i) => {
    const line = i + 2;
    const pos = (r.pos || '').toUpperCase() as Pos;
    if (!r.name) return;
    if (!POSITIONS.includes(pos)) return issues.errors.push(`players.csv linha ${line}: posição inválida "${r.pos}" (use ${POSITIONS.join(', ')})`);
    if (r.club && !clubKeys.has(r.club)) return issues.warnings.push(`players.csv linha ${line}: clube "${r.club}" não existe (jogador vira livre)`);
    const traits = (r.traits || '')
      .split(/[|/]/)
      .map((t) => t.trim().toLowerCase())
      .filter((t): t is Trait => TRAITS.includes(t as Trait));
    const str = Number(r.str);
    const birth = Number(r.birth);
    if (!str || !birth) return issues.errors.push(`players.csv linha ${line}: str e birth são obrigatórios`);
    out.push({
      club: clubKeys.has(r.club) ? r.club : '',
      name: r.name,
      pos,
      birth,
      str: Math.min(97, Math.max(20, str)),
      nat: (r.nat || 'BRA').toUpperCase(),
      traits: r.traits ? traits : undefined,
      pot: r.pot ? Number(r.pot) : undefined,
      stars: r.stars !== undefined && r.stars !== '' ? Math.max(0, Math.min(5, Math.round(Number(r.stars)))) : undefined,
      ...(parseSide(r.side) ? { side: parseSide(r.side) } : {}),
    });
  });
  return out;
}

/** Validate competitions against the clubs (sizes, links). */
export function checkDb(db: Database, issues: DbIssues) {
  const byLeague = new Map<string, number>();
  for (const c of db.clubs) if (c.league) byLeague.set(c.league, (byLeague.get(c.league) ?? 0) + 1);
  const ids = new Set(db.comps.map((c) => c.id));
  for (const lid of byLeague.keys()) if (!ids.has(lid)) issues.errors.push(`Liga "${lid}" usada em clubs.csv não existe em competitions.json`);
  for (const cfg of db.comps) {
    if (cfg.kind === 'league') {
      const n = byLeague.get(cfg.id) ?? 0;
      if (cfg.size && n !== cfg.size) issues.warnings.push(`${cfg.name}: ${n} clubes (esperado ${cfg.size})`);
    }
  }
}

export function buildDatabase(clubsCsv: string, playersCsv: string, comps: CompConfig[], season: number): { db: Database; issues: DbIssues } {
  const issues: DbIssues = { errors: [], warnings: [] };
  const clubs = clubsFromCsv(clubsCsv, issues);
  const players = playersFromCsv(playersCsv, new Set(clubs.map((c) => c.key)), issues);
  const db: Database = { version: 1, season, clubs, players, comps, names: defaultNamePools() };
  checkDb(db, issues);
  return { db, issues };
}
