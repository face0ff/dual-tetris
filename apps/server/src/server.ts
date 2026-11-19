import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  BotController,
  ClientMessageSchema,
  DEFAULT_CONFIG,
  PROTOCOL_VERSION,
  applyPlayerInput,
  createMatch,
  createSnapshot,
  stepMatch,
  type GameConfig,
  type MatchState,
  type RoomPlayerInfo,
  type RoomState,
  type ServerMessage,
} from '@dual-tetris/core';

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode(existing: Set<string>): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = '';
    for (let i = 0; i < 5; i++) {
      code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
    }
    if (!existing.has(code)) return code;
  }
  return crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5);
}

interface PlayerSlot {
  index: 0 | 1;
  name: string;
  sessionToken: string;
  ws: WebSocket | null;
  ready: boolean;
  connected: boolean;
  isBot: boolean;
  rematchVote: boolean;
  disconnectedAt: number | null;
  inputTimestamps: number[];
}

interface Room {
  code: string;
  state: RoomState;
  players: [PlayerSlot | null, PlayerSlot | null];
  match: MatchState | null;
  bot: BotController | null;
  countdownRemainingSec: number;
  paused: boolean;
  pauseRemainingSec: number;
  lastActivityAt: number;
  tickCounter: number;
  dirtySnapshot: boolean;
  config: GameConfig;
}

export interface DualTetrisServer {
  httpServer: http.Server;
  wss: WebSocketServer;
  rooms: Map<string, Room>;
  listen: (port?: number, host?: string) => Promise<number>;
  close: () => Promise<void>;
}

export function getLanAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const result: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        result.push(iface.address);
      }
    }
  }
  return result;
}

