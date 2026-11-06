// The AI coach: picks tactics before a match and adjusts them while it is played.
// Pure functions of the situation, so the same logic runs on the host for every AI side
// (and for a human side whose manager has disconnected).
import type { Formation, Marking, Mentality, Player, Style, Tactics } from '../types';

/** Switch for experiments (tools/leaguecheck): false = AI keeps its default tactics and only makes tired substitutions. */
export const AI_COACH = { enabled: true, matchups: true, rules: { early: true, numbers: true, gameState: true, readOpp: true } };

/** What the AI coach knows at a given moment. */
export interface Situation {
  /** match minute (0 before kick-off) */
  minute: number;
  /** goals for − against, including the aggregate when the tie must be decided tonight */
  diff: number;
  /** own players on the pitch − opponent's */
  men: number;
  /** strength edge in força points: own − opponent, ±2 for playing at home / away */
  edge: number;
  home: boolean;
  /** knockout match that has to produce a winner */
  decider: boolean;
  /** average energy of own players on the pitch (0-100) */
  energy: number;
  /** what the opponent is doing right now */
  opp: Pick<Tactics, 'mentality' | 'style' | 'marking'>;
  /** the style this squad plays best (from its players) */
  natural: Style;
}

export interface Plan {
  mentality: Mentality;
  style: Style;
  marking: Marking;
  /** short reason, shown in the match feed */
  why: string;
}

/** Edge in força points; home advantage is worth about 2. */
export function strengthEdge(own: number, opp: number, home: boolean): number {
  return own - opp + (home ? 2 : -2);
}


/** The style a squad suits: aerial strikers → bola longa, pace and dribblers → contra, passers → toque. */
export function naturalStyle(players: Pick<Player, 'pos' | 'str' | 'traits'>[]): Style {
  const avg = (ps: typeof players) => (ps.length ? ps.reduce((a, p) => a + p.str, 0) / ps.length : 0);
  const att = players.filter((p) => p.pos === 'ATA');
  const mid = players.filter((p) => p.pos === 'MEI' || p.pos === 'VOL');
  const count = (t: Player['traits'][number]) => players.filter((p) => p.traits.includes(t)).length;
  const longa = count('cabeceio') * 1.2 + (avg(att) - avg(mid)) / 4;
  const contra = count('velocidade') * 1.2 + count('drible') * 0.8;
  const toque = count('passe') * 1.2 + (avg(mid) - avg(att)) / 4 + 0.6;
  if (longa > toque && longa >= contra) return 'longa';
  if (contra > toque) return 'contra';
  return 'toque';
}

