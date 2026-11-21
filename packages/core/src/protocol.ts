import { z } from 'zod';
import type { GameConfig } from './config.js';

export const PROTOCOL_VERSION = 1;

export const InputActionSchema = z.enum(['L', 'R', 'ROT', 'SD', 'HD']);
export type InputAction = z.infer<typeof InputActionSchema>;

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_room'),
    name: z.string().max(24).optional(),
    sessionToken: z.string().max(64).optional(),
  }),
  z.object({
    type: z.literal('join_room'),
    code: z.string().min(1).max(12),
    name: z.string().max(24).optional(),
    sessionToken: z.string().max(64).optional(),
  }),
  z.object({
    type: z.literal('ready'),
    value: z.boolean(),
  }),
  z.object({
    type: z.literal('input'),
    seq: z.number().int().nonnegative(),
    a: InputActionSchema,
  }),
  z.object({
    type: z.literal('rematch'),
  }),
  z.object({
    type: z.literal('leave'),
  }),
  z.object({
    type: z.literal('ping'),
    t: z.number(),
  }),
  z.object({
    type: z.literal('start_bot_match'),
    name: z.string().max(24).optional(),
  }),
  z.object({
    type: z.literal('activate_ability'),
    slotIndex: z.number().int().min(0).max(3),
    requestId: z.string().min(1).max(64),
  }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type RoomState = 'lobby' | 'countdown' | 'playing' | 'finished';

export interface RoomPlayerInfo {
  index: 0 | 1;
  name: string;
  ready: boolean;
  connected: boolean;
  isBot: boolean;
  rematchVote?: boolean;
}

export interface PieceShape {
  /** Матрица 0/1 */
  m: number[][];
  /** Цвет 1..4 или 5 (джокер) */
  c: number;
}

export interface ActivePiece extends PieceShape {
  x: number;
  y: number;
}

export interface EnergyState {
  green: number;
  blue: number;
  red: number;
  yellow: number;
}

export interface AbilitySlot {
  abilityId: string | null;
}

export type AbilitySlots = [AbilitySlot, AbilitySlot, AbilitySlot, AbilitySlot];

export type AbilityErrorCode =
  | 'ABILITY_NOT_FOUND'
  | 'EMPTY_SLOT'
  | 'NOT_ENOUGH_ENERGY'
  | 'MATCH_NOT_PLAYING'
  | 'ABILITY_NOT_AVAILABLE'
  | 'DUPLICATE_REQUEST';

export interface WaveState {
  id: number;
  /** Индекс стрелка (0 или 1) */
  owner: 0 | 1;
  /** Координата на единой оси u в клетках: 0 — край поля игрока 0, gapCells — край поля игрока 1 */
  u: number;
  /** Текущая сила волны (количество линий) */
  pow: number;
  /** Урон на единицу силы */
  dpp: number;
  /** Доминирующий цвет (0..4) */
  col: number;
}

export type GameEvent =
  | { type: 'line_clear'; player: 0 | 1; count: number; color: number; row: number }
  | { type: 'wave_spawn'; player: 0 | 1; waveId: number; pow: number; color: number; row: number }
  | { type: 'wave_collide'; u: number; reduced: number }
  | { type: 'impact'; target: 0 | 1; attacker: 0 | 1; damage: number; rowsCleared: number[]; color: number }
  | { type: 'heal'; player: 0 | 1; amount: number; hp: number }
  | { type: 'freeze'; target: 0 | 1; duration: number }
  | { type: 'meteor'; target: 0 | 1; cells: Array<[number, number]> }
  | { type: 'jokers'; player: 0 | 1; count: number }
  | { type: 'overflow'; player: 0 | 1; damage: number }
  | {
      type: 'energy_gain';
      player: 0 | 1;
      gained: EnergyState;
      total: EnergyState;
    }
  | {
      type: 'ability_activated';
      player: 0 | 1;
      slotIndex: number;
      abilityId: string;
      energyColor: 1 | 2 | 3 | 4;
      energySpent: number;
    };

export interface SnapshotMessage {
  type: 'snapshot';
  tick: number;
  ackSeq: [number, number];
  boards: [number[][], number[][]];
  hp: [number, number];
  combo: [number, number];
  freeze: [number, number];
  jokers: [number, number];
  energy: [EnergyState, EnergyState];
  abilities: [AbilitySlots, AbilitySlots];
  next: [PieceShape, PieceShape];
  cur: [ActivePiece, ActivePiece];
  waves: WaveState[];
  t: number;
  paused?: boolean;
  pauseRemainingSec?: number;
  events: GameEvent[];
}

export type ServerMessage =
  | {
      type: 'room';
      code: string;
      players: RoomPlayerInfo[];
      state: RoomState;
      youIndex: 0 | 1;
      sessionToken: string;
      countdownSec?: number;
      paused?: boolean;
      pauseRemainingSec?: number;
    }
  | {
      type: 'match_start';
      seed: number;
      config: GameConfig;
      youIndex: 0 | 1;
    }
  | SnapshotMessage
  | {
      type: 'match_end';
      winner: 0 | 1 | null;
      reason: 'ko' | 'forfeit' | 'draw';
      hp: [number, number];
    }
  | {
      type: 'pong';
      t: number;
    }
  | {
      type: 'error';
      code: string;
      message?: string;
    };
