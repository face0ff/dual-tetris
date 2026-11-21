import {
  DEFAULT_CONFIG,
  PROTOCOL_VERSION,
  fits,
  getGhostY,
  getLeagueByRating,
  getLowestEmptyRow,
  rotateMatrixCW,
  type ActivePiece,
  type BotDifficulty,
  type ChestRewardResult,
  type ChestTier,
  type ClientMessage,
  type GameConfig,
  type GameEvent,
  type InputAction,
  type PieceShape,
  type PlayerProfileData,
  type RoomPlayerInfo,
  type RoomState,
  type ServerMessage,
  type SnapshotMessage,
  type WaveState,
} from '@dual-tetris/core';
import { RU_STRINGS as S } from './i18n.js';
import { sfx } from './sound.js';

const W = 16;
const H = 15;

// Адаптивная геометрия холста (растягивается на всю высоту и ширину экрана телефона)
let CW = 368;
let CH = 812;
let CX = 22; // ширина клетки
let CY = 24; // высота клетки (адаптируется под высоту экрана!)
let BW = W * CX;
let BH = H * CY;
let BX = 8;
let ET = 36;
let FRONT = ET + BH;
let MT = FRONT + 52;

const COL = ['', '#22c55e', '#38bdf8', '#ef4444', '#facc15', '#f8fafc'];
const WC = ['', '34,197,94', '56,189,248', '239,68,68', '250,204,21'];

interface RowFlash {
  r: number;
  t: number;
}
interface MeteorFlash {
  x: number;
  r: number;
  t: number;
}
interface SparkFx {
  y: number;
  t: number;
}
interface LogMsg {
  t: string;
  l: number;
}
interface PendingInput {
  seq: number;
  a: InputAction;
}

// Элементы DOM
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const g2 = canvas.getContext('2d')!;

function updateCanvasLayout(): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const cssW = Math.max(320, Math.round(rect.width || window.innerWidth));
  const cssH = Math.max(580, Math.round(rect.height || window.innerHeight));

  CW = cssW;
  CH = cssH;
  canvas.width = Math.round(CW * dpr);
  canvas.height = Math.round(CH * dpr);
  g2.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Поле занимает почти всю ширину экрана
  CX = Math.max(16, Math.floor((CW - 10) / W));
  BW = W * CX;
  BX = Math.floor((CW - BW) / 2);

  // По высоте два поля занимают весь экран от верхнего бара HP до нижней панели энергии/способностей
  const topHud = 42;
  const bottomHud = 74;
  const minGap = 46;
  const availForBoards = Math.max(340, CH - topHud - bottomHud - minGap);

  CY = Math.max(12, Math.floor(availForBoards / (2 * H)));
  BH = H * CY;
  ET = topHud;
  FRONT = ET + BH;
  const actualGap = Math.max(42, CH - topHud - bottomHud - 2 * BH);
  MT = FRONT + actualGap;
}

window.addEventListener('resize', updateCanvasLayout);
updateCanvasLayout();

const screenHome = document.getElementById('screen-home')!;
const screenLobby = document.getElementById('screen-lobby')!;
const screenResult = document.getElementById('screen-result')!;
const homeError = document.getElementById('home-error')!;

const inputName = document.getElementById('input-name') as HTMLInputElement;
const inputRoomCode = document.getElementById('input-room-code') as HTMLInputElement;
const btnCreateRoom = document.getElementById('btn-create-room') as HTMLButtonElement;
const btnJoinRoom = document.getElementById('btn-join-room') as HTMLButtonElement;
const btnBotMatch = document.getElementById('btn-bot-match') as HTMLButtonElement;

const lobbyCodeEl = document.getElementById('lobby-code')!;
const lobbyLinkEl = document.getElementById('lobby-link')!;
const lobbyPlayersEl = document.getElementById('lobby-players')!;
const lobbyCountdownEl = document.getElementById('lobby-countdown')!;
const btnCopyLink = document.getElementById('btn-copy-link') as HTMLButtonElement;
const btnShareLink = document.getElementById('btn-share-link') as HTMLButtonElement;
const btnReady = document.getElementById('btn-ready') as HTMLButtonElement;
const btnLeaveLobby = document.getElementById('btn-leave-lobby') as HTMLButtonElement;

const resultTitleEl = document.getElementById('result-title')!;
const resultSubtitleEl = document.getElementById('result-subtitle')!;
const resultCoinsEarnedEl = document.getElementById('result-coins-earned')!;
const resultRematchStatusEl = document.getElementById('result-rematch-status')!;
const btnRematch = document.getElementById('btn-rematch') as HTMLButtonElement;
const btnResultMenu = document.getElementById('btn-result-menu') as HTMLButtonElement;

const btnAvatar = document.getElementById('btn-avatar') as HTMLButtonElement;
const profileStatsText = document.getElementById('profile-stats-text')!;
const profileCoinsEl = document.getElementById('profile-coins')!;
const btnOpenInventory = document.getElementById('btn-open-inventory') as HTMLButtonElement;
const btnOpenChests = document.getElementById('btn-open-chests') as HTMLButtonElement;

const screenInventory = document.getElementById('screen-inventory')!;
const btnCloseInventory = document.getElementById('btn-close-inventory') as HTMLButtonElement;
const inventoryLoadoutSlotsEl = document.getElementById('inventory-loadout-slots')!;
const inventoryCountEl = document.getElementById('inventory-count')!;
const inventoryListEl = document.getElementById('inventory-list')!;

const screenChests = document.getElementById('screen-chests')!;
const btnCloseChests = document.getElementById('btn-close-chests') as HTMLButtonElement;
const chestsCoinsEl = document.getElementById('chests-coins')!;
const chestRewardBoxEl = document.getElementById('chest-reward-box')!;

const screenBots = document.getElementById('screen-bots')!;
const btnCloseBots = document.getElementById('btn-close-bots') as HTMLButtonElement;
const botsErrorEl = document.getElementById('bots-error')!;
const bossAttemptsLabelEl = document.getElementById('boss-attempts-label')!;
const adStatusTextEl = document.getElementById('ad-status-text')!;
const btnWatchAd = document.getElementById('btn-watch-ad') as HTMLButtonElement;

const btnOpenQuests = document.getElementById('btn-open-quests') as HTMLButtonElement;
const screenQuests = document.getElementById('screen-quests')!;
const btnCloseQuests = document.getElementById('btn-close-quests') as HTMLButtonElement;
const questsDateLabelEl = document.getElementById('quests-date-label')!;
const questsListEl = document.getElementById('quests-list')!;

const btnOpenMatchmaking = document.getElementById('btn-open-matchmaking') as HTMLButtonElement;
const screenMatchmaking = document.getElementById('screen-matchmaking')!;
const btnCloseMatchmaking = document.getElementById('btn-close-matchmaking') as HTMLButtonElement;
const mmLeagueBannerEl = document.getElementById('mm-league-banner')!;
const mmStatusBoxEl = document.getElementById('mm-status-box')!;
const btnStartMm = document.getElementById('btn-start-mm') as HTMLButtonElement;
const btnCancelMm = document.getElementById('btn-cancel-mm') as HTMLButtonElement;

const btnOpenStats = document.getElementById('btn-open-stats') as HTMLButtonElement;
const screenStats = document.getElementById('screen-stats')!;
const btnCloseStats = document.getElementById('btn-close-stats') as HTMLButtonElement;
const statsSummaryBoxEl = document.getElementById('stats-summary-box')!;
const statsLeaguesListEl = document.getElementById('stats-leagues-list')!;
const statsAbilitiesBoxEl = document.getElementById('stats-abilities-box')!;
const statsHistoryListEl = document.getElementById('stats-history-list')!;

const pingBadge = document.getElementById('ping-badge')!;
const btnSound = document.getElementById('btn-sound') as HTMLButtonElement;
const btnLeaveMatch = document.getElementById('btn-leave-match') as HTMLButtonElement;

// Состояние клиента
let ws: WebSocket | null = null;
let config: GameConfig = DEFAULT_CONFIG;
let youIndex: 0 | 1 = 0;
let roomCode = '';
let roomBet = 0;
let selectedMmBet = 0;
let mmSearching = false;
let roomState: RoomState | 'home' = 'home';
let roomPlayers: RoomPlayerInfo[] = [];
let lanIp: string | null = null;

// Игровое состояние для отрисовки и клиентского предсказания
let latestSnapshot: SnapshotMessage | null = null;
let predictedCur: ActivePiece | null = null;
let pendingInputs: PendingInput[] = [];
let nextInputSeq = 1;
let renderedWaves: WaveState[] = [];
let paused = false;
let pauseRemainingSec = 0;

