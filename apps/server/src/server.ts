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
  activateAbility,
  applyPlayerInput,
  createMatch,
  createSnapshot,
  getLeagueByRating,
  stepMatch,
  type AbilitySlots,
  type BotDifficulty,
  type GameConfig,
  type MatchState,
  type OnlinePlayerInfo,
  type OpenChallengeInfo,
  type RoomPlayerInfo,
  type RoomState,
  type ServerMessage,
} from '@dual-tetris/core';
import { ProfileStore } from './store.js';

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
  playerId?: string;
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
  botDifficulty?: BotDifficulty;
  isRanked?: boolean;
  bet: number;
  betReserved: [boolean, boolean];
  countdownRemainingSec: number;
  paused: boolean;
  pauseRemainingSec: number;
  lastActivityAt: number;
  tickCounter: number;
  dirtySnapshot: boolean;
  config: GameConfig;
}

interface MatchmakingEntry {
  ws: WebSocket;
  playerId?: string;
  name: string;
  rating: number;
  bet: number;
  joinedAt: number;
}

export interface DualTetrisServer {
  httpServer: http.Server;
  wss: WebSocketServer;
  rooms: Map<string, Room>;
  store: ProfileStore;
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
  staticDir?: string,
  storeFilePath: string | null = null
): DualTetrisServer {
  const config: GameConfig = {
    ...DEFAULT_CONFIG,
    ...customConfig,
    defaultLoadout: customConfig.defaultLoadout ?? DEFAULT_CONFIG.defaultLoadout,
    abilities: { ...DEFAULT_CONFIG.abilities, ...(customConfig.abilities ?? {}) },
    economy: { ...DEFAULT_CONFIG.economy, ...(customConfig.economy ?? {}) },
    bot: { ...DEFAULT_CONFIG.bot, ...(customConfig.bot ?? {}) },
    touch: { ...DEFAULT_CONFIG.touch, ...(customConfig.touch ?? {}) },
  };

  const store = new ProfileStore(config, storeFilePath);
  const rooms = new Map<string, Room>();
  const socketToRoom = new Map<WebSocket, { room: Room; playerIndex: 0 | 1 }>();
  const socketToPlayerId = new Map<WebSocket, string>();
  const playerIdToSocket = new Map<string, WebSocket>();
  const openChallenges = new Map<string, { info: OpenChallengeInfo; hostWs: WebSocket }>();
  const matchmakingQueue: MatchmakingEntry[] = [];

  const send = (ws: WebSocket | null, msg: ServerMessage) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  };

  const buildArenaState = (): Extract<ServerMessage, { type: 'arena_state' }> => {
    const challenges: OpenChallengeInfo[] = [];
    for (const [cid, ch] of openChallenges.entries()) {
      if (ch.hostWs.readyState !== WebSocket.OPEN) {
        openChallenges.delete(cid);
        continue;
      }
      if (!ch.info.targetPlayerId) {
        challenges.push({ ...ch.info });
      }
    }

    const onlinePlayers: OnlinePlayerInfo[] = [];
    for (const [pid, sock] of playerIdToSocket.entries()) {
      if (sock.readyState !== WebSocket.OPEN) continue;
      const prof = store.getOrCreateProfile(pid);
      const binding = socketToRoom.get(sock);
      onlinePlayers.push({
        playerId: prof.playerId,
        name: prof.name,
        avatar: prof.avatar,
        rating: prof.rating,
        league: prof.league,
        inMatch: Boolean(binding && binding.room.state === 'playing'),
      });
    }

    return {
      type: 'arena_state',
      challenges,
      onlinePlayers,
    };
  };

  const broadcastArenaState = () => {
    const stateMsg = buildArenaState();
    for (const client of wss.clients) {
      send(client, stateMsg);
    }
  };

  const removeChallengesBySocket = (ws: WebSocket) => {
    let removed = false;
    for (const [cid, ch] of openChallenges.entries()) {
      if (ch.hostWs === ws) {
        openChallenges.delete(cid);
        removed = true;
      }
    }
    if (removed) broadcastArenaState();
  };

  const removeFromMatchmaking = (ws: WebSocket) => {
    const idx = matchmakingQueue.findIndex((e) => e.ws === ws);
    if (idx !== -1) {
      matchmakingQueue.splice(idx, 1);
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
          bet: room.bet,
          countdownSec: room.state === 'countdown' ? Math.ceil(room.countdownRemainingSec) : undefined,
          paused: room.paused,
          pauseRemainingSec: room.paused ? Math.ceil(room.pauseRemainingSec) : undefined,
        });
      }
    }
  };

  const startMatchInRoom = (room: Room) => {
    // Если назначена ставка Coin Duel — резервируем монеты у игроков
    room.betReserved = [false, false];
    if (room.bet > 0) {
      for (const idx of [0, 1] as const) {
        const p = room.players[idx];
        if (p && !p.isBot) {
          if (!store.canAffordBet(p.playerId, room.bet)) {
            room.state = 'lobby';
            for (const pl of room.players) {
              if (pl) {
                pl.ready = false;
                send(pl.ws, {
                  type: 'error',
                  code: 'NOT_ENOUGH_COINS_FOR_BET',
                  message: `Недостаточно монет для ставки ${room.bet} 🪙`,
                });
              }
            }
            broadcastRoomState(room);
            return;
          }
        }
      }
      for (const idx of [0, 1] as const) {
        const p = room.players[idx];
        if (p && !p.isBot && p.playerId) {
          room.betReserved[idx] = store.reserveBet(p.playerId, room.bet, room.code);
          send(p.ws, { type: 'profile', profile: store.getOrCreateProfile(p.playerId) });
        } else if (p && p.isBot) {
          room.betReserved[idx] = true;
        }
      }
    }

    const seed = Math.floor(Math.random() * 0x7fffffff) || 1;
    const p0Slots = store.getMatchAbilitySlots(room.players[0]?.playerId);
    let p1Slots = store.getMatchAbilitySlots(room.players[1]?.playerId);
    let p1MaxHp = room.config.maxHp;

    if (room.players[1]?.isBot) {
      const diff = room.botDifficulty ?? 'medium';
      const diffProfile = room.config.bot.difficulties?.[diff];
      if (diffProfile) {
        p1Slots = diffProfile.loadout.map((s) => ({ ...s })) as AbilitySlots;
        p1MaxHp = diffProfile.maxHp;
      }
      room.bot = new BotController(1, seed, diff);
    } else {
      room.bot = null;
    }

    room.match = createMatch(
      seed,
      room.config,
      [p0Slots, p1Slots],
      [room.config.maxHp, p1MaxHp]
    );
    room.state = 'playing';
    room.paused = false;
    room.pauseRemainingSec = 0;
    room.tickCounter = 0;
    room.lastActivityAt = Date.now();

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
        const isBotMatch = Boolean(room.players[1]?.isBot);
        const res = store.recordMatchResult(
          [room.players[0]?.playerId, room.players[1]?.playerId],
          otherIndex,
          isBotMatch,
          room.botDifficulty ?? 'medium',
          {
            playerNames: [
              room.players[0]?.name ?? 'Игрок 1',
              room.players[1]?.name ?? 'Игрок 2',
            ],
            finalHps: room.match
              ? [room.match.players[0].hp, room.match.players[1].hp]
              : [0, room.config.maxHp],
            bet: room.bet,
            betReserved: room.betReserved,
            isRanked: room.isRanked,
          }
        );
        if (other && other.ws) {
          send(other.ws, {
            type: 'match_end',
            winner: otherIndex,
            reason: 'forfeit',
            hp: room.match
              ? [room.match.players[0].hp, room.match.players[1].hp]
              : [room.config.maxHp, room.config.maxHp],
            coinsEarned: res.coinsEarned,
            xpEarned: res.xpEarned,
            ratingDelta: res.ratingDelta,
            newRating: res.newRating,
            betPot: res.betPot,
          });
          if (other.playerId) {
            send(other.ws, { type: 'profile', profile: store.getOrCreateProfile(other.playerId) });
          }
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

      if (msg.type === 'auth_profile') {
        const profile = store.getOrCreateProfile(msg.playerId, msg.name, msg.avatar);
        socketToPlayerId.set(ws, profile.playerId);
        playerIdToSocket.set(profile.playerId, ws);
        send(ws, { type: 'profile', profile });
        broadcastArenaState();
        return;
      }

      if (msg.type === 'equip_loadout') {
        const pid = socketToPlayerId.get(ws);
        if (!pid) {
          send(ws, { type: 'error', code: 'PROFILE_NOT_FOUND' });
          return;
        }
        const res = store.equipLoadout(pid, msg.loadout);
        if (!res.ok) {
          send(ws, { type: 'error', code: res.errorCode });
          return;
        }
        send(ws, { type: 'profile', profile: res.profile });
        return;
      }

      if (msg.type === 'open_chest') {
        const pid = socketToPlayerId.get(ws);
        if (!pid) {
          send(ws, { type: 'error', code: 'PROFILE_NOT_FOUND' });
          return;
        }
        const res = store.openChest(pid, msg.chestId, msg.requestId);
        if (!res.ok) {
          send(ws, { type: 'error', code: res.errorCode });
          return;
        }
        send(ws, {
          type: 'chest_opened',
          reward: res.reward,
          profile: res.profile,
        });
        return;
      }

      if (msg.type === 'watch_rewarded_ad') {
        const pid = socketToPlayerId.get(ws);
        if (!pid) {
          send(ws, { type: 'error', code: 'PROFILE_NOT_FOUND' });
          return;
        }
        const res = store.watchRewardedAd(pid, msg.requestId);
        if (!res.ok) {
          send(ws, { type: 'error', code: res.errorCode });
          return;
        }
        send(ws, { type: 'profile', profile: res.profile });
        return;
      }

      if (msg.type === 'claim_daily_quest') {
        const pid = socketToPlayerId.get(ws);
        if (!pid) {
          send(ws, { type: 'error', code: 'PROFILE_NOT_FOUND' });
          return;
        }
        const res = store.claimDailyQuest(pid, msg.questId, msg.requestId);
        if (!res.ok) {
          send(ws, { type: 'error', code: res.errorCode });
          return;
        }
        send(ws, { type: 'profile', profile: res.profile });
        return;
      }

      if (msg.type === 'buy_or_equip_skin') {
        const pid = socketToPlayerId.get(ws);
        if (!pid) {
          send(ws, { type: 'error', code: 'PROFILE_NOT_FOUND' });
          return;
        }
        const res = store.buyOrEquipSkin(pid, msg.skinId, msg.requestId);
        if (!res.ok) {
          send(ws, { type: 'error', code: res.errorCode });
          return;
        }
        send(ws, { type: 'profile', profile: res.profile });
        return;
      }

      if (msg.type === 'get_leaderboard') {
        const entries = store.getLeaderboard(15).map((e) => ({
          ...e,
          online: playerIdToSocket.has(e.playerId),
        }));
        send(ws, { type: 'leaderboard', entries });
        return;
      }

      if (msg.type === 'get_arena_state') {
        send(ws, buildArenaState());
        return;
      }

      if (msg.type === 'create_challenge') {
        const pid = socketToPlayerId.get(ws);
        if (!pid) {
          send(ws, { type: 'error', code: 'PROFILE_NOT_FOUND' });
          return;
        }
        const bet = msg.bet ?? 0;
        if (!config.economy.coinDuelBets.includes(bet)) {
          send(ws, { type: 'error', code: 'INVALID_BET', message: 'Недопустимая ставка' });
          return;
        }
        if (!store.canAffordBet(pid, bet)) {
          send(ws, {
            type: 'error',
            code: 'NOT_ENOUGH_COINS_FOR_BET',
            message: `Недостаточно монет для ставки ${bet} 🪙`,
          });
          return;
        }
        removeChallengesBySocket(ws);
        const prof = store.getOrCreateProfile(pid);
        const cid = `ch_${crypto.randomBytes(6).toString('hex')}`;
        openChallenges.set(cid, {
          hostWs: ws,
          info: {
            id: cid,
            hostPlayerId: prof.playerId,
            hostName: prof.name,
            hostAvatar: prof.avatar,
            hostRating: prof.rating,
            hostLeague: prof.league,
            bet,
            createdAt: Date.now(),
          },
        });
        broadcastArenaState();
        return;
      }

      if (msg.type === 'cancel_challenge') {
        removeChallengesBySocket(ws);
        return;
      }

      if (msg.type === 'send_direct_duel') {
        const pid = socketToPlayerId.get(ws);
        if (!pid) {
          send(ws, { type: 'error', code: 'PROFILE_NOT_FOUND' });
          return;
        }
        if (pid === msg.targetPlayerId) return;
        const bet = msg.bet ?? 0;
        if (!config.economy.coinDuelBets.includes(bet)) {
          send(ws, { type: 'error', code: 'INVALID_BET', message: 'Недопустимая ставка' });
          return;
        }
        if (!store.canAffordBet(pid, bet)) {
          send(ws, {
            type: 'error',
            code: 'NOT_ENOUGH_COINS_FOR_BET',
            message: `Недостаточно монет для ставки ${bet} 🪙`,
          });
          return;
        }
        const targetWs = playerIdToSocket.get(msg.targetPlayerId);
        if (!targetWs || targetWs.readyState !== WebSocket.OPEN) {
          send(ws, {
            type: 'error',
            code: 'TARGET_OFFLINE',
            message: 'Этот игрок сейчас не в сети',
          });
          return;
        }
        const targetBinding = socketToRoom.get(targetWs);
        if (targetBinding && targetBinding.room.state === 'playing') {
          send(ws, {
            type: 'error',
            code: 'TARGET_BUSY',
            message: 'Игрок сейчас находится в другом бою',
          });
          return;
        }

        const prof = store.getOrCreateProfile(pid);
        const cid = `duel_${crypto.randomBytes(6).toString('hex')}`;
        const info: OpenChallengeInfo = {
          id: cid,
          hostPlayerId: prof.playerId,
          hostName: prof.name,
          hostAvatar: prof.avatar,
          hostRating: prof.rating,
          hostLeague: prof.league,
          bet,
          targetPlayerId: msg.targetPlayerId,
          createdAt: Date.now(),
        };
        openChallenges.set(cid, { hostWs: ws, info });
        send(targetWs, { type: 'incoming_duel', challenge: info });
        return;
      }

      if (msg.type === 'decline_direct_duel') {
        const ch = openChallenges.get(msg.challengeId);
        if (ch) {
          openChallenges.delete(msg.challengeId);
          const pid = socketToPlayerId.get(ws);
          const prof = pid ? store.getOrCreateProfile(pid) : null;
          send(ch.hostWs, {
            type: 'duel_declined',
            byName: prof?.name ?? 'Игрок',
          });
        }
        return;
      }

      if (msg.type === 'accept_challenge') {
        const pid = socketToPlayerId.get(ws);
        if (!pid) {
          send(ws, { type: 'error', code: 'PROFILE_NOT_FOUND' });
          return;
        }
        const ch = openChallenges.get(msg.challengeId);
        if (!ch || ch.hostWs.readyState !== WebSocket.OPEN) {
          openChallenges.delete(msg.challengeId);
          broadcastArenaState();
          send(ws, {
            type: 'error',
            code: 'CHALLENGE_EXPIRED',
            message: 'Вызов уже неактуален',
          });
          return;
        }
        if (ch.hostWs === ws || ch.info.hostPlayerId === pid) return;

        const bet = ch.info.bet;
        if (!store.canAffordBet(pid, bet)) {
          send(ws, {
            type: 'error',
            code: 'NOT_ENOUGH_COINS_FOR_BET',
            message: `Недостаточно монет для принятия ставки ${bet} 🪙`,
          });
          return;
        }
        if (!store.canAffordBet(ch.info.hostPlayerId, bet)) {
          openChallenges.delete(msg.challengeId);
          broadcastArenaState();
          send(ws, {
            type: 'error',
            code: 'CHALLENGE_EXPIRED',
            message: 'У создателя вызова недостаточно монет',
          });
          return;
        }

        openChallenges.delete(msg.challengeId);
        removeChallengesBySocket(ch.hostWs);
        removeChallengesBySocket(ws);
        removeFromMatchmaking(ch.hostWs);
        removeFromMatchmaking(ws);
        detachSocket(ch.hostWs, true);
        detachSocket(ws, true);

        const guestProf = store.getOrCreateProfile(pid);
        const code = generateRoomCode(new Set(rooms.keys()));
        const slot0: PlayerSlot = {
          index: 0,
          playerId: ch.info.hostPlayerId,
          name: ch.info.hostName,
          sessionToken: crypto.randomBytes(16).toString('hex'),
          ws: ch.hostWs,
          ready: true,
          connected: true,
          isBot: false,
          rematchVote: false,
          disconnectedAt: null,
          inputTimestamps: [],
        };
        const slot1: PlayerSlot = {
          index: 1,
          playerId: guestProf.playerId,
          name: guestProf.name,
          sessionToken: crypto.randomBytes(16).toString('hex'),
          ws,
          ready: true,
          connected: true,
          isBot: false,
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
          isRanked: true,
          bet,
          betReserved: [false, false],
          countdownRemainingSec: 0,
          paused: false,
          pauseRemainingSec: 0,
          lastActivityAt: Date.now(),
          tickCounter: 0,
          dirtySnapshot: false,
          config,
        };
        rooms.set(code, room);
        socketToRoom.set(ch.hostWs, { room, playerIndex: 0 });
        socketToRoom.set(ws, { room, playerIndex: 1 });
        startMatchInRoom(room);
        broadcastArenaState();
        return;
      }

      if (msg.type === 'start_ranked_bot') {
        const pid = socketToPlayerId.get(ws);
        const bet = msg.bet ?? 0;
        if (!config.economy.coinDuelBets.includes(bet)) {
          send(ws, { type: 'error', code: 'INVALID_BET', message: 'Недопустимая ставка' });
          return;
        }
        if (pid && !store.canAffordBet(pid, bet)) {
          send(ws, {
            type: 'error',
            code: 'NOT_ENOUGH_COINS_FOR_BET',
            message: `Недостаточно монет для ставки ${bet} 🪙`,
          });
          return;
        }
        removeChallengesBySocket(ws);
        removeFromMatchmaking(ws);
        detachSocket(ws, true);

        const prof = pid ? store.getOrCreateProfile(pid) : null;
        const rating = prof?.rating ?? config.economy.startingRating;
        const leagueDef = getLeagueByRating(rating, config);
        const diff = leagueDef.botDifficulty;
        const rivalNames = ['КиберТетрис', 'НеонБлок', 'МастерЛиний', 'ШтормВолн', 'КриоСтраж'];
        const rivalName = `${leagueDef.icon} ${rivalNames[Math.floor(Math.random() * rivalNames.length)]}`;
        const code = generateRoomCode(new Set(rooms.keys()));

        const slot0: PlayerSlot = {
          index: 0,
          playerId: pid,
          name: prof?.name ?? 'Игрок',
          sessionToken: crypto.randomBytes(16).toString('hex'),
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
          name: rivalName,
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
          botDifficulty: diff,
          isRanked: true,
          bet,
          betReserved: [false, false],
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
        startMatchInRoom(room);
        broadcastArenaState();
        return;
      }

      if (msg.type === 'cancel_matchmaking') {
        removeFromMatchmaking(ws);
        send(ws, { type: 'matchmaking_status', searching: false, bet: 0 });
        return;
      }

      if (msg.type === 'find_match') {
        removeFromMatchmaking(ws);
        detachSocket(ws, true);
        const bet = msg.bet ?? 0;
        if (!config.economy.coinDuelBets.includes(bet)) {
          send(ws, { type: 'error', code: 'INVALID_BET', message: 'Недопустимая ставка' });
          return;
        }
        const pid = msg.playerId || socketToPlayerId.get(ws);
        let rating = config.economy.startingRating;
        if (pid) {
          const prof = store.getOrCreateProfile(pid, msg.name);
          socketToPlayerId.set(ws, prof.playerId);
          rating = prof.rating;
          if (!store.canAffordBet(prof.playerId, bet)) {
            send(ws, {
              type: 'error',
              code: 'NOT_ENOUGH_COINS_FOR_BET',
              message: `Недостаточно монет для ставки ${bet} 🪙`,
            });
            return;
          }
        }

        // Проверяем, ждёт ли уже в очереди живой соперник с такой же ставкой
        const matchIdx = matchmakingQueue.findIndex((e) => e.bet === bet && e.ws !== ws);
        if (matchIdx !== -1) {
          const opp = matchmakingQueue.splice(matchIdx, 1)[0];
          send(opp.ws, { type: 'matchmaking_status', searching: false, bet });
          send(ws, { type: 'matchmaking_status', searching: false, bet });

          const code = generateRoomCode(new Set(rooms.keys()));
          const slot0: PlayerSlot = {
            index: 0,
            playerId: opp.playerId,
            name: opp.name,
            sessionToken: crypto.randomBytes(16).toString('hex'),
            ws: opp.ws,
            ready: true,
            connected: true,
            isBot: false,
            rematchVote: false,
            disconnectedAt: null,
            inputTimestamps: [],
          };
          const slot1: PlayerSlot = {
            index: 1,
            playerId: pid,
            name: (msg.name?.trim() || 'Игрок 2').slice(0, 24),
            sessionToken: crypto.randomBytes(16).toString('hex'),
            ws,
            ready: true,
            connected: true,
            isBot: false,
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
            isRanked: true,
            bet,
            betReserved: [false, false],
            countdownRemainingSec: 0,
            paused: false,
            pauseRemainingSec: 0,
            lastActivityAt: Date.now(),
            tickCounter: 0,
            dirtySnapshot: false,
            config,
          };
          rooms.set(code, room);
          socketToRoom.set(opp.ws, { room, playerIndex: 0 });
          socketToRoom.set(ws, { room, playerIndex: 1 });
          startMatchInRoom(room);
          return;
        }

        matchmakingQueue.push({
          ws,
          playerId: pid,
          name: (msg.name?.trim() || 'Игрок').slice(0, 24),
          rating,
          bet,
          joinedAt: Date.now(),
        });
        send(ws, { type: 'matchmaking_status', searching: true, bet });
        return;
      }

      if (msg.type === 'create_room') {
        removeFromMatchmaking(ws);
        detachSocket(ws, true);
        const code = generateRoomCode(new Set(rooms.keys()));
        const token = msg.sessionToken || crypto.randomBytes(16).toString('hex');
        const pid = msg.playerId || socketToPlayerId.get(ws);
        if (pid) {
          const prof = store.getOrCreateProfile(pid, msg.name);
          socketToPlayerId.set(ws, prof.playerId);
        }
        const slot0: PlayerSlot = {
          index: 0,
          playerId: pid,
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
          isRanked: true,
          bet: 0,
          betReserved: [false, false],
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
        const difficulty: BotDifficulty = msg.difficulty ?? 'medium';
        const pid = msg.playerId || socketToPlayerId.get(ws);
        if (pid) {
          const prof = store.getOrCreateProfile(pid, msg.name);
          socketToPlayerId.set(ws, prof.playerId);
          if (difficulty === 'boss') {
            const attemptRes = store.consumeBossAttempt(prof.playerId);
            if (!attemptRes.ok) {
              send(ws, {
                type: 'error',
                code: attemptRes.errorCode,
                message: 'Попытки на Босса сегодня закончились! Посмотри рекламу для +1 попытки.',
              });
              return;
            }
            send(ws, { type: 'profile', profile: attemptRes.profile });
          }
        }
        detachSocket(ws, true);
        const code = generateRoomCode(new Set(rooms.keys()));
        const token = crypto.randomBytes(16).toString('hex');
        const diffProfile = config.bot.difficulties?.[difficulty];
        const slot0: PlayerSlot = {
          index: 0,
          playerId: pid,
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
          name: diffProfile ? diffProfile.name : 'Бот',
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
          botDifficulty: difficulty,
          isRanked: false,
          bet: 0,
          betReserved: [false, false],
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
        console.log(`[Room ${code}] Bot match (${difficulty}) started`);
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
        const pid = msg.playerId || socketToPlayerId.get(ws);
        if (pid) {
          const prof = store.getOrCreateProfile(pid, msg.name);
          socketToPlayerId.set(ws, prof.playerId);
        }
        const newSlot: PlayerSlot = {
          index: targetIndex,
          playerId: pid,
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

      if (msg.type === 'set_room_bet') {
        if (room.state !== 'lobby') return;
        if (!room.config.economy.coinDuelBets.includes(msg.bet)) {
          send(ws, { type: 'error', code: 'INVALID_BET', message: 'Недопустимая ставка' });
          return;
        }
        if (!store.canAffordBet(slot.playerId, msg.bet)) {
          send(ws, {
            type: 'error',
            code: 'NOT_ENOUGH_COINS_FOR_BET',
            message: `Недостаточно монет для ставки ${msg.bet} 🪙`,
          });
          return;
        }
        room.bet = msg.bet;
        for (const p of room.players) {
          if (p && !p.isBot) p.ready = false;
        }
        broadcastRoomState(room);
        return;
      }

      if (msg.type === 'ready') {
        if (room.state !== 'lobby' && room.state !== 'countdown') return;
        if (msg.value && room.bet > 0 && !store.canAffordBet(slot.playerId, room.bet)) {
          send(ws, {
            type: 'error',
            code: 'NOT_ENOUGH_COINS_FOR_BET',
            message: `Недостаточно монет для ставки ${room.bet} 🪙`,
          });
          return;
        }
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

      if (msg.type === 'activate_ability') {
        if (room.state !== 'playing' || room.paused || !room.match) {
          send(ws, { type: 'error', code: 'MATCH_NOT_PLAYING' });
          return;
        }
        const res = activateAbility(room.match, playerIndex, msg.slotIndex, msg.requestId);
        if (!res.ok) {
          send(ws, { type: 'error', code: res.errorCode });
          return;
        }
        store.recordAbilityUsed(slot.playerId, res.ability.id);
        room.dirtySnapshot = true;
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
      removeChallengesBySocket(ws);
      removeFromMatchmaking(ws);
      const pid = socketToPlayerId.get(ws);
      if (pid && playerIdToSocket.get(pid) === ws) {
        playerIdToSocket.delete(pid);
      }
      socketToPlayerId.delete(ws);
      detachSocket(ws, false);
      broadcastArenaState();
    });
  });

  // Главный цикл сервера (30 Гц)
  const tickIntervalMs = 1000 / config.serverTickHz;
  const dt = 1 / config.serverTickHz;
  const snapshotEveryTicks = Math.max(1, Math.round(config.serverTickHz / config.snapshotHz));

  const intervalId = setInterval(() => {
    const now = Date.now();

    // Проверка очереди автоподбора (если прошло matchmakingTimeoutMs — подбираем рейтингового соперника по лиге)
    for (let i = matchmakingQueue.length - 1; i >= 0; i--) {
      const entry = matchmakingQueue[i];
      if (entry.ws.readyState !== WebSocket.OPEN) {
        matchmakingQueue.splice(i, 1);
        continue;
      }
      if (now - entry.joinedAt >= config.economy.matchmakingTimeoutMs) {
        matchmakingQueue.splice(i, 1);
        send(entry.ws, { type: 'matchmaking_status', searching: false, bet: entry.bet });

        const leagueDef = getLeagueByRating(entry.rating, config);
        const diff = leagueDef.botDifficulty;
        const rivalNames = ['КиберТетрис', 'НеонБлок', 'МастерЛиний', 'ШтормВолн', 'КриоСтраж'];
        const rivalName = `${leagueDef.icon} ${rivalNames[Math.floor(Math.random() * rivalNames.length)]}`;
        const code = generateRoomCode(new Set(rooms.keys()));

        const slot0: PlayerSlot = {
          index: 0,
          playerId: entry.playerId,
          name: entry.name,
          sessionToken: crypto.randomBytes(16).toString('hex'),
          ws: entry.ws,
          ready: true,
          connected: true,
          isBot: false,
          rematchVote: false,
          disconnectedAt: null,
          inputTimestamps: [],
        };
        const slot1: PlayerSlot = {
          index: 1,
          name: rivalName,
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
          botDifficulty: diff,
          isRanked: true,
          bet: entry.bet,
          betReserved: [false, false],
          countdownRemainingSec: 0,
          paused: false,
          pauseRemainingSec: 0,
          lastActivityAt: now,
          tickCounter: 0,
          dirtySnapshot: false,
          config,
        };
        rooms.set(code, room);
        socketToRoom.set(entry.ws, { room, playerIndex: 0 });
        startMatchInRoom(room);
      }
    }

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
          const isBotMatch = Boolean(room.players[1]?.isBot);
          const {
            coinsEarned,
            xpEarned,
            ratingDelta,
            newRating,
            betPot,
            bonusChestReward,
          } = store.recordMatchResult(
            [room.players[0]?.playerId, room.players[1]?.playerId],
            room.match.winner,
            isBotMatch,
            room.botDifficulty ?? 'medium',
            {
              playerNames: [
                room.players[0]?.name ?? 'Игрок 1',
                room.players[1]?.name ?? 'Игрок 2',
              ],
              finalHps: [room.match.players[0].hp, room.match.players[1].hp],
              bet: room.bet,
              betReserved: room.betReserved,
              isRanked: room.isRanked,
            }
          );
          const endMsg: ServerMessage = {
            type: 'match_end',
            winner: room.match.winner,
            reason: room.match.endReason ?? 'ko',
            hp: [room.match.players[0].hp, room.match.players[1].hp],
            coinsEarned,
            xpEarned,
            ratingDelta,
            newRating,
            betPot,
            bonusChestReward,
          };
          for (const p of room.players) {
            if (p) {
              send(p.ws, endMsg);
              if (p.playerId) {
                send(p.ws, {
                  type: 'profile',
                  profile: store.getOrCreateProfile(p.playerId),
                });
              }
            }
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
    store,
    listen,
    close,
  };
}
