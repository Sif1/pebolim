import type { Patch } from 'immer';
import type { Command, CustomClubSpec } from '../engine/commands';
import type { LiveDetail, LiveFrame } from '../engine/match/live';
import type { Tactics } from '../engine/types';

export type SessionPhase = 'lobby' | 'manage' | 'matchday';

export type Claim =
  | { kind: 'club'; clubId: number }
  | { kind: 'resume'; managerId: string }
  | { kind: 'create'; spec: CustomClubSpec }
  | { kind: 'spectate' };

export type MatchAction =
  | { a: 'pause' }
  | { a: 'resume' }
  | { a: 'sub'; out: number; in: number }
  | { a: 'swap'; s1: number; s2: number }
  | { a: 'tactics'; tactics: Tactics }
  | { a: 'quick' };

export interface LobbyPlayer {
  clientId: string;
  name: string;
  managerId: string | null;
  connected: boolean;
  ready: boolean;
  isHost: boolean;
}

export interface LobbyState {
  code: string;
  phase: SessionPhase;
  /** true until the first date is played: any club can be picked and custom clubs created */
  newGame: boolean;
  players: LobbyPlayer[];
}

export interface MatchdayInfo {
  date: number;
  /** live fixtures (at least one present human club) */
  live: number[];
  /** fixtures already finished */
  done: number[];
  /** results are known and the host can continue */
  allDone: boolean;
}

export type ClientMsg =
  | { t: 'hello'; name: string; token: string; managerId: string | null }
  | { t: 'claim'; claim: Claim }
  | { t: 'cmd'; seq: number; cmd: Command }
  | { t: 'ready'; ready: boolean }
  | { t: 'match'; fixtureId: number; action: MatchAction }
  | { t: 'resync' }
  | { t: 'host'; action: 'start' | 'matchday' | 'continue' };

export type HostMsg =
  | { t: 'welcome'; clientId: string }
  | { t: 'lobby'; lobby: LobbyState }
  | { t: 'snapshot'; ver: number; data: Uint8Array; hash: string }
  | { t: 'patch'; ver: number; patches: Patch[] }
  | { t: 'ack'; seq: number; ok: boolean; msg: string }
  | { t: 'notice'; text: string; level: 'info' | 'error' | 'success' }
  | { t: 'claimed'; managerId: string | null }
  | { t: 'matchday'; md: MatchdayInfo | null }
  | { t: 'frames'; frames: LiveFrame[]; details: LiveDetail[] }
  | { t: 'kick'; reason: string };