// Визуальные эффекты
let flashTimer: [number, number] = [0, 0];
let energyPulse: [number, number, number, number] = [0, 0, 0, 0];
let rowFlashes: [RowFlash[], RowFlash[]] = [[], []];
let meteorFlashes: [MeteorFlash[], MeteorFlash[]] = [[], []];
let sparks: SparkFx[] = [];
let msgs: LogMsg[] = [];

// Загрузка сохранённого профиля, имени и звука
const AVATARS = ['👾', '🔥', '⚡', '👑', '🐉', '🦊', '🤖', '💎'];
let myPlayerId = localStorage.getItem('dual_tetris_player_id') ?? '';
if (!myPlayerId) {
  myPlayerId = `p_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  localStorage.setItem('dual_tetris_player_id', myPlayerId);
}
let myAvatar = localStorage.getItem('dual_tetris_avatar') ?? '👾';
let myProfile: PlayerProfileData | null = null;
let selectedLoadoutSlotIdx = 0;

btnAvatar.textContent = myAvatar;
inputName.value = localStorage.getItem('dual_tetris_name') ?? '';
btnSound.textContent = sfx.enabled ? '🔊' : '🔇';

btnAvatar.addEventListener('click', () => {
  const nextIdx = (AVATARS.indexOf(myAvatar) + 1) % AVATARS.length;
  myAvatar = AVATARS[nextIdx];
  localStorage.setItem('dual_tetris_avatar', myAvatar);
  btnAvatar.textContent = myAvatar;
  sendMsg({
    type: 'auth_profile',
    playerId: myPlayerId,
    name: savePlayerName(),
    avatar: myAvatar,
  });
});

inputName.addEventListener('change', () => {
  sendMsg({
    type: 'auth_profile',
    playerId: myPlayerId,
    name: savePlayerName(),
    avatar: myAvatar,
  });
});

btnSound.addEventListener('click', () => {
  const on = sfx.toggle();
  btnSound.textContent = on ? '🔊' : '🔇';
});

// Определяем LAN IP сервера, чтобы ссылка работала с телефона в домашнем Wi-Fi
fetch('/api/network-info')
  .then((r) => r.json())
  .then((data: { lanIps?: string[] }) => {
    if (data.lanIps && data.lanIps.length > 0) {
      lanIp = data.lanIps[0];
    }
  })
  .catch(() => {});

function getShareableRoomUrl(code: string): string {
  const loc = window.location;
  let host = loc.host;
  if ((loc.hostname === 'localhost' || loc.hostname === '127.0.0.1') && lanIp) {
    host = `${lanIp}:${loc.port || '80'}`;
  }
  return `${loc.protocol}//${host}/r/${code}`;
}

function showError(text: string): void {
  homeError.textContent = text;
  homeError.classList.remove('hidden');
  setTimeout(() => {
    homeError.classList.add('hidden');
  }, 4500);
}

function addMsg(t: string): void {
  msgs.unshift({ t, l: 4.0 });
  if (msgs.length > 3) msgs.length = 3;
}

function savePlayerName(): string {
  const val = inputName.value.trim() || 'Игрок';
  localStorage.setItem('dual_tetris_name', val);
  return val;
}

function getSessionToken(code: string): string | undefined {
  return sessionStorage.getItem(`dual_tetris_token_${code}`) ?? undefined;
}

function setSessionToken(code: string, token: string): void {
  sessionStorage.setItem(`dual_tetris_token_${code}`, token);
  sessionStorage.setItem('dual_tetris_active_room', code);
}

function clearActiveRoom(): void {
  sessionStorage.removeItem('dual_tetris_active_room');
}

