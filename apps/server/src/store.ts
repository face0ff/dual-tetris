import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  DEFAULT_CONFIG,
  type AbilityRarity,
  type AbilitySlots,
  type ChestRewardResult,
  type ChestTier,
  type GameConfig,
  type PlayerProfileData,
} from '@dual-tetris/core';

export interface TransactionRecord {
  id: string;
  playerId: string;
  amount: number;
  reason: string;
  referenceId?: string;
  timestamp: number;
}

interface PersistedData {
  profiles: Record<string, PlayerProfileData>;
  chestRewards: Record<string, ChestRewardResult>;
  transactions: TransactionRecord[];
}

export class ProfileStore {
  private data: PersistedData = {
    profiles: {},
    chestRewards: {},
    transactions: [],
  };
  private filePath: string | null;
  private config: GameConfig;

  constructor(config: GameConfig = DEFAULT_CONFIG, filePath: string | null = null) {
    this.config = config;
    this.filePath = filePath;
    if (this.filePath && fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<PersistedData>;
        this.data = {
          profiles: parsed.profiles ?? {},
          chestRewards: parsed.chestRewards ?? {},
          transactions: parsed.transactions ?? [],
        };
      } catch {
        // Если файл повреждён, начинаем с чистого состояния
      }
    }
  }

  private save(): void {
    if (!this.filePath) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmpPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
    } catch {
      // Игнорируем ошибки записи на read-only ФС
    }
  }

  public getOrCreateProfile(
    playerId?: string,
    name?: string,
    avatar?: string
  ): PlayerProfileData {
    const cleanId =
      playerId && playerId.trim().length >= 4
        ? playerId.trim().slice(0, 64)
        : `p_${crypto.randomBytes(8).toString('hex')}`;

    let profile = this.data.profiles[cleanId];
    if (!profile) {
      const initialOwned: PlayerProfileData['ownedAbilities'] = {};
      for (const abId of this.config.defaultLoadout) {
        if (abId && this.config.abilities[abId]) {
          initialOwned[abId] = {
            abilityId: abId,
            level: 1,
            copies: 1,
          };
        }
      }
      profile = {
        playerId: cleanId,
        name: (name?.trim() || 'Игрок').slice(0, 24),
        avatar: (avatar?.trim() || '👾').slice(0, 16),
        coins: this.config.economy.startingCoins,
        ownedAbilities: initialOwned,
        loadout: [...this.config.defaultLoadout],
        stats: {
          wins: 0,
          losses: 0,
          draws: 0,
          matches: 0,
        },
      };
      this.data.profiles[cleanId] = profile;
      this.recordTransaction(cleanId, this.config.economy.startingCoins, 'initial_grant');
      this.save();
    } else {
      let changed = false;
      if (name && name.trim() && name.trim() !== profile.name) {
        profile.name = name.trim().slice(0, 24);
        changed = true;
      }
      if (avatar && avatar.trim() && avatar.trim() !== profile.avatar) {
        profile.avatar = avatar.trim().slice(0, 16);
        changed = true;
      }
      if (changed) this.save();
    }

    return this.cloneProfile(profile);
  }

  public equipLoadout(
    playerId: string,
    loadout: [string | null, string | null, string | null, string | null]
  ): { ok: true; profile: PlayerProfileData } | { ok: false; errorCode: string } {
    const profile = this.data.profiles[playerId];
    if (!profile) {
      return { ok: false, errorCode: 'PROFILE_NOT_FOUND' };
    }

    // Проверяем, что все выбранные способности принадлежат игроку
    for (const abId of loadout) {
      if (abId !== null) {
        if (!this.config.abilities[abId] || !profile.ownedAbilities[abId]) {
          return { ok: false, errorCode: 'ABILITY_NOT_OWNED' };
        }
      }
    }

    profile.loadout = [...loadout];
    this.save();
    return { ok: true, profile: this.cloneProfile(profile) };
  }

  public getMatchAbilitySlots(playerId?: string): AbilitySlots {
    const profile = playerId ? this.data.profiles[playerId] : undefined;
    const loadout = profile ? profile.loadout : this.config.defaultLoadout;
    return [0, 1, 2, 3].map((i) => {
      const abId = loadout[i] ?? null;
      const owned = abId && profile ? profile.ownedAbilities[abId] : undefined;
      return {
        abilityId: abId,
        level: owned?.level ?? 1,
      };
    }) as AbilitySlots;
  }

  public openChest(
    playerId: string,
    chestId: ChestTier,
    requestId: string
  ):
    | { ok: true; reward: ChestRewardResult; profile: PlayerProfileData }
    | { ok: false; errorCode: string } {
    const profile = this.data.profiles[playerId];
    if (!profile) {
      return { ok: false, errorCode: 'PROFILE_NOT_FOUND' };
    }

    // Защита от повторного открытия по тому же requestId (п. 2.3 ТЗ)
    const existingReward = this.data.chestRewards[requestId];
    if (existingReward) {
      return {
        ok: true,
        reward: { ...existingReward },
        profile: this.cloneProfile(profile),
      };
    }

    const chest = this.config.economy.chests[chestId];
    if (!chest) {
      return { ok: false, errorCode: 'CHEST_NOT_FOUND' };
    }

    if (profile.coins < chest.price) {
      return { ok: false, errorCode: 'NOT_ENOUGH_COINS' };
    }

    // 1. Списываем монеты
    profile.coins -= chest.price;
    this.recordTransaction(playerId, -chest.price, `open_chest:${chestId}`, requestId);

    // 2. Выбираем редкость по весам сундука
    const rarity = this.rollRarity(chest.weights);
    const pool = Object.values(this.config.abilities).filter((a) => a.rarity === rarity);
    const fallbackPool = pool.length > 0 ? pool : Object.values(this.config.abilities);
    const picked = fallbackPool[Math.floor(Math.random() * fallbackPool.length)];

    // 3. Добавляем в инвентарь или повышаем уровень
    const maxLevel = this.config.economy.maxAbilityLevel;
    const existingOwned = profile.ownedAbilities[picked.id];
    let isNew = false;
    let refundCoins = 0;

    if (!existingOwned) {
      isNew = true;
      profile.ownedAbilities[picked.id] = {
        abilityId: picked.id,
        level: 1,
        copies: 1,
      };
    } else {
      existingOwned.copies += 1;
      if (existingOwned.level < maxLevel) {
        existingOwned.level += 1;
      } else {
        refundCoins = Math.round(chest.price * this.config.economy.maxLevelDuplicateRefundRatio);
        profile.coins += refundCoins;
        this.recordTransaction(playerId, refundCoins, 'duplicate_max_level_refund', requestId);
      }
    }

    const ownedNow = profile.ownedAbilities[picked.id];
    const reward: ChestRewardResult = {
      requestId,
      chestId,
      abilityId: picked.id,
      rarity: picked.rarity,
      isNew,
      newLevel: ownedNow.level,
      copies: ownedNow.copies,
      refundCoins,
      coinsRemaining: profile.coins,
    };

    this.data.chestRewards[requestId] = reward;
    this.save();

    return {
      ok: true,
      reward: { ...reward },
      profile: this.cloneProfile(profile),
    };
  }

  public recordMatchResult(
    playerIds: [string | undefined, string | undefined],
    winner: 0 | 1 | null,
    isBotMatch: boolean
  ): [number, number] {
    const earned: [number, number] = [0, 0];
    const { pvpWinCoins, botWinCoins, participationCoins } = this.config.economy;

    for (const idx of [0, 1] as const) {
      const pid = playerIds[idx];
      if (!pid || !this.data.profiles[pid]) continue;
      const profile = this.data.profiles[pid];
      profile.stats.matches += 1;

      let reward = participationCoins;
      if (winner === null) {
        profile.stats.draws += 1;
      } else if (winner === idx) {
        profile.stats.wins += 1;
        reward = isBotMatch ? botWinCoins : pvpWinCoins;
      } else {
        profile.stats.losses += 1;
      }

      profile.coins += reward;
      earned[idx] = reward;
      this.recordTransaction(pid, reward, winner === idx ? 'match_win' : 'match_participation');
    }

    this.save();
    return earned;
  }

  private rollRarity(weights: Record<AbilityRarity, number>): AbilityRarity {
    const entries: Array<[AbilityRarity, number]> = [
      ['common', weights.common ?? 0],
      ['rare', weights.rare ?? 0],
      ['epic', weights.epic ?? 0],
      ['legendary', weights.legendary ?? 0],
    ];
    const total = entries.reduce((acc, [, w]) => acc + w, 0);
    let r = Math.random() * total;
    for (const [rarity, w] of entries) {
      if (r < w) return rarity;
      r -= w;
    }
    return 'common';
  }

  private recordTransaction(
    playerId: string,
    amount: number,
    reason: string,
    referenceId?: string
  ): void {
    this.data.transactions.push({
      id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      playerId,
      amount,
      reason,
      referenceId,
      timestamp: Date.now(),
    });
    if (this.data.transactions.length > 2000) {
      this.data.transactions.splice(0, 500);
    }
  }

  private cloneProfile(p: PlayerProfileData): PlayerProfileData {
    return {
      playerId: p.playerId,
      name: p.name,
      avatar: p.avatar,
      coins: p.coins,
      ownedAbilities: Object.fromEntries(
        Object.entries(p.ownedAbilities).map(([k, v]) => [k, { ...v }])
      ),
      loadout: [...p.loadout],
      stats: { ...p.stats },
    };
  }
}
