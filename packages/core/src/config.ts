export type AbilityRarity = 'common' | 'rare' | 'epic' | 'legendary';
export type AbilityEffectType =
  | 'heal'
  | 'mega_heal'
  | 'wave_shield'
  | 'vampire'
  | 'freeze'
  | 'deep_freeze'
  | 'force_drop'
  | 'cryo_storm'
  | 'destroy_cell'
  | 'carpet_strike'
  | 'laser_row'
  | 'armageddon'
  | 'joker'
  | 'joker_rain'
  | 'alchemy'
  | 'energy_surge';

export type ChestTier = 'wooden' | 'silver' | 'gold' | 'legendary';
export type BotDifficulty = 'easy' | 'medium' | 'hard' | 'boss';

export interface BotDifficultyProfile {
  id: BotDifficulty;
  name: string;
  actionIntervalSec: number;
  mistakeProbability: number;
  maxHp: number;
  winCoins: number;
  xpReward: number;
  loadout: [
    { abilityId: string | null; level: number },
    { abilityId: string | null; level: number },
    { abilityId: string | null; level: number },
    { abilityId: string | null; level: number },
  ];
}

export interface ChestDefinition {
  id: ChestTier;
  name: string;
  price: number;
  weights: Record<AbilityRarity, number>;
}

export interface EconomyConfig {
  startingCoins: number;
  pvpWinCoins: number;
  botWinCoins: number;
  participationCoins: number;
  maxAbilityLevel: number;
  levelBonusPerStep: number;
  maxLevelDuplicateRefundRatio: number;
  dailyBossFreeAttempts: number;
  dailyBossMaxAdAttempts: number;
  bossFirstWinChest: ChestTier;
  chests: Record<ChestTier, ChestDefinition>;
}