function sendMsg(msg: ClientMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function renderProfileUI(): void {
  if (!myProfile) return;
  const totalAbilities = Object.keys(config.abilities).length;
  const ownedCount = Object.keys(myProfile.ownedAbilities).length;
  const leagueDef = getLeagueByRating(myProfile.rating ?? 500, config);
  btnAvatar.textContent = myProfile.avatar || myAvatar;
  profileCoinsEl.textContent = `🪙 ${myProfile.coins}`;
  chestsCoinsEl.textContent = `🪙 ${myProfile.coins}`;
  profileStatsText.textContent = `${leagueDef.icon} ${myProfile.rating ?? 500} 🏆 • Ур.${myProfile.level ?? 1} • ${myProfile.stats.wins}/${myProfile.stats.matches} побед`;
  btnOpenInventory.textContent = `🎒 Колода (${ownedCount}/${totalAbilities})`;
  inventoryCountEl.textContent = `${ownedCount}/${totalAbilities}`;

  // Баннер лиги в окне рейтингового поиска (Фаза 4)
  mmLeagueBannerEl.innerHTML = `
    <div style="font-size:15px;font-weight:900">${leagueDef.icon} Лига: ${leagueDef.name} (${myProfile.rating ?? 500} 🏆)</div>
    <div style="font-size:11.5px;color:#cbd5e1;margin-top:2px">Твой баланс: <b style="color:#fde047">${myProfile.coins} 🪙</b></div>
  `;

  // Заполнение окна Статистики и Лиг (Фаза 4)
  const winrate =
    myProfile.stats.matches > 0
      ? Math.round((myProfile.stats.wins / myProfile.stats.matches) * 100)
      : 0;
  statsSummaryBoxEl.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
      <div>🏆 Рейтинг: <b>${leagueDef.icon} ${myProfile.rating ?? 500}</b> (${leagueDef.name})</div>
      <div>📈 Winrate: <b>${winrate}%</b> (${myProfile.stats.wins}В / ${myProfile.stats.losses}П)</div>
      <div>🔥 Серия побед: <b>${myProfile.stats.currentStreak ?? 0}</b></div>
      <div>👑 Рекорд серии: <b>${myProfile.stats.bestStreak ?? 0}</b></div>
    </div>
  `;

  statsLeaguesListEl.innerHTML = '';
  for (const lg of Object.values(config.economy.leagues)) {
    const isCur = lg.id === leagueDef.id;
    const chip = document.createElement('div');
    chip.className = `slot-chip${isCur ? ' active-slot' : ''}`;
    chip.innerHTML = `<div>${lg.icon} ${lg.name}</div><div style="font-size:9.5px;color:#94a3b8">${lg.minRating}+</div>`;
    statsLeaguesListEl.append(chip);
  }

  const usageEntries = Object.entries(myProfile.stats.abilityUsage ?? {}).sort(
    (a, b) => b[1] - a[1]
  );
  if (usageEntries.length === 0) {
    statsAbilitiesBoxEl.textContent = 'Пока не использовано ни одной способности в матчах.';
  } else {
    statsAbilitiesBoxEl.innerHTML = usageEntries
      .slice(0, 4)
      .map(([abId, cnt]) => {
        const d = config.abilities[abId];
        return `<span class="badge badge-wait" style="margin-right:4px">${d ? d.name : abId}: ${cnt}×</span>`;
      })
      .join(' ');
  }

  statsHistoryListEl.innerHTML = '';
  const hist = myProfile.matchHistory ?? [];
  if (hist.length === 0) {
    statsHistoryListEl.innerHTML = `<div style="color:#64748b;font-size:12px">История матчей пока пуста.</div>`;
  } else {
    for (const h of hist) {
      const row = document.createElement('div');
      row.className = 'ability-item';
      const isWin = h.result === 'win';
      const isDraw = h.result === 'draw';
      row.style.borderLeft = `4px solid ${isWin ? '#22c55e' : isDraw ? '#facc15' : '#f43f5e'}`;
      const rSign = h.ratingDelta >= 0 ? `+${h.ratingDelta}` : `${h.ratingDelta}`;
      const cSign = h.coinsDelta >= 0 ? `+${h.coinsDelta}` : `${h.coinsDelta}`;
      row.innerHTML = `
        <div style="flex:1">
          <div style="font-weight:700;font-size:12.5px">
            ${isWin ? '🏆 Победа' : isDraw ? '🤝 Ничья' : '💀 Поражение'} vs ${h.opponentName}
            ${h.bet > 0 ? `<span class="badge badge-ready" style="margin-left:4px">Ставка ${h.bet} 🪙</span>` : ''}
          </div>
          <div style="font-size:11px;color:#94a3b8">Счёт HP: ${h.myHp} : ${h.oppHp}</div>
        </div>
        <div style="text-align:right;font-size:11.5px;font-weight:700">
          <div style="color:${h.ratingDelta >= 0 ? '#4ade80' : '#fda4af'}">${rSign} 🏆</div>
          <div style="color:#fde047">${cSign} 🪙</div>
        </div>
      `;
      statsHistoryListEl.append(row);
    }
  }

  // Обновление попыток на Босса и статуса рекламы (Фаза 3)
  if (myProfile.daily) {
    const rem = myProfile.daily.bossAttemptsRemaining;
    const adUsed = myProfile.daily.adAttemptsUsedToday;
    const maxAd = config.economy.dailyBossMaxAdAttempts;
    bossAttemptsLabelEl.textContent = `Попыток сегодня: ${rem}`;
    adStatusTextEl.textContent = `Доп. попытки за рекламу сегодня: ${maxAd - adUsed} из ${maxAd}`;
    btnWatchAd.disabled = adUsed >= maxAd;

    const claimableCount = myProfile.daily.quests.filter(
      (q) => q.progress >= q.target && !q.claimed
    ).length;
    btnOpenQuests.textContent =
      claimableCount > 0 ? `📋 Задания (${claimableCount}!)` : '📋 Задания дня';
    questsDateLabelEl.textContent = `День UTC: ${myProfile.daily.dateUtc} • Сброс в 00:00 UTC`;

    questsListEl.innerHTML = '';
    for (const q of myProfile.daily.quests) {
      const item = document.createElement('div');
      item.className = 'ability-item';
      const done = q.progress >= q.target;
      item.style.borderLeft = `4px solid ${q.claimed ? '#475569' : done ? '#22c55e' : '#38bdf8'}`;
      const info = document.createElement('div');
      info.style.flex = '1';
      info.innerHTML = `
        <div style="font-weight:700;font-size:13px">${q.title}</div>
        <div style="font-size:11.5px;color:#94a3b8;margin-top:2px">
          Прогресс: <b>${q.progress}/${q.target}</b> • Награда: <span style="color:#fde047">+${q.rewardCoins} 🪙</span> и <span style="color:#38bdf8">+${q.rewardXp} XP</span>
        </div>
      `;
      item.append(info);

      const qBtn = document.createElement('button');
      qBtn.className = q.claimed
        ? 'btn btn-secondary'
        : done
          ? 'btn btn-primary'
          : 'btn btn-secondary';
      qBtn.style.padding = '7px 10px';
      qBtn.style.fontSize = '12px';
      qBtn.disabled = q.claimed || !done;
      qBtn.textContent = q.claimed ? 'Получено ✓' : done ? 'Забрать!' : `${q.progress}/${q.target}`;
      if (done && !q.claimed) {
        qBtn.addEventListener('click', () => {
          sendMsg({
            type: 'claim_daily_quest',
            questId: q.id,
            requestId: `q_${myPlayerId}_${q.id}_${myProfile?.daily.dateUtc}`,
          });
          sfx.lineClear(2);
        });
      }
      item.append(qBtn);
      questsListEl.append(item);
    }
  }

  // Отрисовка 4 слотов колоды в модалке инвентаря
  inventoryLoadoutSlotsEl.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const abId = myProfile.loadout[i];
    const def = abId ? config.abilities[abId] : null;
    const owned = abId ? myProfile.ownedAbilities[abId] : null;
    const chip = document.createElement('div');
    chip.className = `slot-chip${selectedLoadoutSlotIdx === i ? ' active-slot' : ''}`;
    if (def) {
      chip.style.borderColor = selectedLoadoutSlotIdx === i ? '#38bdf8' : COL[def.color];
      chip.innerHTML = `<div style="color:${COL[def.color]}">[${i + 1}] ${def.name}</div><div style="font-size:10px;color:#94a3b8">Ур.${owned?.level ?? 1} • ${def.energyCost} эн.</div>`;
    } else {
      chip.innerHTML = `<div>[${i + 1}] Пусто</div>`;
    }
    chip.addEventListener('click', () => {
      selectedLoadoutSlotIdx = i;
      renderProfileUI();
    });
    inventoryLoadoutSlotsEl.append(chip);
  }

  // Отрисовка списка всех 16 способностей
  inventoryListEl.innerHTML = '';
  const allDefs = Object.values(config.abilities);
  const rarityLabels: Record<string, string> = {
    common: 'Обычная',
    rare: 'Редкая',
    epic: 'Эпическая',
    legendary: 'Легендарная',
  };

  for (const def of allDefs) {
    const owned = myProfile.ownedAbilities[def.id];
    const isEquipped = myProfile.loadout.includes(def.id);
    const item = document.createElement('div');
    item.className = `ability-item${owned ? '' : ' locked'}`;
    item.style.borderLeft = `4px solid ${COL[def.color]}`;

    const infoDiv = document.createElement('div');
    infoDiv.style.flex = '1';
    infoDiv.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <strong style="font-size:13.5px;color:${COL[def.color]}">${def.name}</strong>
        <span class="rarity-tag rarity-${def.rarity}">${rarityLabels[def.rarity] ?? def.rarity}</span>
        ${owned ? `<span style="font-size:11px;color:#fde047;font-weight:700">Ур.${owned.level}</span>` : '<span style="font-size:11px;color:#64748b">🔒 В сундуках</span>'}
        <span style="font-size:11px;color:#94a3b8">⚡ ${def.energyCost}</span>
      </div>
      <div style="font-size:11.5px;color:#cbd5e1;margin-top:3px">${def.description}</div>
    `;

    item.append(infoDiv);

    if (owned) {
      const btn = document.createElement('button');
      btn.className = isEquipped ? 'btn btn-secondary' : 'btn btn-blue';
      btn.style.padding = '7px 10px';
      btn.style.fontSize = '12px';
      btn.textContent = isEquipped ? `Слот ${myProfile.loadout.indexOf(def.id) + 1}` : `В слот ${selectedLoadoutSlotIdx + 1}`;
      btn.addEventListener('click', () => {
        if (!myProfile) return;
        const nextLoadout = [...myProfile.loadout] as [
          string | null,
          string | null,
          string | null,
          string | null,
        ];
        // Если уже стоит в другом слоте — меняем местами
        const existingIdx = nextLoadout.indexOf(def.id);
        if (existingIdx !== -1 && existingIdx !== selectedLoadoutSlotIdx) {
          nextLoadout[existingIdx] = nextLoadout[selectedLoadoutSlotIdx];
        }
        nextLoadout[selectedLoadoutSlotIdx] = def.id;
        sendMsg({ type: 'equip_loadout', loadout: nextLoadout });
      });
      item.append(btn);
    }

    inventoryListEl.append(item);
  }
}

function showChestReward(reward: ChestRewardResult): void {
  const def = config.abilities[reward.abilityId];
  const name = def ? def.name : reward.abilityId;
  const col = def ? COL[def.color] : '#38bdf8';
  chestRewardBoxEl.classList.remove('hidden');
  chestRewardBoxEl.innerHTML = `
    <div style="font-size:12px;font-weight:800;color:#fde047">
      ${reward.isNew ? '✨ НОВАЯ СПОСОБНОСТЬ ОТКРЫТА!' : `⬆️ ДУБЛИКАТ: УРОВЕНЬ ПОВЫШЕН ДО ${reward.newLevel}!`}
    </div>
    <div style="font-size:19px;font-weight:900;color:${col};margin:4px 0">${name}</div>
    <div style="font-size:12px;color:#cbd5e1">${def?.description ?? ''}</div>
    ${reward.refundCoins > 0 ? `<div style="font-size:12px;color:#4ade80;margin-top:4px">Макс. уровень! Возврат: +${reward.refundCoins} 🪙</div>` : ''}
  `;
  sfx.lineClear(2);
}

btnOpenInventory.addEventListener('click', () => {
  renderProfileUI();
  screenInventory.classList.remove('hidden');
});
btnCloseInventory.addEventListener('click', () => {
  screenInventory.classList.add('hidden');
});

btnOpenChests.addEventListener('click', () => {
  chestRewardBoxEl.classList.add('hidden');
  renderProfileUI();
  screenChests.classList.remove('hidden');
});
btnCloseChests.addEventListener('click', () => {
  screenChests.classList.add('hidden');
});

btnCloseBots.addEventListener('click', () => {
  screenBots.classList.add('hidden');
});

btnOpenQuests.addEventListener('click', () => {
  renderProfileUI();
  screenQuests.classList.remove('hidden');
});
btnCloseQuests.addEventListener('click', () => {
  screenQuests.classList.add('hidden');
});

btnOpenStats.addEventListener('click', () => {
  renderProfileUI();
  screenStats.classList.remove('hidden');
});
btnCloseStats.addEventListener('click', () => {
  screenStats.classList.add('hidden');
});

btnOpenMatchmaking.addEventListener('click', () => {
  renderProfileUI();
  mmStatusBoxEl.textContent = '';
  screenMatchmaking.classList.remove('hidden');
});
btnCloseMatchmaking.addEventListener('click', () => {
  if (mmSearching) {
    sendMsg({ type: 'cancel_matchmaking' });
    mmSearching = false;
  }
  screenMatchmaking.classList.add('hidden');
});

