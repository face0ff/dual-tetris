import { DEFAULT_CONFIG, type AbilityDefinition, type GameConfig } from './config.js';
import type {
  AbilityErrorCode,
  AbilitySlots,
  ActivePiece,
  EnergyState,
  GameEvent,
  InputAction,
  PieceShape,
  SnapshotMessage,
  WaveState,
} from './protocol.js';
import { SeededRng } from './rng.js';

/** 7 канонических тетромино из прототипа */
export const TETROMINO_SHAPES: readonly number[][][] = [
  [[1, 1, 1, 1]],
  [
    [1, 1],
    [1, 1],
  ],
  [
    [0, 1, 0],
    [1, 1, 1],
  ],
  [
    [0, 1, 1],
    [1, 1, 0],
  ],
  [
    [1, 1, 0],
    [0, 1, 1],
  ],
  [
    [1, 0, 0],
    [1, 1, 1],
  ],
  [
    [0, 0, 1],
    [1, 1, 1],
  ],
];

/** Поворот матрицы по часовой стрелке на 90 градусов */
export function rotateMatrixCW(m: number[][]): number[][] {
  return m[0].map((_, i) => m.map((r) => r[i]).reverse());
}

/** Возвращает индекс самой нижней пустой клетки в столбце x, либо -1 если столбец полон */
export function getLowestEmptyRow(board: number[][], x: number, height = board.length): number {
  if (x < 0 || x >= (board[0]?.length ?? 0)) return -1;
  for (let r = height - 1; r >= 0; r--) {
    if (board[r][x] === 0) {
      return r;
    }
  }
  return -1;
}

/** Проверка, помещается ли фигура m в координатах (x, y) на доске g (с учётом проникающего джокера c===5) */
export function fits(
  g: number[][],
  m: number[][],
  x: number,
  y: number,
  width = g[0].length,
  height = g.length,
  isJoker = false
): boolean {
  if (isJoker && m.length === 1 && m[0].length === 1) {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    const lowestEmpty = getLowestEmptyRow(g, x, height);
    return lowestEmpty !== -1 && y <= lowestEmpty;
  }
  for (let r = 0; r < m.length; r++) {
    for (let c = 0; c < m[0].length; c++) {
      if (m[r][c]) {
        const nx = x + c;
        const ny = y + r;
        if (nx < 0 || nx >= width || ny >= height || (ny >= 0 && g[ny][nx] !== 0)) {
          return false;
        }
      }
    }
  }
  return true;
}

export interface PlayerState {
  index: 0 | 1;
  board: number[][];
  hp: number;
  combo: number;
  bag: number[];
  cur: ActivePiece;
  next: PieceShape;
  gravityTimer: number;
  freezeRemaining: number;
  jokersRemaining: number;
  energy: EnergyState;
  abilities: AbilitySlots;
  processedAbilityRequests: Set<string>;
  rng: SeededRng;
  ackSeq: number;
}

export interface MatchState {
  seed: number;
  config: GameConfig;
  tick: number;
  t: number;
  players: [PlayerState, PlayerState];
  waves: WaveState[];
  nextWaveId: number;
  events: GameEvent[];
  finished: boolean;
  winner: 0 | 1 | null;
  endReason: 'ko' | 'draw' | 'forfeit' | null;
}

export function createEmptyBoard(width: number, height: number): number[][] {
  return Array.from({ length: height }, () => Array<number>(width).fill(0));
}

export function drawNextPiece(player: Pick<PlayerState, 'bag' | 'jokersRemaining' | 'rng'>): PieceShape {
  if (player.jokersRemaining > 0) {
    player.jokersRemaining--;
    return { m: [[1]], c: 5 };
  }
  if (player.bag.length === 0) {
    player.bag = player.rng.shuffle([0, 1, 2, 3, 4, 5, 6]);
  }
  const shapeIdx = player.bag.pop()!;
  const shape = TETROMINO_SHAPES[shapeIdx].map((row) => row.slice());
  const color = player.rng.nextInt(1, 4);
  return { m: shape, c: color };
}

