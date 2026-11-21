import { z } from 'zod';
import type { AbilityRarity, BotDifficulty, ChestTier, GameConfig, LeagueTier } from './config.js';

export const PROTOCOL_VERSION = 1;

export const InputActionSchema = z.enum(['L', 'R', 'ROT', 'SD', 'HD']);
export type InputAction = z.infer<typeof InputActionSchema>;

export const ChestTierSchema = z.enum(['wooden', 'silver', 'gold', 'legendary']);
export const BotDifficultySchema = z.enum(['easy', 'medium', 'hard', 'boss']);

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('auth_profile'),
    playerId: z.string().min(1).max(64).optional(),
    name: z.string().max(24).optional(),
    avatar: z.string().max(16).optional(),
  }),
  z.object({
    type: z.literal('equip_loadout'),
    loadout: z.tuple([
      z.string().max(40).nullable(),
      z.string().max(40).nullable(),
      z.string().max(40).nullable(),
      z.string().max(40).nullable(),
    ]),
  }),
  z.object({
    type: z.literal('open_chest'),
    chestId: ChestTierSchema,
    requestId: z.string().min(1).max(64),
  }),
  z.object({
    type: z.literal('create_room'),
    name: z.string().max(24).optional(),
    sessionToken: z.string().max(64).optional(),
    playerId: z.string().max(64).optional(),
  }),
  z.object({
    type: z.literal('join_room'),
    code: z.string().min(1).max(12),
    name: z.string().max(24).optional(),
    sessionToken: z.string().max(64).optional(),
    playerId: z.string().max(64).optional(),
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
    playerId: z.string().max(64).optional(),
    difficulty: BotDifficultySchema.optional(),
  }),
  z.object({
    type: z.literal('watch_rewarded_ad'),
    requestId: z.string().min(1).max(64),
  }),
  z.object({
    type: z.literal('claim_daily_quest'),
    questId: z.string().min(1).max(40),
    requestId: z.string().min(1).max(64),
  }),
  z.object({
    type: z.literal('set_room_bet'),
    bet: z.number().int().min(0).max(10000),
  }),
  z.object({
    type: z.literal('find_match'),
    bet: z.number().int().min(0).max(10000).optional(),
    name: z.string().max(24).optional(),
    playerId: z.string().max(64).optional(),
  }),
  z.object({
    type: z.literal('cancel_matchmaking'),
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
  level?: number;
}

export type AbilitySlots = [AbilitySlot, AbilitySlot, AbilitySlot, AbilitySlot];

export interface OwnedAbility {
  abilityId: string;
  level: number;
  copies: number;
}

export interface PlayerStats {
  wins: number;
  losses: number;
  draws: number;
  matches: number;
  currentStreak: number;
  bestStreak: number;
  abilityUsage: Record<string, number>;
}

export interface MatchHistoryEntry {
  id: string;
  timestamp: number;
  opponentName: string;
  result: 'win' | 'loss' | 'draw';
  myHp: number;
  oppHp: number;
  ratingDelta: number;
  coinsDelta: number;
  bet: number;
}

export interface DailyQuestProgress {
  id: string;
  title: string;
  target: number;
  progress: number;
  rewardCoins: number;
  rewardXp: number;
  claimed: boolean;
}

export interface PlayerDailyState {
  dateUtc: string;
  bossAttemptsRemaining: number;
  adAttemptsUsedToday: number;
  bossFirstWinClaimedToday: boolean;
  quests: DailyQuestProgress[];
}

export interface PlayerProfileData {
  playerId: string;
  name: string;
  avatar: string;
  coins: number;
  xp: number;
  level: number;
  rating: number;
  league: LeagueTier;
  ownedAbilities: Record<string, OwnedAbility>;
  loadout: [string | null, string | null, string | null, string | null];
  stats: PlayerStats;
  daily: PlayerDailyState;
  matchHistory: MatchHistoryEntry[];
}

export interface ChestRewardResult {
  requestId: string;
  chestId: ChestTier;
  abilityId: string;
  rarity: AbilityRarity;
  isNew: boolean;
  newLevel: number;
  copies: number;
  refundCoins: number;
  coinsRemaining: number;
}

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
  maxHp?: [number, number];
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
      bet?: number;
      countdownSec?: number;
      paused?: boolean;
      pauseRemainingSec?: number;
    }
  | {
      type: 'matchmaking_status';
      searching: boolean;
      bet: number;
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
      coinsEarned?: [number, number];
      xpEarned?: [number, number];
      ratingDelta?: [number, number];
      newRating?: [number, number];
      betPot?: number;
      bonusChestReward?: ChestRewardResult;
    }
  | {
      type: 'profile';
      profile: PlayerProfileData;
    }
  | {
      type: 'chest_opened';
      reward: ChestRewardResult;
      profile: PlayerProfileData;
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