document.querySelectorAll<HTMLElement>('[data-mm-bet]').forEach((el) => {
  el.addEventListener('click', () => {
    if (mmSearching) return;
    selectedMmBet = Number(el.dataset.mmBet ?? 0);
    document.querySelectorAll<HTMLElement>('[data-mm-bet]').forEach((c) => {
      c.classList.toggle('active-slot', Number(c.dataset.mmBet ?? 0) === selectedMmBet);
    });
  });
});

btnStartMm.addEventListener('click', () => {
  const name = savePlayerName();
  connectWebSocket(() => {
    sendMsg({
      type: 'find_match',
      bet: selectedMmBet,
      name,
      playerId: myPlayerId,
    });
  });
});

btnCancelMm.addEventListener('click', () => {
  sendMsg({ type: 'cancel_matchmaking' });
});

document.querySelectorAll<HTMLButtonElement>('.btn-room-bet').forEach((btn) => {
  btn.addEventListener('click', () => {
    const bet = Number(btn.dataset.bet ?? 0);
    sendMsg({ type: 'set_room_bet', bet });
  });
});

document.querySelectorAll<HTMLButtonElement>('.btn-start-bot').forEach((btn) => {
  btn.addEventListener('click', () => {
    const difficulty = (btn.dataset.diff as BotDifficulty) || 'medium';
    const name = savePlayerName();
    botsErrorEl.classList.add('hidden');
    connectWebSocket(() => {
      sendMsg({
        type: 'start_bot_match',
        name,
        playerId: myPlayerId,
        difficulty,
      });
    });
  });
});

let adReqSeq = 1;
let adTimerId: ReturnType<typeof setInterval> | null = null;
btnWatchAd.addEventListener('click', () => {
  if (adTimerId) return;
  let secLeft = 5;
  btnWatchAd.disabled = true;
  btnWatchAd.textContent = `🎬 Реклама идёт... (${secLeft} с)`;
  adTimerId = setInterval(() => {
    secLeft -= 1;
    if (secLeft > 0) {
      btnWatchAd.textContent = `🎬 Реклама идёт... (${secLeft} с)`;
    } else {
      if (adTimerId) clearInterval(adTimerId);
      adTimerId = null;
      btnWatchAd.textContent = '🎬 Смотреть рекламу (+1 попытка)';
      sendMsg({
        type: 'watch_rewarded_ad',
        requestId: `ad_${myPlayerId}_${Date.now()}_${adReqSeq++}`,
      });
      sfx.lineClear(1);
    }
  }, 1000);
});

let chestReqSeq = 1;
document.querySelectorAll<HTMLButtonElement>('.btn-buy-chest').forEach((btn) => {
  btn.addEventListener('click', () => {
    const chestId = btn.dataset.chest as ChestTier;
    if (!chestId) return;
    connectWebSocket(() => {
      sendMsg({
        type: 'open_chest',
        chestId,
        requestId: `ch_${myPlayerId}_${Date.now()}_${chestReqSeq++}`,
      });
    });
  });
});

function updateScreens(): void {
  screenHome.classList.toggle('hidden', roomState !== 'home');
  screenLobby.classList.toggle('hidden', roomState !== 'lobby' && roomState !== 'countdown');
  screenResult.classList.toggle('hidden', roomState !== 'finished');
  btnLeaveMatch.style.display = roomState === 'playing' ? 'inline-block' : 'none';
  updateCanvasLayout();
}

function renderLobbyUI(countdownSec?: number): void {
  lobbyCodeEl.textContent = roomCode;
  const shareUrl = getShareableRoomUrl(roomCode);
  lobbyLinkEl.textContent = shareUrl;

  document.querySelectorAll<HTMLButtonElement>('.btn-room-bet').forEach((btn) => {
    const b = Number(btn.dataset.bet ?? 0);
    btn.className = b === roomBet ? 'btn btn-blue btn-room-bet' : 'btn btn-secondary btn-room-bet';
  });

  lobbyPlayersEl.innerHTML = '';
  for (let idx = 0; idx < 2; idx++) {
    const p = roomPlayers.find((pl) => pl.index === idx);
    const row = document.createElement('div');
    row.className = 'player-row';
    if (p) {
      const isMe = p.index === youIndex;
      const nameDiv = document.createElement('div');
      nameDiv.className = 'player-name';
      nameDiv.textContent = `${p.name}${isMe ? ' (Ты)' : ''}`;

      const badge = document.createElement('span');
      if (!p.connected) {
        badge.className = 'badge badge-wait';
        badge.textContent = S.statusOffline;
      } else if (p.ready) {
        badge.className = 'badge badge-ready';
        badge.textContent = S.statusReady;
      } else {
        badge.className = 'badge badge-wait';
        badge.textContent = S.statusNotReady;
      }
      row.append(nameDiv, badge);
    } else {
      const waitDiv = document.createElement('div');
      waitDiv.style.color = '#64748b';
      waitDiv.style.fontSize = '13px';
      waitDiv.textContent = S.waitingForPartner;
      row.append(waitDiv);
    }
    lobbyPlayersEl.append(row);
  }

  const me = roomPlayers.find((pl) => pl.index === youIndex);
  if (me?.ready) {
    btnReady.textContent = S.cancelReadyBtn;
    btnReady.className = 'btn btn-secondary';
  } else {
    btnReady.textContent = S.readyBtn;
    btnReady.className = 'btn btn-primary';
  }

  if (roomState === 'countdown' && countdownSec !== undefined) {
    lobbyCountdownEl.textContent = `${S.countdownPrefix}${countdownSec}...`;
    lobbyCountdownEl.classList.remove('hidden');
  } else {
    lobbyCountdownEl.classList.add('hidden');
  }
}

/** Преобразование серверной координаты волны u в экранную Y-координату */
function waveUToScreenY(u: number): number {
  const G = config.gapCells;
  const localU = youIndex === 0 ? u : G - u;
  if (localU < 0) {
    return MT - localU * CY;
  }
  if (localU > G) {
    return FRONT - (localU - G) * CY;
  }
  return MT - (localU / G) * (MT - FRONT);
}

function getPlayerLabel(idx: 0 | 1): string {
  if (idx === youIndex) return 'Ты';
  const opp = roomPlayers.find((p) => p.index === idx);
  if (opp?.isBot) return 'Бот';
  return opp?.name || 'Соперник';
}

function processGameEvents(events: GameEvent[]): void {
  for (const ev of events) {
    switch (ev.type) {
      case 'heal': {
        addMsg(S.msgHeal(getPlayerLabel(ev.player), ev.amount));
        break;
      }
      case 'jokers': {
        addMsg(S.msgJokers(getPlayerLabel(ev.player), ev.count));
        break;
      }
      case 'wave_spawn': {
        addMsg(S.msgWaveShot(getPlayerLabel(ev.player), ev.pow));
        if (ev.player === youIndex) {
          sfx.lineClear(ev.pow);
        }
        break;
      }
      case 'wave_collide': {
        sparks.push({ y: waveUToScreenY(ev.u), t: 0.5 });
        addMsg(S.msgWaveCollide);
        sfx.collide();
        break;
      }
      case 'freeze': {
        addMsg(S.msgFreeze);
        break;
      }
      case 'meteor': {
        for (const [r, c] of ev.cells) {
          meteorFlashes[ev.target].push({ x: c, r, t: 0.8 });
        }
        addMsg(S.msgMeteor);
        break;
      }
      case 'impact': {
        flashTimer[ev.target] = 0.4;
        for (const r of ev.rowsCleared) {
          rowFlashes[ev.target].push({ r, t: 0.6 });
        }
        addMsg(S.msgImpact(getPlayerLabel(ev.attacker), ev.damage, ev.rowsCleared.length));
        sfx.impact();
        break;
      }
      case 'overflow': {
        flashTimer[ev.player] = 0.5;
        addMsg(S.msgOverflow(getPlayerLabel(ev.player), ev.damage));
        sfx.impact();
        break;
      }
      case 'energy_gain': {
        if (ev.player === youIndex) {
          if (ev.gained.green > 0) energyPulse[0] = 0.45;
          if (ev.gained.blue > 0) energyPulse[1] = 0.45;
          if (ev.gained.red > 0) energyPulse[2] = 0.45;
          if (ev.gained.yellow > 0) energyPulse[3] = 0.45;
        }
        break;
      }
      case 'ability_activated': {
        const def = config.abilities[ev.abilityId];
        const abilityName = def ? def.name : ev.abilityId;
        addMsg(S.msgAbilityUsed(getPlayerLabel(ev.player), abilityName));
        if (ev.player === youIndex) {
          energyPulse[ev.slotIndex] = 0.5;
          sfx.rotate();
        }
        break;
      }
    }
  }
}