export function spawnPiece(state: MatchState, playerIndex: 0 | 1): void {
  const p = state.players[playerIndex];
  const { boardWidth, overflowDamage, overflowClearRows } = state.config;
  const nextShape = p.next;
  p.next = drawNextPiece(p);
  const spawnX = Math.floor((boardWidth - nextShape.m[0].length) / 2);
  p.cur = {
    m: nextShape.m.map((r) => r.slice()),
    c: nextShape.c,
    x: spawnX,
    y: 0,
  };

  const isJoker = p.cur.c === 5;
  if (!fits(p.board, p.cur.m, p.cur.x, p.cur.y, state.config.boardWidth, state.config.boardHeight, isJoker)) {
    p.hp -= overflowDamage;
    const clearLimit = Math.min(overflowClearRows, state.config.boardHeight);
    for (let y = 0; y < clearLimit; y++) {
      p.board[y].fill(0);
    }
    state.events.push({
      type: 'overflow',
      player: playerIndex,
      damage: overflowDamage,
    });
  }
}

export function createMatch(seed: number, config: GameConfig = DEFAULT_CONFIG): MatchState {
  const createPlayer = (index: 0 | 1): PlayerState => {
    const rng = new SeededRng(seed + index * 100003);
    const bag: number[] = [];
    const temp = { bag, jokersRemaining: 0, rng };
    const first = drawNextPiece(temp);
    const second = drawNextPiece(temp);
    const spawnX = Math.floor((config.boardWidth - first.m[0].length) / 2);
    return {
      index,
      board: createEmptyBoard(config.boardWidth, config.boardHeight),
      hp: config.maxHp,
      combo: 0,
      bag: temp.bag,
      cur: {
        m: first.m,
        c: first.c,
        x: spawnX,
        y: 0,
      },
      next: second,
      gravityTimer: 0,
      freezeRemaining: 0,
      jokersRemaining: 0,
      energy: {
        green: 0,
        blue: 0,
        red: 0,
        yellow: 0,
      },
      abilities: [
        { abilityId: config.defaultLoadout[0] ?? null },
        { abilityId: config.defaultLoadout[1] ?? null },
        { abilityId: config.defaultLoadout[2] ?? null },
        { abilityId: config.defaultLoadout[3] ?? null },
      ],
      processedAbilityRequests: new Set<string>(),
      rng,
      ackSeq: 0,
    };
  };

  return {
    seed,
    config,
    tick: 0,
    t: 0,
    players: [createPlayer(0), createPlayer(1)],
    waves: [],
    nextWaveId: 1,
    events: [],
    finished: false,
    winner: null,
    endReason: null,
  };
}

/** Интервал падения на одну клетку по формуле 3.1 */
export function getGravityIntervalSec(state: MatchState, playerIndex: 0 | 1): number {
  const { config, t } = state;
  const p = state.players[playerIndex];
  const base = Math.max(config.gravityMinBaseSec, config.gravityBaseSec - config.gravityDecayPerSec * t);
  const rageMult = p.hp < config.rageHpThreshold ? config.rageGravityMultiplier : 1;
  return base * config.gravityFactor * rageMult;
}

/** Начисление энергии за все цветные кубики (1..4) в уничтоженных линиях (Фаза 1А) */
export function addEnergy(
  player: PlayerState,
  colorCounts: number[],
  energyMax: number
): EnergyState {
  const gained: EnergyState = {
    green: colorCounts[1] ?? 0,
    blue: colorCounts[2] ?? 0,
    red: colorCounts[3] ?? 0,
    yellow: colorCounts[4] ?? 0,
  };
  player.energy.green = Math.min(energyMax, player.energy.green + gained.green);
  player.energy.blue = Math.min(energyMax, player.energy.blue + gained.blue);
  player.energy.red = Math.min(energyMax, player.energy.red + gained.red);
  player.energy.yellow = Math.min(energyMax, player.energy.yellow + gained.yellow);
  return gained;
}