export function createDualTetrisServer(
  customConfig: Partial<GameConfig> = {},
  staticDir?: string
): DualTetrisServer {
  const config: GameConfig = {
    ...DEFAULT_CONFIG,
    ...customConfig,
    bot: { ...DEFAULT_CONFIG.bot, ...(customConfig.bot ?? {}) },
    touch: { ...DEFAULT_CONFIG.touch, ...(customConfig.touch ?? {}) },
  };

  const rooms = new Map<string, Room>();
  const socketToRoom = new Map<WebSocket, { room: Room; playerIndex: 0 | 1 }>();

  const send = (ws: WebSocket | null, msg: ServerMessage) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  };

  const getRoomPlayersInfo = (room: Room): RoomPlayerInfo[] => {
    const list: RoomPlayerInfo[] = [];
    for (const p of room.players) {
      if (p) {
        list.push({
          index: p.index,
          name: p.name,
          ready: p.ready,
          connected: p.connected,
          isBot: p.isBot,
          rematchVote: p.rematchVote,
        });
      }
    }
    return list;
  };

  const broadcastRoomState = (room: Room) => {
    const playersInfo = getRoomPlayersInfo(room);
    for (const p of room.players) {
      if (p && p.ws) {
        send(p.ws, {
          type: 'room',
          code: room.code,
          players: playersInfo,
          state: room.state,
          youIndex: p.index,
          sessionToken: p.sessionToken,
          countdownSec: room.state === 'countdown' ? Math.ceil(room.countdownRemainingSec) : undefined,
          paused: room.paused,
          pauseRemainingSec: room.paused ? Math.ceil(room.pauseRemainingSec) : undefined,
        });
      }
    }
  };

  const startMatchInRoom = (room: Room) => {
    const seed = Math.floor(Math.random() * 0x7fffffff) || 1;
    room.match = createMatch(seed, room.config);
    room.state = 'playing';
    room.paused = false;
    room.pauseRemainingSec = 0;
    room.tickCounter = 0;
    room.lastActivityAt = Date.now();

    if (room.players[1]?.isBot) {
      room.bot = new BotController(1, seed);
    } else {
      room.bot = null;
    }

    for (const p of room.players) {
      if (p) {
        p.rematchVote = false;
        send(p.ws, {
          type: 'match_start',
          seed,
          config: room.config,
          youIndex: p.index,
        });
      }
    }
    broadcastRoomState(room);

    // Сразу отправляем начальный снапшот
    const initialSnap = createSnapshot(room.match, true);
    for (const p of room.players) {
      if (p) send(p.ws, initialSnap);
    }
  };

  const startCountdownIfReady = (room: Room) => {
    const p0 = room.players[0];
    const p1 = room.players[1];
    if (p0 && p1 && p0.ready && p1.ready && p0.connected && p1.connected) {
      room.state = 'countdown';
      room.countdownRemainingSec = 3.0;
      broadcastRoomState(room);
    }
  };

  const detachSocket = (ws: WebSocket, intentionalLeave = false) => {
    const binding = socketToRoom.get(ws);
    if (!binding) return;
    socketToRoom.delete(ws);

    const { room, playerIndex } = binding;
    const slot = room.players[playerIndex];
    if (!slot || slot.ws !== ws) return;

    slot.ws = null;
    slot.connected = false;
    slot.disconnectedAt = Date.now();
    room.lastActivityAt = Date.now();

    if (intentionalLeave || room.players[1]?.isBot) {
      // Если игрок явно вышел или это тренировка с ботом
      if (room.state === 'playing' || room.state === 'countdown') {
        const otherIndex: 0 | 1 = playerIndex === 0 ? 1 : 0;
        const other = room.players[otherIndex];
        room.state = 'finished';
        if (other && other.ws) {
          send(other.ws, {
            type: 'match_end',
            winner: otherIndex,
            reason: 'forfeit',
            hp: room.match
              ? [room.match.players[0].hp, room.match.players[1].hp]
              : [room.config.maxHp, room.config.maxHp],
          });
        }
      }
      room.players[playerIndex] = null;
      // Если в комнате остался только бот — очищаем комнату
      if (room.players.every((p) => !p || p.isBot)) {
        rooms.delete(room.code);
        return;
      }
      if (room.state !== 'finished') {
        room.state = 'lobby';
      }
      broadcastRoomState(room);
      return;
    }

    // При неожиданном обрыве во время матча/отсчёта ставим на паузу на 30 секунд (раздел 7)
    if (room.state === 'playing' || room.state === 'countdown') {
      room.paused = true;
      room.pauseRemainingSec = room.config.reconnectTimeoutSec;
    } else if (room.state === 'lobby') {
      slot.ready = false;
    }
    broadcastRoomState(room);
  };

  const httpServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          status: 'ok',
          rooms: rooms.size,
          uptimeSec: Math.round(process.uptime()),
        })
      );
      return;
    }

    if (url.pathname === '/api/network-info') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(
        JSON.stringify({
          lanIps: getLanAddresses(),
        })
      );
      return;
    }

    if (staticDir && fs.existsSync(staticDir)) {
      let filePath = path.join(staticDir, url.pathname === '/' ? 'index.html' : url.pathname);
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        // SPA-фолбэк для ссылок /r/ABCDE
        filePath = path.join(staticDir, 'index.html');
      }
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'application/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.ico': 'image/x-icon',
          '.json': 'application/json; charset=utf-8',
        };
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] ?? 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    }

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('DUAL TETRIS Server is running.');
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const vParam = url.searchParams.get('v');
    if (vParam !== null && Number(vParam) !== PROTOCOL_VERSION) {
      socket.destroy();
      return;
    }
    if ('setNoDelay' in socket && typeof socket.setNoDelay === 'function') {
      socket.setNoDelay(true);
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const result = ClientMessageSchema.safeParse(parsedJson);
      if (!result.success) {
        return;
      }

      const msg = result.data;

      if (msg.type === 'ping') {
        send(ws, { type: 'pong', t: msg.t });
        return;
      }

      if (msg.type === 'create_room') {
        detachSocket(ws, true);
        const code = generateRoomCode(new Set(rooms.keys()));
        const token = msg.sessionToken || crypto.randomBytes(16).toString('hex');
        const slot0: PlayerSlot = {
          index: 0,
          name: (msg.name?.trim() || 'Игрок 1').slice(0, 24),
          sessionToken: token,
          ws,
          ready: false,
          connected: true,
          isBot: false,
          rematchVote: false,
          disconnectedAt: null,
          inputTimestamps: [],
        };
        const room: Room = {
          code,
          state: 'lobby',
          players: [slot0, null],
          match: null,
          bot: null,
          countdownRemainingSec: 0,
          paused: false,
          pauseRemainingSec: 0,
          lastActivityAt: Date.now(),
          tickCounter: 0,
          dirtySnapshot: false,
          config,
        };
        rooms.set(code, room);
        socketToRoom.set(ws, { room, playerIndex: 0 });
        console.log(`[Room ${code}] Created by ${slot0.name}`);
        broadcastRoomState(room);
        return;
      }

      if (msg.type === 'start_bot_match') {
        detachSocket(ws, true);
        const code = generateRoomCode(new Set(rooms.keys()));
        const token = crypto.randomBytes(16).toString('hex');
        const slot0: PlayerSlot = {
          index: 0,
          name: (msg.name?.trim() || 'Ты').slice(0, 24),
          sessionToken: token,
          ws,
          ready: true,
          connected: true,
          isBot: false,
          rematchVote: false,
          disconnectedAt: null,
          inputTimestamps: [],
        };
        const slot1: PlayerSlot = {
          index: 1,
          name: 'Бот',
          sessionToken: 'bot',
          ws: null,
          ready: true,
          connected: true,
          isBot: true,
          rematchVote: false,
          disconnectedAt: null,
          inputTimestamps: [],
        };
        const room: Room = {
          code,
          state: 'lobby',
          players: [slot0, slot1],
          match: null,
          bot: null,
          countdownRemainingSec: 0,
          paused: false,
          pauseRemainingSec: 0,
          lastActivityAt: Date.now(),
          tickCounter: 0,
          dirtySnapshot: false,
          config,
        };
        rooms.set(code, room);
        socketToRoom.set(ws, { room, playerIndex: 0 });
        console.log(`[Room ${code}] Bot match started`);
        startMatchInRoom(room);
        return;
      }

      if (msg.type === 'join_room') {
        const cleanCode = msg.code.trim().toUpperCase();
        const room = rooms.get(cleanCode);
        if (!room) {
          send(ws, { type: 'error', code: 'ROOM_NOT_FOUND', message: 'Комната не найдена' });
          return;
        }

        // Проверяем переподключение по sessionToken
        if (msg.sessionToken) {
          for (const slot of room.players) {
            if (slot && !slot.isBot && slot.sessionToken === msg.sessionToken) {
              if (slot.ws && slot.ws !== ws) {
                socketToRoom.delete(slot.ws);
              }
              slot.ws = ws;
              slot.connected = true;
              slot.disconnectedAt = null;
              socketToRoom.set(ws, { room, playerIndex: slot.index });
              room.lastActivityAt = Date.now();

              // Если оба подключены, снимаем паузу
              if (room.players[0]?.connected && room.players[1]?.connected) {
                room.paused = false;
                room.pauseRemainingSec = 0;
              }

              broadcastRoomState(room);
              if (room.match && (room.state === 'playing' || room.state === 'finished')) {
                send(ws, {
                  type: 'match_start',
                  seed: room.match.seed,
                  config: room.config,
                  youIndex: slot.index,
                });
                const snap = createSnapshot(room.match, false);
                snap.paused = room.paused;
                snap.pauseRemainingSec = room.paused ? Math.ceil(room.pauseRemainingSec) : undefined;
                send(ws, snap);
              }
              console.log(`[Room ${cleanCode}] Player ${slot.index} reconnected`);
              return;
            }
          }
        }

        detachSocket(ws, true);

        // Ищем свободный слот (или слот отключившегося в лобби игрока)
        let targetIndex: 0 | 1 | null = null;
        if (!room.players[0] || (room.state === 'lobby' && !room.players[0].connected)) {
          targetIndex = 0;
        } else if (!room.players[1] || (room.state === 'lobby' && !room.players[1].connected)) {
          targetIndex = 1;
        }

        if (targetIndex === null) {
          send(ws, { type: 'error', code: 'ROOM_FULL', message: 'Комната уже заполнена' });
          return;
        }

        const token = msg.sessionToken || crypto.randomBytes(16).toString('hex');
        const newSlot: PlayerSlot = {
          index: targetIndex,
          name: (msg.name?.trim() || `Игрок ${targetIndex + 1}`).slice(0, 24),
          sessionToken: token,
          ws,
          ready: false,
          connected: true,
          isBot: false,
          rematchVote: false,
          disconnectedAt: null,
          inputTimestamps: [],
        };
        room.players[targetIndex] = newSlot;
        room.lastActivityAt = Date.now();
        socketToRoom.set(ws, { room, playerIndex: targetIndex });
        console.log(`[Room ${cleanCode}] Player ${targetIndex} (${newSlot.name}) joined`);
        broadcastRoomState(room);
        return;
      }

      const binding = socketToRoom.get(ws);
      if (!binding) return;
      const { room, playerIndex } = binding;
      const slot = room.players[playerIndex];
      if (!slot) return;
      room.lastActivityAt = Date.now();

      if (msg.type === 'leave') {
        detachSocket(ws, true);
        return;
      }

      if (msg.type === 'ready') {
        if (room.state !== 'lobby' && room.state !== 'countdown') return;
        slot.ready = msg.value;
        if (!slot.ready && room.state === 'countdown') {
          room.state = 'lobby';
          room.countdownRemainingSec = 0;
        }
        broadcastRoomState(room);
        startCountdownIfReady(room);
        return;
      }

      if (msg.type === 'input') {
        if (room.state !== 'playing' || room.paused || !room.match) return;

        // Лимит частоты ввода (не более maxInputsPerSec команд в секунду)
        const now = Date.now();
        slot.inputTimestamps = slot.inputTimestamps.filter((t) => now - t < 1000);
        if (slot.inputTimestamps.length >= room.config.maxInputsPerSec) {
          return;
        }
        slot.inputTimestamps.push(now);

        applyPlayerInput(room.match, playerIndex, msg.a, msg.seq);
        if (msg.a === 'HD') {
          room.dirtySnapshot = true;
        }
        return;
      }

      if (msg.type === 'rematch') {
        if (room.state !== 'finished') return;
        slot.rematchVote = true;
        if (room.players[1]?.isBot) {
          room.players[1].rematchVote = true;
        }
        broadcastRoomState(room);

        if (room.players[0]?.rematchVote && room.players[1]?.rematchVote) {
          startMatchInRoom(room);
        }
        return;
      }
    });

    ws.on('close', () => {
      detachSocket(ws, false);
    });
  });

  // Главный цикл сервера (30 Гц)
  const tickIntervalMs = 1000 / config.serverTickHz;
  const dt = 1 / config.serverTickHz;
  const snapshotEveryTicks = Math.max(1, Math.round(config.serverTickHz / config.snapshotHz));

  const intervalId = setInterval(() => {
    const now = Date.now();

    for (const [code, room] of rooms.entries()) {
      // Удаление пустых комнат через 10 минут
      const hasConnectedHuman = room.players.some((p) => p && !p.isBot && p.connected);
      if (!hasConnectedHuman && now - room.lastActivityAt > room.config.emptyRoomTtlSec * 1000) {
        rooms.delete(code);
        console.log(`[Room ${code}] Removed due to inactivity`);
        continue;
      }

      // Обработка паузы при отключении игрока
      if (room.paused) {
        room.pauseRemainingSec -= dt;
        if (room.pauseRemainingSec <= 0) {
          room.paused = false;
          room.state = 'finished';
          const p0Connected = Boolean(room.players[0]?.connected);
          const p1Connected = Boolean(room.players[1]?.connected);
          const winner: 0 | 1 | null = p0Connected && !p1Connected ? 0 : p1Connected && !p0Connected ? 1 : null;
          for (const p of room.players) {
            if (p) {
              send(p.ws, {
                type: 'match_end',
                winner,
                reason: 'forfeit',
                hp: room.match
                  ? [room.match.players[0].hp, room.match.players[1].hp]
                  : [room.config.maxHp, room.config.maxHp],
              });
            }
          }
          broadcastRoomState(room);
        }
        continue;
      }

      // Отсчёт 3-2-1 перед началом матча
      if (room.state === 'countdown') {
        const prevCeil = Math.ceil(room.countdownRemainingSec);
        room.countdownRemainingSec -= dt;
        const nextCeil = Math.ceil(room.countdownRemainingSec);
        if (room.countdownRemainingSec <= 0) {
          startMatchInRoom(room);
        } else if (nextCeil !== prevCeil) {
          broadcastRoomState(room);
        }
        continue;
      }

      // Симуляция активного матча
      if (room.state === 'playing' && room.match) {
        if (room.bot) {
          room.bot.step(room.match, dt);
        }
        stepMatch(room.match, dt);
        room.tickCounter++;

        const shouldSendSnapshot =
          room.dirtySnapshot ||
          room.tickCounter % snapshotEveryTicks === 0 ||
          room.match.finished;

        if (shouldSendSnapshot) {
          room.dirtySnapshot = false;
          const snap = createSnapshot(room.match, true);
          for (const p of room.players) {
            if (p) send(p.ws, snap);
          }
        }

        if (room.match.finished) {
          room.state = 'finished';
          const endMsg: ServerMessage = {
            type: 'match_end',
            winner: room.match.winner,
            reason: room.match.endReason ?? 'ko',
            hp: [room.match.players[0].hp, room.match.players[1].hp],
          };
          for (const p of room.players) {
            if (p) send(p.ws, endMsg);
          }
          broadcastRoomState(room);
          console.log(
            `[Room ${code}] Match finished in ${room.match.t.toFixed(1)}s. Winner: ${room.match.winner}`
          );
        }
      }
    }
  }, tickIntervalMs);

  const listen = (port = 3000, host = '0.0.0.0'): Promise<number> => {
    return new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(port, host, () => {
        const addr = httpServer.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : port;
        resolve(actualPort);
      });
    });
  };

  // Поддержание WebSocket-соединений через облачные прокси (Render / Railway / Fly.io)
  const wsPingInterval = setInterval(() => {
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.ping();
      }
    }
  }, 20000);

  const close = (): Promise<void> => {
    clearInterval(intervalId);
    clearInterval(wsPingInterval);
    return new Promise((resolve) => {
      for (const client of wss.clients) {
        client.terminate();
      }
      wss.close(() => {
        httpServer.close(() => resolve());
      });
    });
  };

  return {
    httpServer,
    wss,
    rooms,
    listen,
    close,
  };
}
