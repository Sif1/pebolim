// Pitch condition: every stadium's pitch (0-100) wears with each home match and recovers between rounds, faster
// with better care. A poor pitch tires the players more and makes the short game a little harder, so long balls
// gain a little. The effects are small on purpose: a bad pitch is a nuisance, not a lottery.
import type { Rng } from './rng';
import type { Club, GameState, PitchCare } from './types';
import { clamp } from './util';

/** 0 = excellent, 1 = very good, 2 = poor, 3 = terrible. */
export type PitchLevel = 0 | 1 | 2 | 3;

export function pitchLevel(v: number | undefined): PitchLevel {
  const p = v ?? 80;
  return p >= 80 ? 0 : p >= 60 ? 1 : p >= 35 ? 2 : 3;
}

export const PITCH_LABEL = ['Excelente', 'Muito bom', 'Ruim', 'Péssimo'] as const;

/**
 * Care levels: recovery speed, and the cost per round per seat on top of the stadium upkeep (normal care is
 * already in it; basic saves a little, premium costs more).
 */
export const PITCH_CARE: Record<PitchCare, { k: number; cost: number }> = {
  basico: { k: 0.5, cost: -0.03 },
  normal: { k: 1, cost: 0 },
  premium: { k: 2, cost: 0.07 },
};

export const PITCH_CARE_LABEL: Record<PitchCare, string> = { basico: 'Básico', normal: 'Normal', premium: 'Premium' };

/** Wear per home match, and recovery per round: 3% of what is missing, × the care level. */
export const PITCH_WEAR = 2;
export const PITCH_RECOVER = 0.03;

/**
 * How a pitch changes a match: energy drain, short passes and dribbles a little less reliable, long balls a
 * little more (relative to everything else). Excellent and very good pitches play the same.
 */
export const PITCH_FX: { drain: number; pass: number; dribble: number; long: number }[] = [
  { drain: 1, pass: 0, dribble: 0, long: 0 },
  { drain: 1, pass: 0, dribble: 0, long: 0 },
  { drain: 1.05, pass: -0.008, dribble: -0.01, long: 0.006 },
  { drain: 1.1, pass: -0.016, dribble: -0.02, long: 0.012 },
];

/** The care an AI club gives its pitch: the big clubs pay for premium, small clubs and clubs in debt save. */
export function aiPitchCare(club: Pick<Club, 'rep' | 'balance'>): PitchCare {
  return club.rep >= 78 ? 'premium' : club.rep < 50 || club.balance < 0 ? 'basico' : 'normal';
}

/** A pitch for a new club: better at bigger clubs, with some luck either way. */
export function initialPitch(club: Club, rng: Rng) {
  club.pitchCare = aiPitchCare(club);
  club.pitch = Math.round(clamp(52 + club.rep * 0.38 + rng.range(-8, 8), 30, 97));
}

/** Per-round cost of a club's pitch care (negative: a saving), in money. */
export function pitchCareCost(club: Pick<Club, 'capacity' | 'pitchCare'>): number {
  return Math.round(club.capacity * PITCH_CARE[club.pitchCare ?? 'normal'].cost);
}

/** After a round: pitches that hosted a match wear, every pitch recovers a little. */
export function pitchRound(state: GameState, hosted: Set<number>) {
  for (const c of Object.values(state.clubs)) {
    if (c.pitch == null) continue;
    if (!c.managerId) c.pitchCare = aiPitchCare(c);
    const k = PITCH_CARE[c.pitchCare ?? 'normal'].k;
    let p = c.pitch + PITCH_RECOVER * k * (100 - c.pitch);
    if (hosted.has(c.id)) p -= PITCH_WEAR;
    c.pitch = Math.round(clamp(p, 5, 100) * 10) / 10;
  }
}