/** Определяет доминирующий цвет в сгоревших линиях по правилу 3.3 */
export function pickDominantColor(colorCounts: number[], rng: SeededRng): number {
  let maxCount = 0;
  for (let c = 1; c <= 4; c++) {
    if (colorCounts[c] > maxCount) {
      maxCount = colorCounts[c];
    }
  }
  if (maxCount === 0) {
    return 0;
  }
  const candidates: number[] = [];
  for (let c = 1; c <= 4; c++) {
    if (colorCounts[c] === maxCount) {
      candidates.push(c);
    }
  }
  if (candidates.length === 1) {
    return candidates[0];
  }
  const idx = rng.nextInt(0, candidates.length - 1);
  return candidates[idx];
}

/** Фиксация активной фигуры, сжигание линий, эффекты зелёного/жёлтого и выпуск волны */
export function lockPiece(state: MatchState, playerIndex: 0 | 1): void {
  const p = state.players[playerIndex];
  const { config } = state;
  const { m, c, x, y } = p.cur;

  for (let r = 0; r < m.length; r++) {
    for (let q = 0; q < m[0].length; q++) {
      if (m[r][q] && y + r >= 0 && y + r < config.boardHeight && x + q >= 0 && x + q < config.boardWidth) {
        p.board[y + r][x + q] = c;
      }
    }
  }

  let burnedCount = 0;
  let lowestBurnedRow = 0;
  const colorCounts = [0, 0, 0, 0, 0, 0];

  for (let row = config.boardHeight - 1; row >= 0; row--) {
    if (p.board[row].every((v) => v !== 0)) {
      if (burnedCount === 0) {
        lowestBurnedRow = row;
      }
      for (const cellColor of p.board[row]) {
        if (cellColor >= 1 && cellColor <= 5) {
          colorCounts[cellColor]++;
        }
      }
      p.board.splice(row, 1);
      p.board.unshift(Array<number>(config.boardWidth).fill(0));
      burnedCount++;
      row++;
    }
  }

  if (burnedCount > 0) {
    p.combo++;
    const gained = addEnergy(p, colorCounts, config.energyMax);
    state.events.push({
      type: 'energy_gain',
      player: playerIndex,
      gained,
      total: { ...p.energy },
    });

    const domColor = pickDominantColor(colorCounts, p.rng);

    state.events.push({
      type: 'line_clear',
      player: playerIndex,
      count: burnedCount,
      color: domColor,
      row: lowestBurnedRow,
    });

    if (config.autoColorEffects) {
      if (domColor === 1) {
        const healAmount = config.greenHealPerLine * burnedCount;
        p.hp = Math.min(config.maxHp, p.hp + healAmount);
        state.events.push({
          type: 'heal',
          player: playerIndex,
          amount: healAmount,
          hp: p.hp,
        });
      } else if (domColor === 4) {
        p.next = { m: [[1]], c: 5 };
        p.jokersRemaining = config.yellowExtraJokers;
        state.events.push({
          type: 'jokers',
          player: playerIndex,
          count: 1 + config.yellowExtraJokers,
        });
      }
    }

    const rage = p.hp < config.rageHpThreshold ? config.rageDamageMultiplier : 1;
    const dpp =
      config.baseDamagePerPower *
      (1 + (Math.max(0, p.combo - 1) * config.comboBonusFactor) / burnedCount) *
      rage;

    // Координата старта волны на оси u:
    // Для игрока 0 его край у зазора u = 0, строка cy находится на u = -(cy + 0.5), летит к u = gapCells (+).
    // Для игрока 1 его край у зазора u = gapCells, строка cy находится на u = gapCells + (cy + 0.5), летит к u = 0 (-).
    const startU =
      playerIndex === 0 ? -(lowestBurnedRow + 0.5) : config.gapCells + (lowestBurnedRow + 0.5);

    const waveId = state.nextWaveId++;
    state.waves.push({
      id: waveId,
      owner: playerIndex,
      u: startU,
      pow: burnedCount,
      dpp,
      col: domColor,
    });

    state.events.push({
      type: 'wave_spawn',
      player: playerIndex,
      waveId,
      pow: burnedCount,
      color: domColor,
      row: lowestBurnedRow,
    });
  } else {
    p.combo = 0;
  }

  p.gravityTimer = 0;
  spawnPiece(state, playerIndex);
}