let abilityReqSeq = 1;
function sendActivateAbility(slotIndex: number): void {
  if (roomState !== 'playing' || paused || !latestSnapshot) return;
  const requestId = `ab_${youIndex}_${Date.now()}_${abilityReqSeq++}`;
  sendMsg({
    type: 'activate_ability',
    slotIndex,
    requestId,
  });
}

function getSlotHitAtClientPos(clientX: number, clientY: number): number {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return -1;
  const cx = ((clientX - rect.left) / rect.width) * CW;
  const cy = ((clientY - rect.top) / rect.height) * CH;
  const slotY = MT + BH + 32;
  const slotH = 38;
  if (cy < slotY - 4 || cy > slotY + slotH + 6) return -1;
  const gap = 6;
  const slotW = (BW - gap * 3) / 4;
  for (let i = 0; i < 4; i++) {
    const sx = BX + i * (slotW + gap);
    if (cx >= sx && cx <= sx + slotW) {
      return i;
    }
  }
  return -1;
}

/** Применяет локальную команду к предсказанной активной фигуре (включая проникающий джокер) */
function applyPredictedAction(piece: ActivePiece, board: number[][], action: InputAction): boolean {
  if (latestSnapshot && latestSnapshot.freeze[youIndex] > 0) return false;
  const isJoker = piece.c === 5;

  switch (action) {
    case 'L': {
      if (isJoker) {
        const nx = piece.x - 1;
        const lowest = getLowestEmptyRow(board, nx, H);
        if (nx >= 0 && lowest !== -1) {
          piece.x = nx;
          if (piece.y > lowest) piece.y = lowest;
          return true;
        }
        return false;
      }
      if (fits(board, piece.m, piece.x - 1, piece.y, W, H, false)) {
        piece.x -= 1;
        return true;
      }
      return false;
    }
    case 'R': {
      if (isJoker) {
        const nx = piece.x + 1;
        const lowest = getLowestEmptyRow(board, nx, H);
        if (nx < W && lowest !== -1) {
          piece.x = nx;
          if (piece.y > lowest) piece.y = lowest;
          return true;
        }
        return false;
      }
      if (fits(board, piece.m, piece.x + 1, piece.y, W, H, false)) {
        piece.x += 1;
        return true;
      }
      return false;
    }
    case 'ROT': {
      if (isJoker) return true;
      const rotated = rotateMatrixCW(piece.m);
      for (const kick of config.wallKicks) {
        if (fits(board, rotated, piece.x + kick, piece.y, W, H, false)) {
          piece.m = rotated;
          piece.x += kick;
          return true;
        }
      }
      return false;
    }
    case 'SD':
      if (fits(board, piece.m, piece.x, piece.y + 1, W, H, isJoker)) {
        piece.y += 1;
        return true;
      }
      return false;
    case 'HD':
      while (fits(board, piece.m, piece.x, piece.y + 1, W, H, isJoker)) {
        piece.y += 1;
      }
      return true;
  }
}

function sendGameInput(action: InputAction): void {
  if (roomState !== 'playing' || paused || !latestSnapshot) return;
  if (latestSnapshot.freeze[youIndex] > 0) return;

  const seq = nextInputSeq++;
  pendingInputs.push({ seq, a: action });
  sendMsg({ type: 'input', seq, a: action });

  if (predictedCur) {
    const moved = applyPredictedAction(predictedCur, latestSnapshot.boards[youIndex], action);
    if (moved) {
      if (action === 'L' || action === 'R' || action === 'SD') sfx.move();
      else if (action === 'ROT') sfx.rotate();
      else if (action === 'HD') {
        sfx.drop();
        pendingInputs = [];
      }
    }
  }
}

// Замер пинга каждые 2 секунды
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    sendMsg({ type: 'ping', t: performance.now() });
  }
}, 2000);

