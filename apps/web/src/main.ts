import {
  DEFAULT_CONFIG,
  PROTOCOL_VERSION,
  fits,
  getGhostY,
  getLowestEmptyRow,
  rotateMatrixCW,
  type ActivePiece,
  type ClientMessage,
  type GameConfig,
  type GameEvent,
  type InputAction,
  type PieceShape,
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
const resultRematchStatusEl = document.getElementById('result-rematch-status')!;
const btnRematch = document.getElementById('btn-rematch') as HTMLButtonElement;
const btnResultMenu = document.getElementById('btn-result-menu') as HTMLButtonElement;

const pingBadge = document.getElementById('ping-badge')!;
const btnSound = document.getElementById('btn-sound') as HTMLButtonElement;
const btnLeaveMatch = document.getElementById('btn-leave-match') as HTMLButtonElement;

// Состояние клиента
let ws: WebSocket | null = null;
let config: GameConfig = DEFAULT_CONFIG;
let youIndex: 0 | 1 = 0;
let roomCode = '';
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

// Загрузка сохранённого имени и звука
inputName.value = localStorage.getItem('dual_tetris_name') ?? '';
btnSound.textContent = sfx.enabled ? '🔊' : '🔇';

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
    }
  }
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

    if (msg.type === 'error') {
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
    sendMsg({ type: 'create_room', name });
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
    });
  });
});

inputRoomCode.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnJoinRoom.click();
});

btnBotMatch.addEventListener('click', () => {
  const name = savePlayerName();
  connectWebSocket(() => {
    sendMsg({ type: 'start_bot_match', name });
  });
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

// Клавиатурное управление (раздел 6)
window.addEventListener('keydown', (e) => {
  if (roomState !== 'playing') return;
  const k = e.key;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(k)) {
    e.preventDefault();
  }
  if (k === 'ArrowLeft') sendGameInput('L');
  else if (k === 'ArrowRight') sendGameInput('R');
  else if (k === 'ArrowDown') sendGameInput('SD');
  else if (k === 'ArrowUp') sendGameInput('ROT');
  else if (k === ' ') sendGameInput('HD');
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
  g2.fillRect(BX, by, (BW * Math.max(0, hp)) / config.maxHp, 12);
  g2.fillStyle = '#fff';
  g2.font = 'bold 10px system-ui';
  g2.fillText(`${Math.max(0, Math.round(hp))} / ${config.maxHp}`, BX + 5, by + 9.5);

  // Четыре резервуара энергии игрока внизу экрана (Фаза 1А)
  if (!isOpponent) {
    const eVals = [energy.green, energy.blue, energy.red, energy.yellow];
    const eLabels = ['ЗЕЛ', 'СИН', 'КРА', 'ЖЁЛ'];
    const gap = 6;
    const slotW = (BW - gap * 3) / 4;
    const slotY = MT + BH + 34;
    const slotH = 34;

    for (let i = 0; i < 4; i++) {
      const sx = BX + i * (slotW + gap);
      const pulse = energyPulse[i] > 0;
      g2.fillStyle = pulse ? '#1e293b' : '#111827';
      g2.fillRect(sx, slotY, slotW, slotH);

      const ratio = Math.min(1, eVals[i] / Math.max(1, config.energyMax));
      g2.fillStyle = COL[i + 1];
      g2.globalAlpha = pulse ? 0.45 : 0.25;
      g2.fillRect(sx, slotY, slotW * ratio, slotH);
      g2.globalAlpha = 1;

      g2.lineWidth = pulse ? 2 : 1;
      g2.strokeStyle = pulse ? COL[i + 1] : '#334155';
      g2.strokeRect(sx, slotY, slotW, slotH);

      g2.fillStyle = COL[i + 1];
      g2.font = 'bold 10px system-ui';
      g2.textAlign = 'left';
      g2.fillText(eLabels[i], sx + 6, slotY + 13);

      g2.fillStyle = '#f8fafc';
      g2.font = 'bold 12px system-ui';
      g2.textAlign = 'right';
      g2.fillText(`${eVals[i]}/${config.energyMax}`, sx + slotW - 6, slotY + 27);
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