/** Применение попадания волны по сопернику (3.2, 3.3) */
export function applyWaveImpact(state: MatchState, wave: WaveState): void {
  const targetIndex: 0 | 1 = wave.owner === 0 ? 1 : 0;
  const target = state.players[targetIndex];
  const attacker = state.players[wave.owner];
  const { config } = state;

  // 1. Наносит урон round(dpp * pow)
  const damage = Math.round(wave.dpp * wave.pow);
  target.hp -= damage;

  // 2. Очищает pow непустых неполных строк с наибольшим числом занятых клеток.
  // При равенстве выбирается строка с меньшим индексом. Строки выше не сдвигаются.
  const candidateRows = target.board
    .map((row, idx) => ({
      idx,
      occupied: row.reduce((sum, v) => sum + (v !== 0 ? 1 : 0), 0),
    }))
    .filter((r) => r.occupied > 0 && r.occupied < config.boardWidth)
    .sort((a, b) => b.occupied - a.occupied || a.idx - b.idx)
    .slice(0, wave.pow);

  const rowsCleared: number[] = [];
  for (const r of candidateRows) {
    target.board[r.idx].fill(0);
    rowsCleared.push(r.idx);
  }

  state.events.push({
    type: 'impact',
    target: targetIndex,
    attacker: wave.owner,
    damage,
    rowsCleared,
    color: wave.col,
  });

  // 3. Применяет эффект цвета (3.3), если включены автоматические эффекты
  if (config.autoColorEffects) {
    if (wave.col === 2) {
      const duration = config.blueFreezeBaseSec + config.blueFreezePerPowerSec * wave.pow;
      target.freezeRemaining = duration;
      state.events.push({
        type: 'freeze',
        target: targetIndex,
        duration,
      });
    } else if (wave.col === 3) {
      const occupiedCells: Array<[number, number]> = [];
      for (let r = 0; r < config.boardHeight; r++) {
        for (let c = 0; c < config.boardWidth; c++) {
          if (target.board[r][c] !== 0) {
            occupiedCells.push([r, c]);
          }
        }
      }
      const meteorCount = Math.min(
        occupiedCells.length,
        config.redMeteorsBase + config.redMeteorsPerPower * wave.pow
      );
      const destroyed: Array<[number, number]> = [];
      for (let k = 0; k < meteorCount; k++) {
        const pickIdx = attacker.rng.nextInt(0, occupiedCells.length - 1);
        const [ry, rx] = occupiedCells.splice(pickIdx, 1)[0];
        target.board[ry][rx] = 0;
        destroyed.push([ry, rx]);
      }
      state.events.push({
        type: 'meteor',
        target: targetIndex,
        cells: destroyed,
      });
    }
  }
}

export type AbilityActivationResult =
  | { ok: true; ability: AbilityDefinition }
  | { ok: false; errorCode: AbilityErrorCode };

function getEnergyKeyByColor(color: 1 | 2 | 3 | 4): keyof EnergyState {
  switch (color) {
    case 1:
      return 'green';
    case 2:
      return 'blue';
    case 3:
      return 'red';
    case 4:
      return 'yellow';
  }
}

export function applyHealAbility(
  state: MatchState,
  playerIndex: 0 | 1,
  params: Record<string, number>
): void {
  const p = state.players[playerIndex];
  const amount = Math.max(1, params.amount ?? 15);
  p.hp = Math.min(state.config.maxHp, p.hp + amount);
  state.events.push({
    type: 'heal',
    player: playerIndex,
    amount,
    hp: p.hp,
  });
}

