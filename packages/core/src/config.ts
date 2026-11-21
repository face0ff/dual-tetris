export interface GameConfig {
  /** Ширина поля в клетках (3.1) */
  boardWidth: number;
  /** Высота поля в клетках (3.1) */
  boardHeight: number;
  /** Начальное и максимальное здоровье (3.1, 3.3) */
  maxHp: number;
  /** Порог HP для режима ярости (3.1, 3.2) */
  rageHpThreshold: number;
  /** Множитель урона в ярости (3.2) */
  rageDamageMultiplier: number;
  /** Множитель интервала гравитации в ярости (3.1) */
  rageGravityMultiplier: number;
  /** Базовый интервал гравитации в секундах (3.1) */
  gravityBaseSec: number;
  /** Минимальный базовый порог гравитации (3.1) */
  gravityMinBaseSec: number;
  /** Ускорение гравитации за секунду матча (3.1) */
  gravityDecayPerSec: number;
  /** Общий множитель гравитации игрока (3.1) */
  gravityFactor: number;
  /** Урон при переполнении поля (3.1) */
  overflowDamage: number;
  /** Количество верхних строк (0..overflowClearRows-1), очищаемых при переполнении (3.1) */
  overflowClearRows: number;
  /** Сдвиги при вращении у стен (3.1) */
  wallKicks: readonly number[];
  /** Базовый урон на единицу силы волны (3.2) */
  baseDamagePerPower: number;
  /** Коэффициент бонуса комбо в формуле dpp (3.2) */
  comboBonusFactor: number;
  /** Скорость волны в клетках в секунду (3.2) */
  waveSpeedCellsPerSec: number;
  /** Зазор между полями в клетках (3.2) */
  gapCells: number;
  /** Зелёный цвет: лечение за каждую сгоревшую линию (3.3) */
  greenHealPerLine: number;
  /** Синий цвет: базовая длительность заморозки в секундах (3.3) */
  blueFreezeBaseSec: number;
  /** Синий цвет: дополнительная заморозка за единицу силы волны (3.3) */
  blueFreezePerPowerSec: number;
  /** Красный цвет: базовое число метеоритов (3.3) */
  redMeteorsBase: number;
  /** Красный цвет: дополнительные метеориты за единицу силы волны (3.3) */
  redMeteorsPerPower: number;
  /** Жёлтый цвет: количество дополнительных джокеров в очереди после замены next (3.3) */
  yellowExtraJokers: number;
  /** Максимальный запас энергии каждого из 4 цветов (Фаза 1А) */
  energyMax: number;
  /** Автоматическое срабатывание цветовых эффектов при сжигании линии */
  autoColorEffects: boolean;
  /** Частота тика сервера в Гц (4) */
  serverTickHz: number;
  /** Частота отправки снапшотов в Гц (4) */
  snapshotHz: number;
  /** Лимит команд ввода в секунду (5) */
  maxInputsPerSec: number;
  /** Таймаут переподключения игрока в секундах (7) */
  reconnectTimeoutSec: number;
  /** Время жизни пустой комнаты в секундах (4) */
  emptyRoomTtlSec: number;
  /** Настройки бота (7) */
  bot: {
    actionIntervalSec: number;
    mistakeProbability: number;
    weightLines: number;
    weightAggregateHeight: number;
    weightHoles: number;
    weightBumpiness: number;
  };
  /** Настройки мобильных свайпов (6) */
  touch: {
    lockThresholdCells: number;
    axisLockRatio: number;
    horizontalStepCells: number;
    verticalStepCells: number;
    hardDropVelocityPxPerMs: number;
    hardDropWindowMs: number;
    hardDropMinCells: number;
    hardDropMaxDurationMs: number;
    tapMaxDurationMs: number;
    tapMaxMoveCells: number;
    swipeUpRotateCells: number;
  };
}

export const DEFAULT_CONFIG: GameConfig = {
  boardWidth: 16,
  boardHeight: 15,
  maxHp: 100,
  rageHpThreshold: 25,
  rageDamageMultiplier: 1.5,
  rageGravityMultiplier: 0.7,
  gravityBaseSec: 0.9,
  gravityMinBaseSec: 0.25,
  gravityDecayPerSec: 0.002,
  gravityFactor: 1.1,
  overflowDamage: 15,
  overflowClearRows: 8,
  wallKicks: [0, -1, 1, -2, 2],
  baseDamagePerPower: 5,
  comboBonusFactor: 0.4,
  waveSpeedCellsPerSec: 25,
  gapCells: 2.7,
  greenHealPerLine: 6,
  blueFreezeBaseSec: 1.5,
  blueFreezePerPowerSec: 1.2,
  redMeteorsBase: 3,
  redMeteorsPerPower: 2,
  yellowExtraJokers: 3,
  energyMax: 100,
  autoColorEffects: true,
  serverTickHz: 30,
  snapshotHz: 15,
  maxInputsPerSec: 30,
  reconnectTimeoutSec: 30,
  emptyRoomTtlSec: 600,
  bot: {
    actionIntervalSec: 0.4,
    mistakeProbability: 0.3,
    weightLines: 0.76,
    weightAggregateHeight: -0.51,
    weightHoles: -0.54,
    weightBumpiness: -0.18,
  },
  touch: {
    lockThresholdCells: 0.5,
    axisLockRatio: 1.2,
    horizontalStepCells: 0.8,
    verticalStepCells: 1.0,
    hardDropVelocityPxPerMs: 0.8,
    hardDropWindowMs: 150,
    hardDropMinCells: 3,
    hardDropMaxDurationMs: 260,
    tapMaxDurationMs: 300,
    tapMaxMoveCells: 0.6,
    swipeUpRotateCells: 2.0,
  },
};
