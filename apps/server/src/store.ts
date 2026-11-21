import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  DEFAULT_CONFIG,
  calculateEloDelta,
  getLeagueByRating,
  type AbilityRarity,
  type AbilitySlots,
  type BlockSkinId,
  type BotDifficulty,
  type ChestRewardResult,
  type ChestTier,
  type DailyQuestProgress,
  type GameConfig,
  type LeaderboardEntry,
  type PlayerDailyState,
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
  processedRequests: Record<string, boolean>;
  transactions: TransactionRecord[];
}

export function createDefaultDailyQuests(): DailyQuestProgress[] {
  return [
    {
      id: 'play_3_matches',
      title: 'Сыграй 3 матча в любом режиме',
      target: 3,
      progress: 0,
      rewardCoins: 50,
      rewardXp: 30,
      claimed: false,
    },
    {
      id: 'use_5_abilities',
      title: 'Используй способности 5 раз',
      target: 5,
      progress: 0,
      rewardCoins: 75,
      rewardXp: 40,
      claimed: false,
    },
    {
      id: 'win_2_matches',
      title: 'Одержи 2 победы (PvP или Бот)',
      target: 2,
      progress: 0,
      rewardCoins: 100,
      rewardXp: 60,
      claimed: false,
    },
  ];
}

export class ProfileStore {
  private data: PersistedData = {
    profiles: {},
    chestRewards: {},
    processedRequests: {},
    transactions: [],
  };
  private filePath: string | null;
  private config: GameConfig;
  private customDateProvider?: () => string;