export function applyFreezeAbility(
  state: MatchState,
  playerIndex: 0 | 1,
  params: Record<string, number>
): void {
  const targetIndex: 0 | 1 = playerIndex === 0 ? 1 : 0;
  const target = state.players[targetIndex];
  const duration = Math.max(0.5, params.duration ?? 2.5);
  target.freezeRemaining = Math.max(target.freezeRemaining, duration);
  state.events.push({
    type: 'freeze',
    target: targetIndex,
    duration,
  });
}

export function applyDestroyCellAbility(
  state: MatchState,
  playerIndex: 0 | 1,
  params: Record<string, number>
): void {
  const targetIndex: 0 | 1 = playerIndex === 0 ? 1 : 0;
  const target = state.players[targetIndex];
  const attacker = state.players[playerIndex];
  const { config } = state;

  const occupiedCells: Array<[number, number]> = [];
  for (let r = 0; r < config.boardHeight; r++) {
    for (let c = 0; c < config.boardWidth; c++) {
      if (target.board[r][c] !== 0) {
        occupiedCells.push([r, c]);
      }
    }
  }
  const destroyCount = Math.min(occupiedCells.length, Math.max(1, params.count ?? 5));
  const destroyed: Array<[number, number]> = [];
  for (let k = 0; k < destroyCount; k++) {
    const pickIdx = attacker.rng.nextInt(0, occupiedCells.length - 1);
    const [ry, rx] = occupiedCells.splice(pickIdx, 1)[0];
    target.board[ry][rx] = 0;
    destroyed.push([ry, rx]);
  }
  state.events.push({
    type: 'meteor',
    target: targetIndex,
    cells: destroyed,
  });
}

export function applyJokerAbility(
  state: MatchState,
  playerIndex: 0 | 1,
  params: Record<string, number>
): void {
  const p = state.players[playerIndex];
  const count = Math.max(1, params.count ?? 2);
  if (p.next.c === 5) {
    p.jokersRemaining += count;
  } else {
    p.next = { m: [[1]], c: 5 };
    p.jokersRemaining += count - 1;
  }
  state.events.push({
    type: 'jokers',
    player: playerIndex,
    count,
  });
}

/** Ручная активация способности игроком из слота slotIndex (Фаза 1Б) */
export function activateAbility(
  state: MatchState,
  playerIndex: 0 | 1,
  slotIndex: number,
  requestId?: string
): AbilityActivationResult {
  if (state.finished) {
    return { ok: false, errorCode: 'MATCH_NOT_PLAYING' };
  }
  const p = state.players[playerIndex];

  if (requestId) {
    if (p.processedAbilityRequests.has(requestId)) {
      return { ok: false, errorCode: 'DUPLICATE_REQUEST' };
    }
  }

  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 3) {
    return { ok: false, errorCode: 'ABILITY_NOT_FOUND' };
  }

  const slot = p.abilities[slotIndex];
  if (!slot || !slot.abilityId) {
    return { ok: false, errorCode: 'EMPTY_SLOT' };
  }

  const def = state.config.abilities[slot.abilityId];
  if (!def) {
    return { ok: false, errorCode: 'ABILITY_NOT_FOUND' };
  }

  if (p.freezeRemaining > 0 && !def.allowWhenFrozen) {
    return { ok: false, errorCode: 'ABILITY_NOT_AVAILABLE' };
  }

  const energyKey = getEnergyKeyByColor(def.color);
  if (p.energy[energyKey] < def.energyCost) {
    return { ok: false, errorCode: 'NOT_ENOUGH_ENERGY' };
  }

  // Списываем энергию и фиксируем requestId
  p.energy[energyKey] -= def.energyCost;
  if (requestId) {
    p.processedAbilityRequests.add(requestId);
  }

  state.events.push({
    type: 'ability_activated',
    player: playerIndex,
    slotIndex,
    abilityId: def.id,
    energyColor: def.color,
    energySpent: def.energyCost,
  });

  switch (def.effectType) {
    case 'heal':
      applyHealAbility(state, playerIndex, def.params);
      break;
    case 'freeze':
      applyFreezeAbility(state, playerIndex, def.params);
      break;
    case 'destroy_cell':
      applyDestroyCellAbility(state, playerIndex, def.params);
      break;
    case 'joker':
      applyJokerAbility(state, playerIndex, def.params);
      break;
  }

  return { ok: true, ability: def };
}