function connectWebSocket(onOpen?: () => void): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    if (ws.readyState === WebSocket.OPEN && onOpen) onOpen();
    return;
  }

  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${window.location.host}/ws?v=${PROTOCOL_VERSION}`);

  ws.addEventListener('open', () => {
    sendMsg({ type: 'ping', t: performance.now() });
    sendMsg({
      type: 'auth_profile',
      playerId: myPlayerId,
      name: savePlayerName(),
      avatar: myAvatar,
    });
    if (onOpen) {
      onOpen();
      return;
    }
    const pathMatch = window.location.pathname.match(/^\/r\/([A-Za-z0-9]{5})$/);
    const urlCode = pathMatch ? pathMatch[1].toUpperCase() : null;
    const savedRoom = sessionStorage.getItem('dual_tetris_active_room');
    const targetCode = urlCode || savedRoom;

    if (targetCode) {
      sendMsg({
        type: 'join_room',
        code: targetCode,
        name: savePlayerName(),
        sessionToken: getSessionToken(targetCode),
      });
    }
  });

  ws.addEventListener('message', (ev) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(ev.data as string) as ServerMessage;
    } catch {
      return;
    }

    if (msg.type === 'pong') {
      const rtt = Math.max(1, Math.round(performance.now() - msg.t));
      const dot = rtt < 60 ? '🟢' : rtt < 130 ? '🟡' : '🔴';
      pingBadge.textContent = `${dot} ${rtt} мс`;
      return;
    }

    if (msg.type === 'profile') {
      myProfile = msg.profile;
      myPlayerId = msg.profile.playerId;
      localStorage.setItem('dual_tetris_player_id', myPlayerId);
      renderProfileUI();
      return;
    }

    if (msg.type === 'chest_opened') {
      myProfile = msg.profile;
      renderProfileUI();
      showChestReward(msg.reward);
      return;
    }

    if (msg.type === 'matchmaking_status') {
      mmSearching = msg.searching;
      btnStartMm.classList.toggle('hidden', mmSearching);
      btnCancelMm.classList.toggle('hidden', !mmSearching);
      mmStatusBoxEl.textContent = mmSearching
        ? `⏳ Поиск соперника (ставка: ${msg.bet} 🪙)...`
        : '';
      return;
    }

    if (msg.type === 'error') {
      if (msg.code === 'NOT_ENOUGH_COINS_FOR_BET') {
        mmStatusBoxEl.textContent = msg.message || 'Недостаточно монет для такой ставки!';
        showError(msg.message || 'Недостаточно монет для такой ставки!');
        return;
      }
      if (msg.code === 'NO_BOSS_ATTEMPTS') {
        botsErrorEl.textContent =
          msg.message || 'Попытки на Босса закончились! Посмотри рекламу внизу.';
        botsErrorEl.classList.remove('hidden');
        return;
      }
      if (msg.code === 'NOT_ENOUGH_COINS') {
        chestRewardBoxEl.classList.remove('hidden');
        chestRewardBoxEl.innerHTML = `<div style="color:#fda4af;font-weight:700">Недостаточно монет 🪙! Побеждай в матчах, чтобы заработать монеты.</div>`;
        return;
      }
      if (msg.code === 'ROOM_NOT_FOUND') {
        clearActiveRoom();
        if (window.location.pathname.startsWith('/r/')) {
          window.history.replaceState({}, '', '/');
        }
        roomState = 'home';
        updateScreens();
        showError(S.errRoomNotFound);
      } else if (msg.code === 'ROOM_FULL') {
        showError(S.errRoomFull);
      } else if (msg.message) {
        showError(msg.message);
      }
      return;
    }

    if (msg.type === 'room') {
      roomCode = msg.code;
      roomBet = msg.bet ?? 0;
      youIndex = msg.youIndex;
      roomPlayers = msg.players;
      paused = Boolean(msg.paused);
      pauseRemainingSec = msg.pauseRemainingSec ?? 0;
      setSessionToken(msg.code, msg.sessionToken);

      if (window.location.pathname !== `/r/${msg.code}` && !msg.players[1]?.isBot) {
        window.history.replaceState({}, '', `/r/${msg.code}`);
      }

      roomState = msg.state;
      updateScreens();
      if (roomState === 'lobby' || roomState === 'countdown') {
        renderLobbyUI(msg.countdownSec);
      } else if (roomState === 'finished') {
        const opp = roomPlayers.find((p) => p.index !== youIndex);
        const me = roomPlayers.find((p) => p.index === youIndex);
        if (me?.rematchVote && !opp?.rematchVote) {
          resultRematchStatusEl.textContent = S.rematchWaiting;
        } else if (!me?.rematchVote && opp?.rematchVote) {
          resultRematchStatusEl.textContent = S.rematchRequestedByOpponent;
        } else {
          resultRematchStatusEl.textContent = '';
        }
      }
      return;
    }

    if (msg.type === 'match_start') {
      config = msg.config;
      youIndex = msg.youIndex;
      roomState = 'playing';
      screenBots.classList.add('hidden');
      screenQuests.classList.add('hidden');
      screenInventory.classList.add('hidden');
      screenChests.classList.add('hidden');
      screenMatchmaking.classList.add('hidden');
      screenStats.classList.add('hidden');
      mmSearching = false;
      btnStartMm.classList.remove('hidden');
      btnCancelMm.classList.add('hidden');
      latestSnapshot = null;
      predictedCur = null;
      pendingInputs = [];
      nextInputSeq = 1;
      renderedWaves = [];
      flashTimer = [0, 0];
      rowFlashes = [[], []];
      meteorFlashes = [[], []];
      sparks = [];
      msgs = [];
      btnRematch.disabled = false;
      resultRematchStatusEl.textContent = '';
      updateScreens();
      return;
    }

    if (msg.type === 'snapshot') {
      const prevCur = latestSnapshot?.cur[youIndex];
      latestSnapshot = msg;
      if (msg.paused !== undefined) paused = msg.paused;
      if (msg.pauseRemainingSec !== undefined) pauseRemainingSec = msg.pauseRemainingSec;

      const ack = msg.ackSeq[youIndex];
      pendingInputs = pendingInputs.filter((inp) => inp.seq > ack);

      const authCur = msg.cur[youIndex];
      const isNewSpawn = !prevCur || authCur.y < prevCur.y || authCur.c !== prevCur.c;
      if (isNewSpawn) {
        pendingInputs = [];
      }

      predictedCur = {
        m: authCur.m.map((r) => r.slice()),
        c: authCur.c,
        x: authCur.x,
        y: authCur.y,
      };
      for (const inp of pendingInputs) {
        if (inp.a !== 'HD') {
          applyPredictedAction(predictedCur, msg.boards[youIndex], inp.a);
        }
      }

      renderedWaves = msg.waves.map((w) => ({ ...w }));
      processGameEvents(msg.events);
      return;
    }

    if (msg.type === 'match_end') {
      roomState = 'finished';
      updateScreens();

      const earned = msg.coinsEarned?.[youIndex] ?? 0;
      const xp = msg.xpEarned?.[youIndex] ?? 0;
      const rDelta = msg.ratingDelta?.[youIndex] ?? 0;
      const newR = msg.newRating?.[youIndex];
      let rewardHtml = earned > 0 ? `+${earned} 🪙 Монет` : '0 🪙';
      if (xp > 0) rewardHtml += ` • +${xp} XP`;
      if (newR !== undefined) {
        const rSign = rDelta >= 0 ? `+${rDelta}` : `${rDelta}`;
        rewardHtml += `<div style="font-size:14px;color:${rDelta >= 0 ? '#4ade80' : '#fda4af'};margin-top:3px">🏆 Рейтинг: ${rSign} (${newR})</div>`;
      }
      if (msg.betPot && msg.betPot > 0 && msg.winner === youIndex) {
        rewardHtml += `<div style="font-size:13px;color:#fde047;margin-top:3px">💰 Выигрыш банка Coin Duel: ${msg.betPot} 🪙!</div>`;
      }
      if (msg.bonusChestReward) {
        const bDef = config.abilities[msg.bonusChestReward.abilityId];
        rewardHtml += `<div style="font-size:13px;color:#4ade80;margin-top:4px">🪵 Трофей Босса Дня: ${bDef ? bDef.name : msg.bonusChestReward.abilityId} (Ур.${msg.bonusChestReward.newLevel})!</div>`;
      }
      resultCoinsEarnedEl.innerHTML = rewardHtml;

      if (msg.winner === null) {
        resultTitleEl.textContent = S.draw;
        resultSubtitleEl.textContent = S.reasonDraw;
      } else if (msg.winner === youIndex) {
        resultTitleEl.textContent = S.victory;
        resultSubtitleEl.textContent =
          msg.reason === 'forfeit' ? S.reasonForfeitVictory : S.reasonKoVictory;
      } else {
        resultTitleEl.textContent = S.defeat;
        resultSubtitleEl.textContent =
          msg.reason === 'forfeit' ? S.reasonForfeitDefeat : S.reasonKoDefeat;
      }
      return;
    }
  });

  ws.addEventListener('close', () => {
    pingBadge.textContent = '🔴 офлайн';
    if (roomState === 'playing' || roomState === 'lobby' || roomState === 'countdown') {
      setTimeout(() => connectWebSocket(), 1200);
    }
  });
}

// Обработчики кнопок интерфейса
btnCreateRoom.addEventListener('click', () => {
  const name = savePlayerName();
  connectWebSocket(() => {
    sendMsg({ type: 'create_room', name, playerId: myPlayerId });
  });
});

btnJoinRoom.addEventListener('click', () => {
  const code = inputRoomCode.value.trim().toUpperCase();
  if (code.length < 4) {
    showError('Введи 5-буквенный код комнаты');
    return;
  }
  const name = savePlayerName();
  connectWebSocket(() => {
    sendMsg({
      type: 'join_room',
      code,
      name,
      sessionToken: getSessionToken(code),
      playerId: myPlayerId,
    });
  });
});

inputRoomCode.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnJoinRoom.click();
});

btnBotMatch.addEventListener('click', () => {
  botsErrorEl.classList.add('hidden');
  renderProfileUI();
  screenBots.classList.remove('hidden');
});

btnCopyLink.addEventListener('click', async () => {
  const url = getShareableRoomUrl(roomCode);
  try {
    await navigator.clipboard.writeText(url);
    btnCopyLink.textContent = S.copiedLink;
    setTimeout(() => {
      btnCopyLink.textContent = S.copyLink;
    }, 2000);
  } catch {
    prompt('Скопируй ссылку и отправь жене:', url);
  }
});

btnShareLink.addEventListener('click', async () => {
  const url = getShareableRoomUrl(roomCode);
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'DUAL TETRIS — Дуэль',
        text: `Заходи сыграть партию в DUAL TETRIS! Код: ${roomCode}`,
        url,
      });
      return;
    } catch {
      // Пользователь закрыл окно шаринга
    }
  }
  btnCopyLink.click();
});

btnReady.addEventListener('click', () => {
  const me = roomPlayers.find((p) => p.index === youIndex);
  sendMsg({ type: 'ready', value: !me?.ready });
});

function leaveToHome(): void {
  sendMsg({ type: 'leave' });
  clearActiveRoom();
  if (window.location.pathname.startsWith('/r/')) {
    window.history.replaceState({}, '', '/');
  }
  roomState = 'home';
  latestSnapshot = null;
  updateScreens();
}

btnLeaveLobby.addEventListener('click', leaveToHome);
btnLeaveMatch.addEventListener('click', leaveToHome);
btnResultMenu.addEventListener('click', leaveToHome);

btnRematch.addEventListener('click', () => {
  btnRematch.disabled = true;
  sendMsg({ type: 'rematch' });
});

// Клавиатурное управление (раздел 6 + клавиши 1..4 для активации способностей)
window.addEventListener('keydown', (e) => {
  if (roomState !== 'playing') return;
  const k = e.key;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', '1', '2', '3', '4'].includes(k)) {
    e.preventDefault();
  }
  if (k === 'ArrowLeft') sendGameInput('L');
  else if (k === 'ArrowRight') sendGameInput('R');
  else if (k === 'ArrowDown') sendGameInput('SD');
  else if (k === 'ArrowUp') sendGameInput('ROT');
  else if (k === ' ') sendGameInput('HD');
  else if (k >= '1' && k <= '4') sendActivateAbility(Number(k) - 1);
});

// Клик мышью по кнопкам способностей на ПК
canvas.addEventListener('mousedown', (e) => {
  if (roomState !== 'playing') return;
  const hitSlot = getSlotHitAtClientPos(e.clientX, e.clientY);
  if (hitSlot !== -1) {
    e.preventDefault();
    sendActivateAbility(hitSlot);
  }
});

// Мобильное управление свайпами
interface TouchTrack {
  x: number;
  y: number;
  ax: number;
  ay: number;
  t0: number;
  lk: 'h' | 'v' | null;
  h: Array<{ y: number; t: number }>;
}
let T: TouchTrack | null = null;

function cellPx(): number {
  return (CX * canvas.getBoundingClientRect().width) / CW;
}

canvas.addEventListener(
  'touchstart',
  (e) => {
    e.preventDefault();
    const t = e.touches[0];
    const hitSlot = getSlotHitAtClientPos(t.clientX, t.clientY);
    if (hitSlot !== -1 && roomState === 'playing') {
      T = null;
      sendActivateAbility(hitSlot);
      return;
    }
    const n = performance.now();
    T = {
      x: t.clientX,
      y: t.clientY,
      ax: t.clientX,
      ay: t.clientY,
      t0: n,
      lk: null,
      h: [{ y: t.clientY, t: n }],
    };
  },
  { passive: false }
);

canvas.addEventListener(
  'touchmove',
  (e) => {
    e.preventDefault();
    if (!T) return;
    const t = e.touches[0];
    const c = cellPx();
    const dx = t.clientX - T.x;
    const dy = t.clientY - T.y;
    const n = performance.now();
    const tc = config.touch;

    T.h.push({ y: t.clientY, t: n });
    T.h = T.h.filter((p) => n - p.t < tc.hardDropWindowMs);

    if (!T.lk && Math.max(Math.abs(dx), Math.abs(dy)) > c * tc.lockThresholdCells) {
      const a = Math.abs(dx);
      const b = Math.abs(dy);
      if (b > a * tc.axisLockRatio) T.lk = 'v';
      else if (a > b * tc.axisLockRatio) T.lk = 'h';
    }

    if (roomState !== 'playing') return;

    if (T.lk === 'h') {
      while (t.clientX - T.ax >= c * tc.horizontalStepCells) {
        sendGameInput('R');
        T.ax += c;
      }
      while (T.ax - t.clientX >= c * tc.horizontalStepCells) {
        sendGameInput('L');
        T.ax -= c;
      }
    } else if (T.lk === 'v') {
      while (t.clientY - T.ay >= c * tc.verticalStepCells) {
        sendGameInput('SD');
        T.ay += c;
      }
    }
  },
  { passive: false }
);

canvas.addEventListener(
  'touchend',
  (e) => {
    e.preventDefault();
    if (!T) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - T.x;
    const dy = t.clientY - T.y;
    const n = performance.now();
    const dt = n - T.t0;
    const c = cellPx();
    const lk = T.lk;
    const tc = config.touch;
    const h = T.h.filter((p) => n - p.t < tc.hardDropWindowMs);
    T = null;

    if (roomState !== 'playing') return;

    const vel = h.length ? (t.clientY - h[0].y) / Math.max(30, n - h[0].t) : 0;

    if (!lk) {
      if (dt < tc.tapMaxDurationMs && Math.hypot(dx, dy) < c * tc.tapMaxMoveCells) {
        sendGameInput('ROT');
      }
    } else if (lk === 'v') {
      if (dy < -c * tc.swipeUpRotateCells) {
        sendGameInput('ROT');
      } else if (
        dy > 0 &&
        (vel > tc.hardDropVelocityPxPerMs ||
          (dy > c * tc.hardDropMinCells && dt < tc.hardDropMaxDurationMs))
      ) {
        sendGameInput('HD');
      }
    }
  },
  { passive: false }
);

// Отрисовка на Canvas 2D
function drawCell(x: number, y: number, colorIdx: number, alpha = 1): void {
  g2.globalAlpha = alpha;
  g2.fillStyle = COL[colorIdx] || '#fff';
  g2.fillRect(x + 1, y + 1, CX - 2, CY - 2);
  g2.globalAlpha = 1;
}

function rowToScreenY(isOpponent: boolean, r: number): number {
  return isOpponent ? ET + (H - 1 - r) * CY : MT + r * CY;
}

function drawNextBox(piece: PieceShape, x: number, y: number): void {
  const boxH = Math.min(44, Math.max(34, MT - FRONT - 8));
  g2.fillStyle = '#111827';
  g2.fillRect(x, y, 60, boxH);
  const m = piece.m;
  const s = 11;
  m.forEach((row, i) =>
    row.forEach((v, j) => {
      if (v) {
        g2.fillStyle = COL[piece.c] || '#fff';
        g2.fillRect(
          x + 30 - (m[0].length * s) / 2 + j * s,
          y + boxH / 2 - (m.length * s) / 2 + i * s,
          s - 1,
          s - 1
        );
      }
    })
  );
}

function drawPlayerBoard(playerIndex: 0 | 1, isOpponent: boolean, barColor: string): void {
  if (!latestSnapshot) return;
  const oy = isOpponent ? ET : MT;
  const board = latestSnapshot.boards[playerIndex];
  const hp = latestSnapshot.hp[playerIndex];
  const playerMaxHp = latestSnapshot.maxHp?.[playerIndex] ?? config.maxHp;
  const combo = latestSnapshot.combo[playerIndex];
  const freeze = latestSnapshot.freeze[playerIndex];
  const nextPiece = latestSnapshot.next[playerIndex];
  const curPiece =
    !isOpponent && predictedCur ? predictedCur : latestSnapshot.cur[playerIndex];

  g2.fillStyle = flashTimer[playerIndex] > 0 ? '#3b1a1a' : '#111827';
  g2.fillRect(BX, oy, BW, BH);

  // Сетка
  g2.strokeStyle = '#1c2433';
  g2.lineWidth = 1;
  for (let i = 1; i < W; i++) {
    g2.beginPath();
    g2.moveTo(BX + i * CX, oy);
    g2.lineTo(BX + i * CX, oy + BH);
    g2.stroke();
  }
  for (let r = 1; r < H; r++) {
    g2.beginPath();
    g2.moveTo(BX, oy + r * CY);
    g2.lineTo(BX + BW, oy + r * CY);
    g2.stroke();
  }

  // Зафиксированные клетки
  board.forEach((row, r) =>
    row.forEach((val, c) => {
      if (val) {
        drawCell(BX + c * CX, rowToScreenY(isOpponent, r), val);
      }
    })
  );

  // Активная фигура и её призрак (для джокера рисуем сквозной луч до самой нижней пустой клетки!)
  if (curPiece) {
    const { m, c, x, y } = curPiece;
    const gy = !isOpponent ? getGhostY(board, curPiece, W, H) : y;

    if (!isOpponent && c === 5 && gy > y) {
      g2.fillStyle = 'rgba(248, 250, 252, 0.14)';
      g2.fillRect(BX + x * CX + CX * 0.25, rowToScreenY(false, y), CX * 0.5, (gy - y + 1) * CY);
    }

    m.forEach((row, ry) =>
      row.forEach((val, rx) => {
        if (val) {
          if (!isOpponent) {
            drawCell(BX + (x + rx) * CX, rowToScreenY(false, gy + ry), c, c === 5 ? 0.45 : 0.22);
          }
          if (y + ry >= 0 && y + ry < H) {
            drawCell(BX + (x + rx) * CX, rowToScreenY(isOpponent, y + ry), c);
          }
        }
      })
    );
  }

  // Подсветка разрушенных волной строк
  for (const f of rowFlashes[playerIndex]) {
    g2.fillStyle = '#fff';
    g2.globalAlpha = Math.max(0, f.t / 0.6);
    g2.fillRect(BX, rowToScreenY(isOpponent, f.r), BW, CY);
    g2.globalAlpha = 1;
  }

  // Вспышки метеоритов
  for (const f of meteorFlashes[playerIndex]) {
    g2.fillStyle = '#fb923c';
    g2.globalAlpha = Math.max(0, f.t / 0.8);
    g2.fillRect(BX + f.x * CX, rowToScreenY(isOpponent, f.r), CX, CY);
    g2.globalAlpha = 1;
  }

  // Оверлей заморозки
  if (freeze > 0) {
    g2.fillStyle = 'rgba(125,211,252,.25)';
    g2.fillRect(BX, oy, BW, BH);
    g2.fillStyle = '#e0f2fe';
    g2.font = 'bold 16px system-ui';
    g2.textAlign = 'center';
    g2.fillText(`${S.frozenPrefix}${freeze.toFixed(1)}`, BX + BW / 2, oy + BH / 2);
  }

  // Рамка доски
  g2.lineWidth = 2.5;
  g2.strokeStyle = hp < config.rageHpThreshold ? '#ef4444' : '#374151';
  g2.strokeRect(BX - 1, oy - 1, BW + 2, BH + 2);

  // Компактная полоса HP и подпись игрока прямо у краёв экрана
  const by = isOpponent ? ET - 16 : MT + BH + 4;
  const ly = isOpponent ? ET - 21 : MT + BH + 28;
  const title = getPlayerLabel(playerIndex).toUpperCase();

  g2.textAlign = 'left';
  g2.fillStyle = '#e5e7eb';
  g2.font = 'bold 11.5px system-ui';
  g2.fillText(
    title +
      (hp < config.rageHpThreshold ? `  ${S.rage}` : '') +
      (combo > 1 ? `   ${S.comboPrefix}${combo}` : ''),
    BX,
    ly
  );

  // Мини-индикаторы энергии соперника справа над его полосой HP
  const energy = latestSnapshot.energy?.[playerIndex] ?? { green: 0, blue: 0, red: 0, yellow: 0 };
  if (isOpponent) {
    const eVals = [energy.green, energy.blue, energy.red, energy.yellow];
    const pillW = 36;
    const gap = 4;
    const startX = BX + BW - (pillW * 4 + gap * 3);
    for (let i = 0; i < 4; i++) {
      const px = startX + i * (pillW + gap);
      const py = ET - 31;
      g2.fillStyle = '#1f2937';
      g2.fillRect(px, py, pillW, 11);
      g2.fillStyle = COL[i + 1];
      g2.globalAlpha = 0.35;
      g2.fillRect(px, py, (pillW * Math.min(config.energyMax, eVals[i])) / config.energyMax, 11);
      g2.globalAlpha = 1;
      g2.fillStyle = COL[i + 1];
      g2.font = 'bold 9.5px system-ui';
      g2.textAlign = 'center';
      g2.fillText(`${eVals[i]}`, px + pillW / 2, py + 9);
    }
    g2.textAlign = 'left';
  }

  g2.fillStyle = '#1f2937';
  g2.fillRect(BX, by, BW, 12);
  g2.fillStyle = hp < config.rageHpThreshold ? '#ef4444' : barColor;
  g2.fillRect(BX, by, (BW * Math.max(0, hp)) / playerMaxHp, 12);
  g2.fillStyle = '#fff';
  g2.font = 'bold 10px system-ui';
  g2.fillText(`${Math.max(0, Math.round(hp))} / ${playerMaxHp}`, BX + 5, by + 9.5);

  // Панель из 4 слотов способностей и энергии игрока внизу экрана (Фаза 1А + 1Б)
  if (!isOpponent) {
    const eByColor: Record<1 | 2 | 3 | 4, number> = {
      1: energy.green,
      2: energy.blue,
      3: energy.red,
      4: energy.yellow,
    };
    const slots = latestSnapshot.abilities?.[playerIndex] ?? [
      { abilityId: config.defaultLoadout[0] },
      { abilityId: config.defaultLoadout[1] },
      { abilityId: config.defaultLoadout[2] },
      { abilityId: config.defaultLoadout[3] },
    ];
    const gap = 6;
    const slotW = (BW - gap * 3) / 4;
    const slotY = MT + BH + 32;
    const slotH = 38;

    for (let i = 0; i < 4; i++) {
      const sx = BX + i * (slotW + gap);
      const pulse = energyPulse[i] > 0;
      const slot = slots[i];
      const def = slot?.abilityId ? config.abilities[slot.abilityId] : undefined;

      if (!def) {
        g2.fillStyle = '#0f172a';
        g2.fillRect(sx, slotY, slotW, slotH);
        g2.lineWidth = 1;
        g2.strokeStyle = '#1e293b';
        g2.strokeRect(sx, slotY, slotW, slotH);
        g2.fillStyle = '#64748b';
        g2.font = '10px system-ui';
        g2.textAlign = 'center';
        g2.fillText(S.emptySlot, sx + slotW / 2, slotY + 23);
        continue;
      }

      const curEnergy = eByColor[def.color] ?? 0;
      const frozenBlocked = freeze > 0 && !def.allowWhenFrozen;
      const isReady = curEnergy >= def.energyCost && !frozenBlocked;
      const colHex = COL[def.color];

      g2.fillStyle = isReady ? '#17253b' : '#0f172a';
      g2.fillRect(sx, slotY, slotW, slotH);

      // Полоса накопления энергии к стоимости способности
      const fillRatio = Math.min(1, curEnergy / Math.max(1, def.energyCost));
      g2.fillStyle = colHex;
      g2.globalAlpha = isReady ? 0.38 : 0.16;
      g2.fillRect(sx, slotY, slotW * fillRatio, slotH);
      g2.globalAlpha = 1;

      g2.lineWidth = isReady || pulse ? 2 : 1;
      g2.strokeStyle = isReady || pulse ? colHex : '#334155';
      g2.strokeRect(sx, slotY, slotW, slotH);

      // Название способности и уровень
      const lvl = slot?.level && slot.level > 1 ? `★${slot.level}` : '';
      g2.fillStyle = isReady ? '#ffffff' : '#94a3b8';
      g2.font = 'bold 10px system-ui';
      g2.textAlign = 'left';
      g2.fillText(`${i + 1}.${def.name}${lvl}`, sx + 4, slotY + 14, slotW - 8);

      // Текущая энергия / Стоимость
      g2.fillStyle = isReady ? colHex : '#cbd5e1';
      g2.font = 'bold 11.5px system-ui';
      g2.textAlign = 'right';
      g2.fillText(`${curEnergy}/${def.energyCost}`, sx + slotW - 5, slotY + 31);
    }
    g2.textAlign = 'left';
  }

  // Окно следующей фигуры в зазоре
  const boxH = Math.min(44, Math.max(34, MT - FRONT - 8));
  const boxY = FRONT + (MT - FRONT - boxH) / 2;
  drawNextBox(nextPiece, isOpponent ? BX : BX + BW - 60, boxY);
}

let lastFrameTime = performance.now();

function renderLoop(now: number): void {
  const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  if (latestSnapshot && !paused && roomState === 'playing') {
    for (const idx of [0, 1] as const) {
      flashTimer[idx] = Math.max(0, flashTimer[idx] - dt);
      rowFlashes[idx].forEach((f) => (f.t -= dt));
      rowFlashes[idx] = rowFlashes[idx].filter((f) => f.t > 0);
      meteorFlashes[idx].forEach((f) => (f.t -= dt));
      meteorFlashes[idx] = meteorFlashes[idx].filter((f) => f.t > 0);
      latestSnapshot.freeze[idx] = Math.max(0, latestSnapshot.freeze[idx] - dt);
    }
    for (let i = 0; i < 4; i++) {
      energyPulse[i] = Math.max(0, energyPulse[i] - dt);
    }

    const waveStep = config.waveSpeedCellsPerSec * dt;
    for (const w of renderedWaves) {
      w.u += w.owner === 0 ? waveStep : -waveStep;
    }

    sparks.forEach((s) => (s.t -= dt));
    sparks = sparks.filter((s) => s.t > 0);
    msgs.forEach((m) => (m.l -= dt));
    msgs = msgs.filter((m) => m.l > 0);
  }

  g2.fillStyle = '#0b0e17';
  g2.fillRect(0, 0, CW, CH);

  if (latestSnapshot) {
    const oppIndex: 0 | 1 = youIndex === 0 ? 1 : 0;
    drawPlayerBoard(oppIndex, true, '#f43f5e');
    drawPlayerBoard(youIndex, false, '#22c55e');

    for (const w of renderedWaves) {
      const up = w.owner === youIndex;
      const wy = waveUToScreenY(w.u);
      const col = WC[w.col] || (up ? '34,211,238' : '244,63,94');
      const h = 3 + w.pow * 2;
      const gr = g2.createLinearGradient(0, wy, 0, wy + (up ? 60 : -60));
      gr.addColorStop(0, `rgba(${col},.7)`);
      gr.addColorStop(1, `rgba(${col},0)`);
      g2.fillStyle = gr;
      g2.fillRect(BX - 6, up ? wy : wy - 60, BW + 12, 60);
      g2.fillStyle = `rgb(${col})`;
      g2.fillRect(BX - 6, wy - h / 2, BW + 12, h);
      g2.fillStyle = '#fff';
      g2.fillRect(BX - 6, wy - 1, BW + 12, 2);
    }

    for (const s of sparks) {
      g2.globalAlpha = Math.min(1, s.t * 2);
      g2.fillStyle = '#fde68a';
      g2.beginPath();
      g2.arc(CW / 2, s.y, 40 * (1 - s.t), 0, 7);
      g2.fill();
      g2.globalAlpha = 1;
    }

    g2.textAlign = 'center';
    g2.font = '11px system-ui';
    const gapCenterY = FRONT + (MT - FRONT) / 2 - 10;
    msgs.forEach((m, i) => {
      g2.globalAlpha = Math.min(1, m.l);
      g2.fillStyle = '#fde68a';
      g2.fillText(m.t, CW / 2, gapCenterY + i * 13, BW - 130);
      g2.globalAlpha = 1;
    });

    if (paused && roomState === 'playing') {
      g2.fillStyle = 'rgba(5, 8, 15, 0.78)';
      g2.fillRect(0, 0, CW, CH);
      g2.fillStyle = '#facc15';
      g2.font = 'bold 16px system-ui';
      g2.textAlign = 'center';
      g2.fillText(S.pausedBanner, CW / 2, CH / 2 - 10);
      g2.fillStyle = '#cbd5e1';
      g2.font = '14px system-ui';
      g2.fillText(`Осталось: ${pauseRemainingSec} сек.`, CW / 2, CH / 2 + 16);
    }
  }

  requestAnimationFrame(renderLoop);
}

// Мгновенное переподключение при возврате в браузер из мессенджера на телефоне
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      connectWebSocket();
    } else if (ws.readyState === WebSocket.OPEN) {
      sendMsg({ type: 'ping', t: performance.now() });
    }
  }
});

updateScreens();
connectWebSocket();
requestAnimationFrame(renderLoop);