export interface AbilityDefinition {
  id: string;
  name: string;
  color: 1 | 2 | 3 | 4;
  rarity: AbilityRarity;
  energyCost: number;
  description: string;
  effectType: AbilityEffectType;
  allowWhenFrozen?: boolean;
  params: Record<string, number>;
}

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
  /** Четыре слота способностей по умолчанию (Фаза 1Б) */
  defaultLoadout: [string | null, string | null, string | null, string | null];
  /** Реестр доступных способностей (Фаза 1Б / Фаза 2) */
  abilities: Record<string, AbilityDefinition>;
  /** Настройки экономики, монет и сундуков (Фаза 2) */
  economy: EconomyConfig;
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
  /** Настройки бота (7, Фаза 3) */
  bot: {
    actionIntervalSec: number;
    mistakeProbability: number;
    weightLines: number;
    weightAggregateHeight: number;
    weightHoles: number;
    weightBumpiness: number;
    difficulties: Record<BotDifficulty, BotDifficultyProfile>;
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
  autoColorEffects: false,
  defaultLoadout: ['heal', 'freeze', 'destroy_cell', 'joker'],
  abilities: {
    // 🟩 ЗЕЛЁНЫЕ (Выживание, Щит, Вампиризм)
    heal: {
      id: 'heal',
      name: 'Лечение',
      color: 1,
      rarity: 'common',
      energyCost: 15,
      description: 'Восстанавливает 15 HP (работает в заморозке)',
      effectType: 'heal',
      allowWhenFrozen: true,
      params: { amount: 15 },
    },
    mega_heal: {
      id: 'mega_heal',
      name: 'Мега-лечение',
      color: 1,
      rarity: 'rare',
      energyCost: 26,
      description: 'Восстанавливает 28 HP (работает в заморозке)',
      effectType: 'mega_heal',
      allowWhenFrozen: true,
      params: { amount: 28 },
    },
    wave_shield: {
      id: 'wave_shield',
      name: 'Щит волн',
      color: 1,
      rarity: 'epic',
      energyCost: 24,
      description: 'Гасит все летящие в тебя волны соперника и лечит 12 HP',
      effectType: 'wave_shield',
      allowWhenFrozen: true,
      params: { amount: 12 },
    },
    vampire: {
      id: 'vampire',
      name: 'Вампиризм',
      color: 1,
      rarity: 'legendary',
      energyCost: 32,
      description: 'Похищает 16 HP у соперника и передаёт тебе',
      effectType: 'vampire',
      allowWhenFrozen: true,
      params: { amount: 16 },
    },

    // 🟦 СИНИЕ (Контроль, Саботаж)
    freeze: {
      id: 'freeze',
      name: 'Заморозка',
      color: 2,
      rarity: 'common',
      energyCost: 20,
      description: 'Замораживает управление соперника на 2.5 сек',
      effectType: 'freeze',
      allowWhenFrozen: false,
      params: { duration: 2.5 },
    },
    deep_freeze: {
      id: 'deep_freeze',
      name: 'Глубокий лёд',
      color: 2,
      rarity: 'rare',
      energyCost: 30,
      description: 'Замораживает управление соперника на 4.2 сек',
      effectType: 'deep_freeze',
      allowWhenFrozen: false,
      params: { duration: 4.2 },
    },
    force_drop: {
      id: 'force_drop',
      name: 'Грави-удар',
      color: 2,
      rarity: 'epic',
      energyCost: 24,
      description: 'Мгновенно обрушивает фигуру соперника вниз и морозит на 1.5 сек',
      effectType: 'force_drop',
      allowWhenFrozen: false,
      params: { duration: 1.5 },
    },
    cryo_storm: {
      id: 'cryo_storm',
      name: 'Крио-шторм',
      color: 2,
      rarity: 'legendary',
      energyCost: 34,
      description: 'Морозит соперника на 3.2 сек и сжигает по 12 энергии каждого цвета',
      effectType: 'cryo_storm',
      allowWhenFrozen: false,
      params: { duration: 3.2, drain: 12 },
    },

    // 🟥 КРАСНЫЕ (Разрушение, Атака)
    destroy_cell: {
      id: 'destroy_cell',
      name: 'Метеоры',
      color: 3,
      rarity: 'common',
      energyCost: 18,
      description: 'Уничтожает 5 случайных кубиков соперника',
      effectType: 'destroy_cell',
      allowWhenFrozen: false,
      params: { count: 5 },
    },
    carpet_strike: {
      id: 'carpet_strike',
      name: 'Ковровый удар',
      color: 3,
      rarity: 'rare',
      energyCost: 27,
      description: 'Уничтожает 10 случайных кубиков соперника',
      effectType: 'carpet_strike',
      allowWhenFrozen: false,
      params: { count: 10 },
    },
    laser_row: {
      id: 'laser_row',
      name: 'Лазерный срез',
      color: 3,
      rarity: 'epic',
      energyCost: 28,
      description: 'Стирает 2 самые заполненные строки соперника и наносит 8 урона',
      effectType: 'laser_row',
      allowWhenFrozen: false,
      params: { rows: 2, damage: 8 },
    },
    armageddon: {
      id: 'armageddon',
      name: 'Армагеддон',
      color: 3,
      rarity: 'legendary',
      energyCost: 35,
      description: 'Выпускает ударную волну ×3 и уничтожает 8 кубиков соперника',
      effectType: 'armageddon',
      allowWhenFrozen: false,
      params: { wavePow: 3, count: 8 },
    },

    // 🟨 ЖЁЛТЫЕ (Спецфигуры, Энергия, Алхимия)
    joker: {
      id: 'joker',
      name: 'Джокеры',
      color: 4,
      rarity: 'common',
      energyCost: 16,
      description: 'Даёт 2 проникающих джокера 1×1',
      effectType: 'joker',
      allowWhenFrozen: false,
      params: { count: 2 },
    },
    joker_rain: {
      id: 'joker_rain',
      name: 'Дождь джокеров',
      color: 4,
      rarity: 'rare',
      energyCost: 25,
      description: 'Даёт 4 проникающих джокера 1×1 подряд',
      effectType: 'joker_rain',
      allowWhenFrozen: false,
      params: { count: 4 },
    },
    alchemy: {
      id: 'alchemy',
      name: 'Алхимия',
      color: 4,
      rarity: 'epic',
      energyCost: 24,
      description: 'Заполняет нижний ряд до 15/16 клеток под взрыв и даёт 1 джокер',
      effectType: 'alchemy',
      allowWhenFrozen: false,
      params: { jokers: 1 },
    },
    energy_surge: {
      id: 'energy_surge',
      name: 'Энерго-шторм',
      color: 4,
      rarity: 'legendary',
      energyCost: 28,
      description: 'Даёт 2 джокера 1×1 и заливает +14 энергии во все остальные баки',
      effectType: 'energy_surge',
      allowWhenFrozen: false,
      params: { jokers: 2, boost: 14 },
    },
  },
  economy: {
    startingCoins: 300,
    pvpWinCoins: 60,
    botWinCoins: 30,
    participationCoins: 15,
    maxAbilityLevel: 5,
    levelBonusPerStep: 0.1,
    maxLevelDuplicateRefundRatio: 0.5,
    dailyBossFreeAttempts: 3,
    dailyBossMaxAdAttempts: 3,
    bossFirstWinChest: 'wooden',
    chests: {
      wooden: {
        id: 'wooden',
        name: 'Деревянный сундук',
        price: 50,
        weights: { common: 75, rare: 20, epic: 4.5, legendary: 0.5 },
      },
      silver: {
        id: 'silver',
        name: 'Серебряный сундук',
        price: 200,
        weights: { common: 40, rare: 42, epic: 15, legendary: 3 },
      },
      gold: {
        id: 'gold',
        name: 'Золотой сундук',
        price: 500,
        weights: { common: 10, rare: 45, epic: 35, legendary: 10 },
      },
      legendary: {
        id: 'legendary',
        name: 'Легендарный сундук',
        price: 1000,
        weights: { common: 0, rare: 15, epic: 45, legendary: 40 },
      },
    },
  },
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
    difficulties: {
      easy: {
        id: 'easy',
        name: 'Лёгкий Бот',
        actionIntervalSec: 0.55,
        mistakeProbability: 0.4,
        maxHp: 100,
        winCoins: 20,
        xpReward: 15,
        loadout: [
          { abilityId: 'heal', level: 1 },
          { abilityId: null, level: 1 },
          { abilityId: 'destroy_cell', level: 1 },
          { abilityId: null, level: 1 },
        ],
      },
      medium: {
        id: 'medium',
        name: 'Средний Бот',
        actionIntervalSec: 0.4,
        mistakeProbability: 0.25,
        maxHp: 100,
        winCoins: 35,
        xpReward: 25,
        loadout: [
          { abilityId: 'heal', level: 2 },
          { abilityId: 'freeze', level: 2 },
          { abilityId: 'destroy_cell', level: 2 },
          { abilityId: 'joker', level: 2 },
        ],
      },
      hard: {
        id: 'hard',
        name: 'Сложный Бот',
        actionIntervalSec: 0.26,
        mistakeProbability: 0.08,
        maxHp: 100,
        winCoins: 55,
        xpReward: 40,
        loadout: [
          { abilityId: 'mega_heal', level: 3 },
          { abilityId: 'deep_freeze', level: 3 },
          { abilityId: 'laser_row', level: 3 },
          { abilityId: 'joker_rain', level: 3 },
        ],
      },
      boss: {
        id: 'boss',
        name: '👑 Босс Дня',
        actionIntervalSec: 0.16,
        mistakeProbability: 0.0,
        maxHp: 120,
        winCoins: 100,
        xpReward: 80,
        loadout: [
          { abilityId: 'vampire', level: 4 },
          { abilityId: 'cryo_storm', level: 4 },
          { abilityId: 'armageddon', level: 4 },
          { abilityId: 'energy_surge', level: 4 },
        ],
      },
    },
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