/** Применение одной команды игрока (L, R, ROT, SD, HD) */
export function applyPlayerInput(
  state: MatchState,
  playerIndex: 0 | 1,
  action: InputAction,
  seq?: number
): boolean {
  if (state.finished) return false;
  const p = state.players[playerIndex];
  if (seq !== undefined && seq > p.ackSeq) {
    p.ackSeq = seq;
  }
  // При заморозке управление игнорируется (3.3)
  if (p.freezeRemaining > 0) {
    return false;
  }

  const { boardWidth, boardHeight, wallKicks } = state.config;
  const isJoker = p.cur.c === 5;

  switch (action) {
    case 'L': {
      if (isJoker) {
        const nx = p.cur.x - 1;
        const lowest = getLowestEmptyRow(p.board, nx, boardHeight);
        if (nx >= 0 && lowest !== -1) {
          p.cur.x = nx;
          if (p.cur.y > lowest) p.cur.y = lowest;
          return true;
        }
        return false;
      }
      if (fits(p.board, p.cur.m, p.cur.x - 1, p.cur.y, boardWidth, boardHeight, false)) {
        p.cur.x -= 1;
        return true;
      }
      return false;
    }
    case 'R': {
      if (isJoker) {
        const nx = p.cur.x + 1;
        const lowest = getLowestEmptyRow(p.board, nx, boardHeight);
        if (nx < boardWidth && lowest !== -1) {
          p.cur.x = nx;
          if (p.cur.y > lowest) p.cur.y = lowest;
          return true;
        }
        return false;
      }
      if (fits(p.board, p.cur.m, p.cur.x + 1, p.cur.y, boardWidth, boardHeight, false)) {
        p.cur.x += 1;
        return true;
      }
      return false;
    }
    case 'ROT': {
      if (isJoker) return true;
      const rotated = rotateMatrixCW(p.cur.m);
      for (const kick of wallKicks) {
        if (fits(p.board, rotated, p.cur.x + kick, p.cur.y, boardWidth, boardHeight, false)) {
          p.cur.m = rotated;
          p.cur.x += kick;
          return true;
        }
      }
      return false;
    }
    case 'SD': {
      if (fits(p.board, p.cur.m, p.cur.x, p.cur.y + 1, boardWidth, boardHeight, isJoker)) {
        p.cur.y += 1;
        return true;
      }
      return false;
    }
    case 'HD': {
      while (fits(p.board, p.cur.m, p.cur.x, p.cur.y + 1, boardWidth, boardHeight, isJoker)) {
        p.cur.y += 1;
      }
      lockPiece(state, playerIndex);
      checkVictory(state);
      return true;
    }
  }
}

export function checkVictory(state: MatchState): void {
  if (state.finished) return;
  const hp0 = state.players[0].hp;
  const hp1 = state.players[1].hp;
  if (hp0 <= 0 || hp1 <= 0) {
    state.finished = true;
    if (hp0 <= 0 && hp1 <= 0) {
      if (hp0 > hp1) {
        state.winner = 0;
        state.endReason = 'ko';
      } else if (hp1 > hp0) {
        state.winner = 1;
        state.endReason = 'ko';
      } else {
        state.winner = null;
        state.endReason = 'draw';
      }
    } else if (hp0 <= 0) {
      state.winner = 1;
      state.endReason = 'ko';
    } else {
      state.winner = 0;
      state.endReason = 'ko';
    }
  }
}

