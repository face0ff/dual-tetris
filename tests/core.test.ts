import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  SeededRng,
  applyPlayerInput,
  applyWaveImpact,
  createMatch,
  lockPiece,
  pickDominantColor,
  stepMatch,
} from '@dual-tetris/core';

describe('Ядро DUAL TETRIS (@dual-tetris/core)', () => {
  it('Движение, вращение и сдвиги у стен (wall kicks)', () => {
    const state = createMatch(12345);
    const p = state.players[0];
    // Задаём вертикальную палку I (1x4) у правого края
    p.cur = {
      m: [[1], [1], [1], [1]],
      c: 1,
      x: DEFAULT_CONFIG.boardWidth - 1,
      y: 2,
    };

    // Вправо за край сдвинуться нельзя
    expect(applyPlayerInput(state, 0, 'R', 1)).toBe(false);
    expect(p.cur.x).toBe(DEFAULT_CONFIG.boardWidth - 1);

    // При вращении в горизонтальную 4x1 срабатывает wall kick (-1 или -2 не хватит, но у края x=15 для ширины 4 нужно x=12, а у нас сдвиги 0,-1,1,-2,2)
    // Проверим сдвиг -2 с позиции x = 14 (14 - 2 = 12, ширина 4 -> 12..15 помещается!)
    p.cur.x = DEFAULT_CONFIG.boardWidth - 2; // 14
    expect(applyPlayerInput(state, 0, 'ROT', 2)).toBe(true);
    expect(p.cur.m).toEqual([[1, 1, 1, 1]]);
    expect(p.cur.x).toBe(DEFAULT_CONFIG.boardWidth - 4); // 12
  });

  it('Фиксация и сжигание 1–4 линий + расчёт комбо', () => {
    const state = createMatch(42);
    const p = state.players[0];
    const W = state.config.boardWidth;
    const H = state.config.boardHeight;

    // Заполним нижние 3 строки полностью, кроме последнего столбца
    for (let r = H - 3; r < H; r++) {
      for (let c = 0; c < W - 1; c++) {
        p.board[r][c] = 1;
      }
    }

    // Поставим вертикальную палку 1x4 в последний столбец, чтобы закрыть сразу 3 линии
    p.cur = {
      m: [[1], [1], [1], [1]],
      c: 1,
      x: W - 1,
      y: 0,
    };

    applyPlayerInput(state, 0, 'HD', 1);

    expect(p.combo).toBe(1);
    expect(state.waves.length).toBe(1);
    expect(state.waves[0].pow).toBe(3);

    // Следующая фиксация без сжигания линий сбрасывает комбо в 0
    applyPlayerInput(state, 0, 'HD', 2);
    expect(p.combo).toBe(0);
  });

  it('Подсчёт доминирующего цвета, ничья цветов и только джокеры', () => {
    const rng = new SeededRng(777);

    // Явный лидер: цвет 3
    expect(pickDominantColor([0, 2, 4, 8, 2, 0], rng)).toBe(3);

    // Только джокеры (цвет 5): эффекта нет (0)
    expect(pickDominantColor([0, 0, 0, 0, 0, 16], rng)).toBe(0);

    // Ничья между цветами 1 и 2: выбор детерминирован по seed
    const seen = new Set<number>();
    const tieRng = new SeededRng(100);
    for (let i = 0; i < 20; i++) {
      const col = pickDominantColor([0, 5, 5, 0, 0, 6], tieRng);
      expect([1, 2]).toContain(col);
      seen.add(col);
    }
    expect(seen.size).toBe(2);
  });

  it('Эффекты цветов: лечение не выше 100, заморозка блокирует ввод, метеориты и 4 джокера подряд', () => {
    const state = createMatch(999);
    const p0 = state.players[0];
    const p1 = state.players[1];
    const W = state.config.boardWidth;
    const H = state.config.boardHeight;

    // 1. Зелёный (1): лечение 6 * n, но не выше 100
    p0.hp = 96;
    p0.board[H - 1].fill(1);
    p0.cur = { m: [[1]], c: 1, x: 0, y: H - 2 };
    lockPiece(state, 0);
    expect(p0.hp).toBe(100);

    // 2. Жёлтый (4): следующая фигура становится джокером + ещё 3 в очереди (всего 4 подряд)
    p0.board[H - 1].fill(4);
    p0.cur = { m: [[1]], c: 4, x: 0, y: H - 2 };
    lockPiece(state, 0);
    // После lockPiece сразу вызывается spawnPiece, поэтому 1-й джокер уже в p0.cur!
    expect(p0.cur.c).toBe(5);
    expect(p0.cur.m).toEqual([[1]]);
    // А остальные 3 выходят при следующих 3 фиксациях:
    for (let k = 2; k <= 4; k++) {
      applyPlayerInput(state, 0, 'HD');
      expect(p0.cur.c).toBe(5);
      expect(p0.cur.m).toEqual([[1]]);
    }
    // 5-я фигура уже обычная (цвет 1..4)
    applyPlayerInput(state, 0, 'HD');
    expect(p0.cur.c).toBeGreaterThanOrEqual(1);
    expect(p0.cur.c).toBeLessThanOrEqual(4);

    // 3. Синий (2): заморозка при попадании волны блокирует ввод, но гравитация работает
    applyWaveImpact(state, {
      id: 99,
      owner: 0,
      u: state.config.gapCells,
      pow: 2,
      dpp: 5,
      col: 2,
    });
    expect(p1.freezeRemaining).toBeCloseTo(1.5 + 1.2 * 2, 5);
    const xBefore = p1.cur.x;
    expect(applyPlayerInput(state, 1, 'L')).toBe(false);
    expect(applyPlayerInput(state, 1, 'R')).toBe(false);
    expect(applyPlayerInput(state, 1, 'ROT')).toBe(false);
    expect(applyPlayerInput(state, 1, 'HD')).toBe(false);
    expect(p1.cur.x).toBe(xBefore);

    // Гравитация при заморозке продолжает опускать фигуру
    const yBefore = p1.cur.y;
    stepMatch(state, 1.5);
    expect(p1.cur.y).toBeGreaterThan(yBefore);

    // 4. Красный (3): метеориты уничтожают min(занятых, 3 + 2 * pow) клеток
    // Очистим поле p1 и оставим ровно 4 занятые клетки в разных строках (чтобы шаг 2 очистил 1 строку с 2 клетками, а метеориты добили оставшиеся 2 клетки)
    for (let r = 0; r < H; r++) p1.board[r].fill(0);
    p1.board[H - 1][0] = 1;
    p1.board[H - 1][1] = 1; // 2 клетки в строке H-1 (будет очищена самой волной pow=1)
    p1.board[H - 2][3] = 2; // 1 клетка
    p1.board[H - 3][5] = 3; // 1 клетка

    applyWaveImpact(state, {
      id: 100,
      owner: 0,
      u: state.config.gapCells,
      pow: 1,
      dpp: 5,
      col: 3,
    });

    const remainingCells = p1.board.flat().filter((v) => v !== 0).length;
    expect(remainingCells).toBe(0);
  });

  it('Джокер (1x1, жёлтый буст) проникает сквозь занятые клетки и занимает крайнюю нижнюю пустую клетку в столбце', () => {
    const state = createMatch(2026);
    const p0 = state.players[0];
    const H = state.config.boardHeight;

    // В столбце x = 5 делаем «крышу» из занятых клеток на строках 8, 9, 10, 12,
    // а строки 11, 13, 14 (самая нижняя!) оставляем пустыми
    p0.board[8][5] = 2;
    p0.board[9][5] = 3;
    p0.board[10][5] = 1;
    p0.board[12][5] = 2;

    // Даём игроку джокер (c = 5) в столбец x = 5
    p0.cur = { m: [[1]], c: 5, x: 5, y: 0 };
    applyPlayerInput(state, 0, 'HD');

    // Первый джокер должен проникнуть сквозь 8,9,10,12 и занять самую нижнюю пустую клетку (H - 1 = 14)
    expect(p0.board[H - 1][5]).toBe(5);
    expect(p0.board[H - 2][5]).toBe(0);

    // Второй джокер в том же столбце должен проникнуть сквозь крышу и занять следующую нижнюю пустую клетку (H - 2 = 13)
    p0.cur = { m: [[1]], c: 5, x: 5, y: 0 };
    applyPlayerInput(state, 0, 'HD');
    expect(p0.board[H - 2][5]).toBe(5);

    // Третий джокер в том же столбце займёт пустую дыру на строке 11 (между 10 и 12!)
    p0.cur = { m: [[1]], c: 5, x: 5, y: 0 };
    applyPlayerInput(state, 0, 'HD');
    expect(p0.board[11][5]).toBe(5);
  });

  it('Столкновение волн разной силы и разрушение строк по правилу 3.2', () => {
    const state = createMatch(555);
    // Волна игрока 0 силой 3 и встречная волна игрока 1 силой 1
    state.waves = [
      { id: 1, owner: 0, u: 1.3, pow: 3, dpp: 5, col: 1 },
      { id: 2, owner: 1, u: 1.4, pow: 1, dpp: 5, col: 1 },
    ];

    stepMatch(state, 0.02);

    // Вторая волна должна исчезнуть, а у первой остаться pow = 2
    expect(state.waves.length).toBe(1);
    expect(state.waves[0].owner).toBe(0);
    expect(state.waves[0].pow).toBe(2);

    // Проверим разрушение строк при попадании волны pow = 2:
    // Очищаются pow непустых неполных строк с наибольшим числом занятых клеток, при равенстве — с меньшим индексом.
    // Строки выше не сдвигаются.
    const p1 = state.players[1];
    const H = state.config.boardHeight;
    for (let r = 0; r < H; r++) p1.board[r].fill(0);

    // Строка 10: 5 клеток
    for (let c = 0; c < 5; c++) p1.board[10][c] = 1;
    // Строка 11: 8 клеток
    for (let c = 0; c < 8; c++) p1.board[11][c] = 2;
    // Строка 12: 5 клеток (равенство со строкой 10, но индекс 10 < 12)
    for (let c = 0; c < 5; c++) p1.board[12][c] = 3;
    // Строка 9: 2 клетки (выше строки 10 — не должна сдвинуться вниз!)
    p1.board[9][0] = 4;
    p1.board[9][1] = 4;

    applyWaveImpact(state, state.waves[0]);

    // Строки 11 (8 клеток) и 10 (5 клеток, меньший индекс чем 12) должны очиститься
    expect(p1.board[11].every((v) => v === 0)).toBe(true);
    expect(p1.board[10].every((v) => v === 0)).toBe(true);
    // Строка 12 остаётся нетронутой
    expect(p1.board[12].filter((v) => v !== 0).length).toBe(5);
    // Строка 9 остаётся на месте (не падает вниз)
    expect(p1.board[9][0]).toBe(4);
    expect(p1.board[9][1]).toBe(4);
  });

  it('Переполнение поля: −15 HP и очистка строк 0–7', () => {
    const state = createMatch(321);
    const p0 = state.players[0];
    // Заполним верхние строки 0..9 в центре
    for (let r = 0; r < 10; r++) {
      for (let c = 4; c < 12; c++) {
        p0.board[r][c] = 1;
      }
    }
    const hpBefore = p0.hp;
    applyPlayerInput(state, 0, 'HD');

    expect(p0.hp).toBe(hpBefore - state.config.overflowDamage);
    for (let r = 0; r < 8; r++) {
      expect(p0.board[r].every((v) => v === 0)).toBe(true);
    }
    // Строка 8 остаётся заполненной
    expect(p0.board[8].some((v) => v !== 0)).toBe(true);
  });

  it('Детерминизм: одинаковые seed и поток входов дают идентичное состояние', () => {
    const runSimulation = (seed: number) => {
      const m = createMatch(seed);
      const actions = ['L', 'R', 'ROT', 'SD', 'HD', 'L', 'L', 'HD', 'R', 'ROT', 'HD'] as const;
      for (let tick = 0; tick < 120; tick++) {
        if (tick % 10 === 0) {
          const act = actions[(tick / 10) % actions.length];
          applyPlayerInput(m, 0, act, tick + 1);
          applyPlayerInput(m, 1, act, tick + 1);
        }
        stepMatch(m, 1 / 30);
      }
      return m;
    };

    const simA = runSimulation(20261118);
    const simB = runSimulation(20261118);

    expect(simA.players[0].board).toEqual(simB.players[0].board);
    expect(simA.players[1].board).toEqual(simB.players[1].board);
    expect(simA.players[0].hp).toEqual(simB.players[0].hp);
    expect(simA.players[1].hp).toEqual(simB.players[1].hp);
    expect(simA.waves).toEqual(simB.waves);
  });
});
