import type { GameConfig } from './config.js';
import {
  activateAbility,
  applyPlayerInput,
  fits,
  rotateMatrixCW,
  type MatchState,
} from './engine.js';
import { SeededRng } from './rng.js';

export interface BotPlan {
  rotations: number;
  targetX: number;
}

export class BotController {
  public playerIndex: 0 | 1;
  private timer = 0;
  private currentRotationCount = 0;
  private plan: BotPlan | null = null;
  private lastPieceRef: number[][] | null = null;
  private rng: SeededRng;

  constructor(playerIndex: 0 | 1, seed: number) {
    this.playerIndex = playerIndex;
    this.rng = new SeededRng(seed ^ 0x5f3759df);
  }

  public evaluatePlacement(
    board: number[][],
    m: number[][],
    x: number,
    y: number,
    config: GameConfig
  ): number {
    const H = config.boardHeight;
    const W = config.boardWidth;
    const b = board.map((r) => r.slice());

    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m[0].length; c++) {
        if (m[r][c] && y + r >= 0 && y + r < H && x + c >= 0 && x + c < W) {
          b[y + r][x + c] = 1;
        }
      }
    }

    let burnedLines = 0;
    for (let i = H - 1; i >= 0; i--) {
      if (b[i].every((v) => v !== 0)) {
        b.splice(i, 1);
        b.unshift(Array<number>(W).fill(0));
        burnedLines++;
        i++;
      }
    }

    let aggregateHeight = 0;
    let holes = 0;
    let bumpiness = 0;
    let prevHeight: number | null = null;

    for (let c = 0; c < W; c++) {
      let colHeight = 0;
      let seenBlock = false;
      for (let r = 0; r < H; r++) {
        if (b[r][c] !== 0) {
          if (!seenBlock) {
            colHeight = H - r;
            seenBlock = true;
          }
        } else if (seenBlock) {
          holes++;
        }
      }
      aggregateHeight += colHeight;
      if (prevHeight !== null) {
        bumpiness += Math.abs(colHeight - prevHeight);
      }
      prevHeight = colHeight;
    }

    const { weightLines, weightAggregateHeight, weightHoles, weightBumpiness } = config.bot;
    return (
      weightLines * burnedLines +
      weightAggregateHeight * aggregateHeight +
      weightHoles * holes +
      weightBumpiness * bumpiness
    );
  }

  public buildPlan(state: MatchState): BotPlan {
    const p = state.players[this.playerIndex];
    const { config } = state;
    const W = config.boardWidth;
    const H = config.boardHeight;

    let best: { score: number; rotations: number; targetX: number } | null = null;
    let m = p.cur.m.map((r) => r.slice());
    const isJoker = p.cur.c === 5;
    const maxRot = isJoker ? 1 : 4;

    for (let rot = 0; rot < maxRot; rot++) {
      const pieceW = m[0].length;
      for (let x = 0; x <= W - pieceW; x++) {
        if (!fits(p.board, m, x, 0, W, H, isJoker)) continue;
        let y = 0;
        while (fits(p.board, m, x, y + 1, W, H, isJoker)) {
          y++;
        }
        const score = this.evaluatePlacement(p.board, m, x, y, config);
        if (!best || score > best.score) {
          best = { score, rotations: rot, targetX: x };
        }
      }
      m = rotateMatrixCW(m);
    }

    if (best && this.rng.next() < config.bot.mistakeProbability) {
      const shift = this.rng.next() < 0.5 ? -1 : 1;
      best = {
        ...best,
        targetX: Math.max(0, Math.min(W - 1, best.targetX + shift)),
      };
    }

    return best ? { rotations: best.rotations, targetX: best.targetX } : { rotations: 0, targetX: p.cur.x };
  }

  public step(state: MatchState, dt: number): void {
    if (state.finished) return;
    const p = state.players[this.playerIndex];

    // Бот проверяет возможность использовать способности (лечение работает даже в заморозке)
    for (let slotIdx = 0; slotIdx < 4; slotIdx++) {
      const slot = p.abilities[slotIdx];
      if (!slot?.abilityId) continue;
      const def = state.config.abilities[slot.abilityId];
      if (!def) continue;
      if (def.effectType === 'heal' && p.hp > state.config.maxHp - (def.params.amount ?? 15)) {
        continue;
      }
      activateAbility(state, this.playerIndex, slotIdx);
    }

    if (p.freezeRemaining > 0) return;

    // Если появилась новая фигура, сбрасываем план
    if (this.lastPieceRef !== p.cur.m && this.plan === null) {
      this.currentRotationCount = 0;
    }

    this.timer += dt;
    if (this.timer < state.config.bot.actionIntervalSec) {
      return;
    }
    this.timer = 0;

    if (!this.plan) {
      this.plan = this.buildPlan(state);
      this.currentRotationCount = 0;
    }

    const prevY = p.cur.y;
    const pl = this.plan;

    if (this.currentRotationCount < pl.rotations) {
      if (applyPlayerInput(state, this.playerIndex, 'ROT')) {
        this.currentRotationCount++;
      } else {
        this.currentRotationCount = pl.rotations;
      }
    } else if (p.cur.x < pl.targetX) {
      if (!applyPlayerInput(state, this.playerIndex, 'R')) {
        applyPlayerInput(state, this.playerIndex, 'HD');
        this.plan = null;
        this.currentRotationCount = 0;
      }
    } else if (p.cur.x > pl.targetX) {
      if (!applyPlayerInput(state, this.playerIndex, 'L')) {
        applyPlayerInput(state, this.playerIndex, 'HD');
        this.plan = null;
        this.currentRotationCount = 0;
      }
    } else {
      applyPlayerInput(state, this.playerIndex, 'HD');
      this.plan = null;
      this.currentRotationCount = 0;
    }

    // Если фигура зафиксировалась по гравитации между действиями
    if (p.cur.y < prevY) {
      this.plan = null;
      this.currentRotationCount = 0;
    }
    this.lastPieceRef = p.cur.m;
  }
}