  constructor(
    config: GameConfig = DEFAULT_CONFIG,
    filePath: string | null = null,
    customDateProvider?: () => string
  ) {
    this.config = config;
    this.filePath = filePath;
    this.customDateProvider = customDateProvider;
    if (this.filePath && fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<PersistedData>;
        this.data = {
          profiles: parsed.profiles ?? {},
          chestRewards: parsed.chestRewards ?? {},
          processedRequests: parsed.processedRequests ?? {},
          transactions: parsed.transactions ?? [],
        };
      } catch {
        // Игнорируем ошибку чтения повреждённого файла
      }
    }
  }

  public getTodayUtc(): string {
    if (this.customDateProvider) return this.customDateProvider();
    return new Date().toISOString().slice(0, 10);
  }

  private createFreshDailyState(dateUtc: string): PlayerDailyState {
    return {
      dateUtc,
      bossAttemptsRemaining: this.config.economy.dailyBossFreeAttempts,
      adAttemptsUsedToday: 0,
      bossFirstWinClaimedToday: false,
      quests: createDefaultDailyQuests(),
    };
  }

  private ensureProfileFields(profile: PlayerProfileData): boolean {
    let changed = false;
    const today = this.getTodayUtc();
    if (!profile.daily || profile.daily.dateUtc !== today) {
      profile.daily = this.createFreshDailyState(today);
      changed = true;
    }
    if (profile.xp === undefined) {
      profile.xp = 0;
      profile.level = 1;
      changed = true;
    }
    if (profile.rating === undefined) {
      profile.rating = this.config.economy.startingRating;
      changed = true;
    }
    const expectedLeague = getLeagueByRating(profile.rating, this.config).id;
    if (profile.league !== expectedLeague) {
      profile.league = expectedLeague;
      changed = true;
    }
    if (!profile.matchHistory) {
      profile.matchHistory = [];
      changed = true;
    }
    if (profile.stats.currentStreak === undefined) {
      profile.stats.currentStreak = 0;
      profile.stats.bestStreak = 0;
      changed = true;
    }
    if (!profile.stats.abilityUsage) {
      profile.stats.abilityUsage = {};
      changed = true;
    }
    if (!profile.ownedSkins || profile.ownedSkins.length === 0) {
      profile.ownedSkins = ['classic'];
      changed = true;
    }
    if (!profile.equippedSkin) {
      profile.equippedSkin = 'classic';
      changed = true;
    }
    return changed;
  }

  private addXp(profile: PlayerProfileData, amount: number): void {
    profile.xp = (profile.xp ?? 0) + amount;
    profile.level = 1 + Math.floor(profile.xp / 100);
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
      // Игнорируем ошибки записи
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
      const startRating = this.config.economy.startingRating;
      profile = {
        playerId: cleanId,
        name: (name?.trim() || 'Игрок').slice(0, 24),
        avatar: (avatar?.trim() || '👾').slice(0, 16),
        coins: this.config.economy.startingCoins,
        xp: 0,
        level: 1,
        rating: startRating,
        league: getLeagueByRating(startRating, this.config).id,
        ownedAbilities: initialOwned,
        loadout: [...this.config.defaultLoadout],
        ownedSkins: ['classic'],
        equippedSkin: 'classic',
        stats: {
          wins: 0,
          losses: 0,
          draws: 0,
          matches: 0,
          currentStreak: 0,
          bestStreak: 0,
          abilityUsage: {},
        },
        daily: this.createFreshDailyState(this.getTodayUtc()),
        matchHistory: [],
      };
      this.data.profiles[cleanId] = profile;
      this.recordTransaction(cleanId, this.config.economy.startingCoins, 'initial_grant');
      this.save();
    } else {
      let changed = this.ensureProfileFields(profile);
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
    this.ensureProfileFields(profile);

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

  public canAffordBet(playerId: string | undefined, bet: number): boolean {
    if (bet <= 0) return true;
    if (!playerId) return false;
    const profile = this.data.profiles[playerId];
    return Boolean(profile && profile.coins >= bet);
  }

  public reserveBet(playerId: string | undefined, bet: number, roomCode: string): boolean {
    if (bet <= 0) return true;
    if (!playerId) return false;
    const profile = this.data.profiles[playerId];
    if (!profile || profile.coins < bet) return false;
    profile.coins -= bet;
    this.recordTransaction(playerId, -bet, 'coin_duel_stake', roomCode);
    this.save();
    return true;
  }

  public refundBet(playerId: string | undefined, bet: number, roomCode: string): void {
    if (bet <= 0 || !playerId) return;
    const profile = this.data.profiles[playerId];
    if (!profile) return;
    profile.coins += bet;
    this.recordTransaction(playerId, bet, 'coin_duel_refund', roomCode);
    this.save();
  }

  public buyOrEquipSkin(
    playerId: string,
    skinId: BlockSkinId,
    requestId: string
  ): { ok: true; profile: PlayerProfileData } | { ok: false; errorCode: string } {
    const profile = this.data.profiles[playerId];
    if (!profile) {
      return { ok: false, errorCode: 'PROFILE_NOT_FOUND' };
    }
    this.ensureProfileFields(profile);

    const skinDef = this.config.economy.skins[skinId];
    if (!skinDef) {
      return { ok: false, errorCode: 'SKIN_NOT_FOUND' };
    }

    // Если скин уже куплен — просто надеваем его
    if (profile.ownedSkins.includes(skinId)) {
      profile.equippedSkin = skinId;
      this.save();
      return { ok: true, profile: this.cloneProfile(profile) };
    }

    const reqKey = `skin:${playerId}:${requestId}`;
    if (this.data.processedRequests[reqKey]) {
      return { ok: true, profile: this.cloneProfile(profile) };
    }

    if (profile.coins < skinDef.price) {
      return { ok: false, errorCode: 'NOT_ENOUGH_COINS' };
    }

    this.data.processedRequests[reqKey] = true;
    profile.coins -= skinDef.price;
    profile.ownedSkins.push(skinId);
    profile.equippedSkin = skinId;
    this.recordTransaction(playerId, -skinDef.price, `buy_skin:${skinId}`, requestId);
    this.save();

    return { ok: true, profile: this.cloneProfile(profile) };
  }

  public getLeaderboard(limit = 15): LeaderboardEntry[] {
    const all = Object.values(this.data.profiles);
    for (const p of all) {
      this.ensureProfileFields(p);
    }
    all.sort((a, b) => (b.rating ?? 500) - (a.rating ?? 500) || b.stats.wins - a.stats.wins);
    return all.slice(0, limit).map((p, idx) => ({
      rank: idx + 1,
      playerId: p.playerId,
      name: p.name,
      avatar: p.avatar,
      rating: p.rating ?? 500,
      league: p.league,
      wins: p.stats.wins,
      matches: p.stats.matches,
    }));
  }

  public consumeBossAttempt(
    playerId: string
  ): { ok: true; profile: PlayerProfileData } | { ok: false; errorCode: string } {
    const profile = this.data.profiles[playerId];
    if (!profile) {
      return { ok: false, errorCode: 'PROFILE_NOT_FOUND' };
    }
    this.ensureProfileFields(profile);

    if (profile.daily.bossAttemptsRemaining <= 0) {
      return { ok: false, errorCode: 'NO_BOSS_ATTEMPTS' };
    }

    profile.daily.bossAttemptsRemaining -= 1;
    this.save();
    return { ok: true, profile: this.cloneProfile(profile) };
  }

  public watchRewardedAd(
    playerId: string,
    requestId: string
  ): { ok: true; profile: PlayerProfileData } | { ok: false; errorCode: string } {
    const profile = this.data.profiles[playerId];
    if (!profile) {
      return { ok: false, errorCode: 'PROFILE_NOT_FOUND' };
    }
    this.ensureProfileFields(profile);

    const reqKey = `ad:${playerId}:${requestId}`;
    if (this.data.processedRequests[reqKey]) {
      return { ok: true, profile: this.cloneProfile(profile) };
    }

    if (profile.daily.adAttemptsUsedToday >= this.config.economy.dailyBossMaxAdAttempts) {
      return { ok: false, errorCode: 'AD_LIMIT_REACHED' };
    }

    this.data.processedRequests[reqKey] = true;
    profile.daily.adAttemptsUsedToday += 1;
    profile.daily.bossAttemptsRemaining += 1;
    this.save();
    return { ok: true, profile: this.cloneProfile(profile) };
  }

  public recordAbilityUsed(playerId?: string, abilityId?: string): void {
    if (!playerId) return;
    const profile = this.data.profiles[playerId];
    if (!profile) return;
    this.ensureProfileFields(profile);

    if (abilityId) {
      profile.stats.abilityUsage[abilityId] = (profile.stats.abilityUsage[abilityId] ?? 0) + 1;
    }

    const quest = profile.daily.quests.find((q) => q.id === 'use_5_abilities');
    if (quest && quest.progress < quest.target) {
      quest.progress = Math.min(quest.target, quest.progress + 1);
    }
    this.save();
  }

  public claimDailyQuest(
    playerId: string,
    questId: string,
    requestId: string
  ): { ok: true; profile: PlayerProfileData } | { ok: false; errorCode: string } {
    const profile = this.data.profiles[playerId];
    if (!profile) {
      return { ok: false, errorCode: 'PROFILE_NOT_FOUND' };
    }
    this.ensureProfileFields(profile);

    const reqKey = `quest:${playerId}:${requestId}`;
    if (this.data.processedRequests[reqKey]) {
      return { ok: true, profile: this.cloneProfile(profile) };
    }

    const quest = profile.daily.quests.find((q) => q.id === questId);
    if (!quest) {
      return { ok: false, errorCode: 'QUEST_NOT_FOUND' };
    }
    if (quest.claimed) {
      return { ok: false, errorCode: 'QUEST_ALREADY_CLAIMED' };
    }
    if (quest.progress < quest.target) {
      return { ok: false, errorCode: 'QUEST_NOT_COMPLETED' };
    }

    quest.claimed = true;
    this.data.processedRequests[reqKey] = true;
    profile.coins += quest.rewardCoins;
    this.addXp(profile, quest.rewardXp);
    this.recordTransaction(playerId, quest.rewardCoins, `daily_quest:${questId}`, requestId);
    this.save();

    return { ok: true, profile: this.cloneProfile(profile) };
  }

  public openChest(
    playerId: string,
    chestId: ChestTier,
    requestId: string,
    isFreeBonus = false
  ):
    | { ok: true; reward: ChestRewardResult; profile: PlayerProfileData }
    | { ok: false; errorCode: string } {
    const profile = this.data.profiles[playerId];
    if (!profile) {
      return { ok: false, errorCode: 'PROFILE_NOT_FOUND' };
    }
    this.ensureProfileFields(profile);

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

    if (!isFreeBonus) {
      if (profile.coins < chest.price) {
        return { ok: false, errorCode: 'NOT_ENOUGH_COINS' };
      }
      profile.coins -= chest.price;
      this.recordTransaction(playerId, -chest.price, `open_chest:${chestId}`, requestId);
    }

    const rarity = this.rollRarity(chest.weights);
    const pool = Object.values(this.config.abilities).filter((a) => a.rarity === rarity);
    const fallbackPool = pool.length > 0 ? pool : Object.values(this.config.abilities);
    const picked = fallbackPool[Math.floor(Math.random() * fallbackPool.length)];

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
    isBotMatch: boolean,
    botDifficulty: BotDifficulty = 'medium',
    extra?: {
      playerNames?: [string, string];
      finalHps?: [number, number];
      bet?: number;
      betReserved?: [boolean, boolean];
      isRanked?: boolean;
      botRating?: number;
    }
  ): {
    coinsEarned: [number, number];
    xpEarned: [number, number];
    ratingDelta: [number, number];
    newRating: [number, number];
    betPot: number;
    bonusChestReward?: ChestRewardResult;
  } {
    const coinsEarned: [number, number] = [0, 0];
    const xpEarned: [number, number] = [0, 0];
    const ratingDelta: [number, number] = [0, 0];
    const newRating: [number, number] = [
      this.config.economy.startingRating,
      this.config.economy.startingRating,
    ];
    let bonusChestReward: ChestRewardResult | undefined;

    const bet = extra?.bet ?? 0;
    const betReserved = extra?.betReserved ?? [false, false];
    const betPot = bet > 0 ? bet * 2 : 0;
    const isRanked = Boolean(extra?.isRanked) || !isBotMatch;

    const { pvpWinCoins, botWinCoins, participationCoins, bossFirstWinChest, eloKFactor } =
      this.config.economy;
    const diffProfile = this.config.bot.difficulties?.[botDifficulty];

    const p0Prof = playerIds[0] ? this.data.profiles[playerIds[0]] : undefined;
    const p1Prof = playerIds[1] ? this.data.profiles[playerIds[1]] : undefined;
    const r0 = p0Prof?.rating ?? this.config.economy.startingRating;
    const r1 =
      p1Prof?.rating ??
      extra?.botRating ??
      (isBotMatch
        ? botDifficulty === 'boss'
          ? 1800
          : botDifficulty === 'hard'
            ? 1400
            : botDifficulty === 'medium'
              ? 1000
              : 600
        : r0);

    const ratingsBefore: [number, number] = [r0, r1];

    for (const idx of [0, 1] as const) {
      const pid = playerIds[idx];
      if (!pid || !this.data.profiles[pid]) continue;
      const profile = this.data.profiles[pid];
      this.ensureProfileFields(profile);
      profile.stats.matches += 1;

      const qPlay = profile.daily.quests.find((q) => q.id === 'play_3_matches');
      if (qPlay && qPlay.progress < qPlay.target) {
        qPlay.progress = Math.min(qPlay.target, qPlay.progress + 1);
      }

      const oppIdx: 0 | 1 = idx === 0 ? 1 : 0;
      const score: 1 | 0.5 | 0 = winner === null ? 0.5 : winner === idx ? 1 : 0;

      // Расчёт рейтинга Elo
      let rDelta = 0;
      if (isRanked) {
        rDelta = calculateEloDelta(ratingsBefore[idx], ratingsBefore[oppIdx], score, eloKFactor);
      } else if (winner === idx) {
        // В одиночной тренировке с ботом даём небольшой бонус рейтинга за победу
        rDelta =
          botDifficulty === 'boss'
            ? 18
            : botDifficulty === 'hard'
              ? 12
              : botDifficulty === 'medium'
                ? 8
                : 5;
      }

      const updatedRating = Math.max(0, profile.rating + rDelta);
      ratingDelta[idx] = updatedRating - profile.rating;
      profile.rating = updatedRating;
      profile.league = getLeagueByRating(profile.rating, this.config).id;
      newRating[idx] = profile.rating;

      let rewardCoins = 0;
      let rewardXp = 10;

      if (winner === null) {
        profile.stats.draws += 1;
        profile.stats.currentStreak = 0;
        if (bet > 0 && betReserved[idx]) {
          // При ничьей в Coin Duel возвращаем ставку
          rewardCoins = bet;
        } else {
          rewardCoins = participationCoins;
        }
      } else if (winner === idx) {
        profile.stats.wins += 1;
        profile.stats.currentStreak += 1;
        if (profile.stats.currentStreak > profile.stats.bestStreak) {
          profile.stats.bestStreak = profile.stats.currentStreak;
        }

        if (bet > 0 && betReserved[idx]) {
          // Победитель Coin Duel забирает весь банк (2 * bet)
          rewardCoins = bet * 2;
          rewardXp = 45;
        } else if (isBotMatch && !extra?.isRanked) {
          rewardCoins = diffProfile ? diffProfile.winCoins : botWinCoins;
          rewardXp = diffProfile ? diffProfile.xpReward : 25;
        } else {
          rewardCoins = pvpWinCoins;
          rewardXp = 35;
        }

        const qWin = profile.daily.quests.find((q) => q.id === 'win_2_matches');
        if (qWin && qWin.progress < qWin.target) {
          qWin.progress = Math.min(qWin.target, qWin.progress + 1);
        }

        if (
          isBotMatch &&
          botDifficulty === 'boss' &&
          !profile.daily.bossFirstWinClaimedToday
        ) {
          profile.daily.bossFirstWinClaimedToday = true;
          const freeRes = this.openChest(
            pid,
            bossFirstWinChest,
            `boss_first_win_${pid}_${profile.daily.dateUtc}`,
            true
          );
          if (freeRes.ok) {
            bonusChestReward = freeRes.reward;
          }
        }
      } else {
        profile.stats.losses += 1;
        profile.stats.currentStreak = 0;
        rewardCoins = bet > 0 ? 0 : participationCoins;
      }

      if (rewardCoins > 0) {
        profile.coins += rewardCoins;
        this.recordTransaction(
          pid,
          rewardCoins,
          bet > 0 ? `coin_duel_payout:${bet}` : winner === idx ? 'match_win' : 'match_participation'
        );
      }

      this.addXp(profile, rewardXp);
      coinsEarned[idx] = rewardCoins;
      xpEarned[idx] = rewardXp;

      const oppName =
        extra?.playerNames?.[oppIdx] ?? (isBotMatch ? diffProfile?.name ?? 'Бот' : 'Соперник');
      const myHp = Math.max(0, Math.round(extra?.finalHps?.[idx] ?? 0));
      const oppHp = Math.max(0, Math.round(extra?.finalHps?.[oppIdx] ?? 0));
      const netCoins = bet > 0 && betReserved[idx] ? rewardCoins - bet : rewardCoins;

      profile.matchHistory.unshift({
        id: `m_${Date.now()}_${idx}`,
        timestamp: Date.now(),
        opponentName: oppName,
        result: winner === null ? 'draw' : winner === idx ? 'win' : 'loss',
        myHp,
        oppHp,
        ratingDelta: ratingDelta[idx],
        coinsDelta: netCoins,
        bet,
      });
      if (profile.matchHistory.length > 15) {
        profile.matchHistory.length = 15;
      }
    }

    this.save();
    return {
      coinsEarned,
      xpEarned,
      ratingDelta,
      newRating,
      betPot,
      bonusChestReward,
    };
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
      xp: p.xp ?? 0,
      level: p.level ?? 1,
      rating: p.rating ?? this.config.economy.startingRating,
      league: p.league ?? getLeagueByRating(p.rating ?? 500, this.config).id,
      ownedAbilities: Object.fromEntries(
        Object.entries(p.ownedAbilities).map(([k, v]) => [k, { ...v }])
      ),
      loadout: [...p.loadout],
      ownedSkins: [...(p.ownedSkins ?? ['classic'])],
      equippedSkin: p.equippedSkin ?? 'classic',
      stats: {
        ...p.stats,
        abilityUsage: { ...(p.stats.abilityUsage ?? {}) },
      },
      daily: {
        dateUtc: p.daily.dateUtc,
        bossAttemptsRemaining: p.daily.bossAttemptsRemaining,
        adAttemptsUsedToday: p.daily.adAttemptsUsedToday,
        bossFirstWinClaimedToday: p.daily.bossFirstWinClaimedToday,
        quests: p.daily.quests.map((q) => ({ ...q })),
      },
      matchHistory: (p.matchHistory ?? []).map((m) => ({ ...m })),
    };
  }
}