/** The tactics an AI coach wants for this situation (formation is decided separately). */
export function aiPlan(s: Situation): Plan {
  const R = AI_COACH.rules;
  const fav = R.early && s.edge >= 3;
  const dog = R.early && s.edge <= -3;
  // Opening plan, measured against an adaptive opponent (tools/skill.ts, docs/ENGINE.md): favourites keep their
  // shape and play their own game (all-out attack gets punished on the counter); clear underdogs sit deeper.
  let mentality: Mentality = dog ? 'defensiva' : 'equilibrada';
  let style: Style = fav && s.natural === 'contra' ? 'toque' : s.natural;
  // pressing for 90 minutes drains energy for the next rounds and gives away fouls: only in short bursts
  let marking: Marking = 'zona';
  let why = fav ? 'favorito, controla o jogo' : dog ? 'azarão, fecha a casinha' : '';
  if (s.home && mentality === 'defensiva' && s.edge > -6) {
    mentality = 'equilibrada';
    why = 'em casa, não se esconde';
  }

  // numbers on the pitch
  if (!R.numbers) {
    /* off */
  } else if (s.men >= 1) {
    mentality = 'ofensiva';
    style = 'toque';
    marking = s.energy >= 75 && s.minute >= 45 ? 'pressao' : 'zona';
    why = 'um jogador a mais';
  } else if (s.men <= -1) {
    mentality = s.diff < 0 && s.minute >= 70 ? 'equilibrada' : 'defensiva';
    style = 'contra';
    marking = 'zona';
    why = 'um jogador a menos';
  }

  // score and clock
  const m = R.gameState ? s.minute : -1;
  if (m < 0) {
    /* off */
  } else if (s.diff < 0) {
    if (m >= 80) {
      mentality = 'ofensiva';
      style = 'longa';
      marking = s.energy >= 55 ? 'pressao' : 'zona';
      why = 'perdendo no fim, abafa';
    } else if (m >= 65 || (m >= 55 && s.diff <= -2) || (fav && m >= 45)) {
      mentality = 'ofensiva';
      style = s.opp.mentality === 'defensiva' ? 'longa' : style === 'contra' ? 'toque' : style;
      why = 'perdendo, vai para cima';
    }
  } else if (s.diff > 0) {
    if (s.diff >= 2 && m >= 60) {
      if (s.men >= 0) mentality = 'equilibrada';
      marking = 'zona';
      why = 'vitória encaminhada, administra';
    } else if (m >= 75 || (dog && m >= 60) || (s.men < 0 && m >= 50)) {
      mentality = 'defensiva';
      style = 'contra';
      marking = 'zona';
      why = 'segurando o resultado';
    }
  } else if (s.decider && m >= 60) {
    mentality = 'ofensiva';
    why = 'precisa decidir';
  } else if (m >= 70) {
    if ((fav || s.home) && s.men >= 0) {
      mentality = 'ofensiva';
      why = 'pressiona pela vitória';
    } else if (dog && !s.home) {
      mentality = 'defensiva';
      style = 'contra';
      why = 'o empate fora é bom';
    }
  }

  // read the opponent (unless chasing the game late)
  if (R.readOpp && !(s.diff < 0 && m >= 65)) {
    if (s.opp.style === 'contra' && mentality === 'ofensiva' && s.men <= 0) {
      // pushing everyone forward feeds a counter-attacking side
      mentality = 'equilibrada';
      why = 'cuidado com o contra-ataque';
    }
    if (s.opp.style === 'longa' && marking === 'pressao') {
      // pressing high is bypassed by long balls
      marking = 'zona';
      why = 'não adianta pressionar quem joga na bola longa';
    }
    if (s.opp.mentality === 'ofensiva' && mentality !== 'ofensiva' && style !== 'contra') {
      style = 'contra';
      why = 'explora os espaços do adversário';
    } else if (s.opp.marking === 'pressao' && style === 'toque') {
      style = 'longa';
      why = 'foge da pressão alta';
    }
  }

  // tired legs can't press
  if (marking === 'pressao' && s.energy < 68) marking = 'zona';
  return { mentality, style, marking, why };
}

/** Formations the AI prefers in a situation (tried in this order, kept only if they suit the squad). */
export function preferredFormations(plan: Pick<Plan, 'mentality'>, men: number): Formation[] {
  if (men < 0) return ['4-4-2', '4-5-1', '5-3-2'];
  if (plan.mentality === 'ofensiva') return ['4-3-3', '4-2-3-1', '3-4-3'];
  if (plan.mentality === 'defensiva') return ['4-5-1', '5-3-2', '4-4-2'];
  return [];
}

export const MENTALITY_TXT: Record<Mentality, string> = { defensiva: 'postura defensiva', equilibrada: 'postura equilibrada', ofensiva: 'postura ofensiva' };
export const STYLE_TXT: Record<Style, string> = { toque: 'toque de bola', contra: 'contra-ataque', longa: 'bola longa' };

/** Feed line describing a change, e.g. "Bahia muda: postura ofensiva, bola longa (perdendo, vai para cima)". */
export function describeChange(team: string, before: Tactics, after: Plan & { formation?: Formation }): string {
  const parts: string[] = [];
  if (after.formation && after.formation !== before.formation) parts.push(after.formation);
  if (after.mentality !== before.mentality) parts.push(MENTALITY_TXT[after.mentality]);
  if (after.style !== before.style) parts.push(STYLE_TXT[after.style]);
  if (after.marking !== before.marking) parts.push(after.marking === 'pressao' ? 'pressão alta' : 'marcação por zona');
  return `${team} muda: ${parts.join(', ')}${after.why ? ` (${after.why})` : ''}`;
}