/** Продвижение симуляции матча на dt секунд */
export function stepMatch(state: MatchState, dt: number): void {
  if (state.finished) return;

  state.tick += 1;
  state.t += dt;

  // 1. Шаг каждого игрока (таймер заморозки и гравитация)
  for (const playerIndex of [0, 1] as const) {
    const p = state.players[playerIndex];
    p.freezeRemaining = Math.max(0, p.freezeRemaining - dt);

    const interval = getGravityIntervalSec(state, playerIndex);
    p.gravityTimer += dt;
    if (p.gravityTimer >= interval) {
      p.gravityTimer = 0;
      const isJoker = p.cur.c === 5;
      if (
        fits(
          p.board,
          p.cur.m,
          p.cur.x,
          p.cur.y + 1,
          state.config.boardWidth,
          state.config.boardHeight,
          isJoker
        )
      ) {
        p.cur.y += 1;
      } else {
        lockPiece(state, playerIndex);
      }
    }
  }

  // 2. Движение волн
  const dist = state.config.waveSpeedCellsPerSec * dt;
  for (const w of state.waves) {
    w.u += w.owner === 0 ? dist : -dist;
  }

  // 3. Столкновение встречных волн (3.2)
  for (const w0 of state.waves) {
    if (w0.owner !== 0 || w0.pow <= 0) continue;
    for (const w1 of state.waves) {
      if (w1.owner !== 1 || w1.pow <= 0) continue;
      if (w0.u >= w1.u) {
        const reduced = Math.min(w0.pow, w1.pow);
        w0.pow -= reduced;
        w1.pow -= reduced;
        state.events.push({
          type: 'wave_collide',
          u: (w0.u + w1.u) / 2,
          reduced,
        });
        if (w0.pow <= 0) break;
      }
    }
  }

  // 4. Достижение края поля соперника
  for (const w of state.waves) {
    if (w.pow <= 0) continue;
    if (w.owner === 0 && w.u >= state.config.gapCells) {
      applyWaveImpact(state, w);
      w.pow = 0;
    } else if (w.owner === 1 && w.u <= 0) {
      applyWaveImpact(state, w);
      w.pow = 0;
    }
  }

  state.waves = state.waves.filter((w) => w.pow > 0);

  // 5. Проверка условия победы (3.4)
  checkVictory(state);
}

/** Вычисляет Y-координату призрака (ghost piece) для активной фигуры */
export function getGhostY(
  board: number[][],
  piece: ActivePiece,
  width = board[0].length,
  height = board.length
): number {
  const isJoker = piece.c === 5;
  let gy = piece.y;
  while (fits(board, piece.m, piece.x, gy + 1, width, height, isJoker)) {
    gy++;
  }
  return gy;
}

/** Создаёт снапшот текущего состояния матча и очищает буфер событий */
export function createSnapshot(state: MatchState, clearEvents = true): SnapshotMessage {
  const events = state.events.slice();
  if (clearEvents) {
    state.events.length = 0;
  }
  const clonePiece = (p: PieceShape): PieceShape => ({
    m: p.m.map((r) => r.slice()),
    c: p.c,
  });
  const cloneActive = (p: ActivePiece): ActivePiece => ({
    m: p.m.map((r) => r.slice()),
    c: p.c,
    x: p.x,
    y: p.y,
  });

  return {
    type: 'snapshot',
    tick: state.tick,
    ackSeq: [state.players[0].ackSeq, state.players[1].ackSeq],
    boards: [
      state.players[0].board.map((r) => r.slice()),
      state.players[1].board.map((r) => r.slice()),
    ],
    hp: [state.players[0].hp, state.players[1].hp],
    combo: [state.players[0].combo, state.players[1].combo],
    freeze: [state.players[0].freezeRemaining, state.players[1].freezeRemaining],
    jokers: [state.players[0].jokersRemaining, state.players[1].jokersRemaining],
    energy: [{ ...state.players[0].energy }, { ...state.players[1].energy }],
    abilities: [
      state.players[0].abilities.map((s) => ({ ...s })) as AbilitySlots,
      state.players[1].abilities.map((s) => ({ ...s })) as AbilitySlots,
    ],
    next: [clonePiece(state.players[0].next), clonePiece(state.players[1].next)],
    cur: [cloneActive(state.players[0].cur), cloneActive(state.players[1].cur)],
    waves: state.waves.map((w) => ({ ...w })),
    t: state.t,
    events,
  };
}
