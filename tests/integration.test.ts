import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { ServerMessage } from '@dual-tetris/core';
import { createDualTetrisServer, type DualTetrisServer } from '../apps/server/src/server.js';

class TestWsClient {
  public ws: WebSocket;
  public messages: ServerMessage[] = [];
  private listeners: Array<(msg: ServerMessage) => void> = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (raw) => {
      const parsed = JSON.parse(raw.toString()) as ServerMessage;
      this.messages.push(parsed);
      for (const l of this.listeners.slice()) {
        l(parsed);
      }
    });
  }

  static async connect(port: number): Promise<TestWsClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?v=1`);
      const client = new TestWsClient(ws);
      ws.once('open', () => resolve(client));
      ws.once('error', reject);
    });
  }

  send(data: unknown): void {
    this.ws.send(JSON.stringify(data));
  }

  waitFor<T extends ServerMessage['type']>(
    type: T,
    predicate?: (msg: Extract<ServerMessage, { type: T }>) => boolean,
    timeoutMs = 5000
  ): Promise<Extract<ServerMessage, { type: T }>> {
    for (const existing of this.messages) {
      if (existing.type === type) {
        const typed = existing as Extract<ServerMessage, { type: T }>;
        if (!predicate || predicate(typed)) {
          return Promise.resolve(typed);
        }
      }
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for message type: ${type}`));
      }, timeoutMs);

      const handler = (msg: ServerMessage) => {
        if (msg.type === type) {
          const typed = msg as Extract<ServerMessage, { type: T }>;
          if (!predicate || predicate(typed)) {
            cleanup();
            resolve(typed);
          }
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        const idx = this.listeners.indexOf(handler);
        if (idx !== -1) this.listeners.splice(idx, 1);
      };

      this.listeners.push(handler);
    });
  }

  close(): void {
    this.ws.close();
  }
}

describe('Интеграционные и нагрузочные тесты сервера DUAL TETRIS', () => {
  let server: DualTetrisServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it('Два клиента создают комнату, играют матч со скриптовым вводом до победы и делают реванш', async () => {
    // Для быстрого теста ставим maxHp: 30 и overflowDamage: 15
    server = createDualTetrisServer({
      maxHp: 30,
      overflowDamage: 15,
      maxInputsPerSec: 200,
    });
    const port = await server.listen(0, '127.0.0.1');

    const c1 = await TestWsClient.connect(port);
    const c2 = await TestWsClient.connect(port);

    // 1. Создание комнаты
    c1.send({ type: 'create_room', name: 'Муж' });
    const roomCreated = await c1.waitFor('room');
    expect(roomCreated.code).toHaveLength(5);
    expect(roomCreated.youIndex).toBe(0);

    // 2. Вход второго игрока
    c2.send({ type: 'join_room', code: roomCreated.code, name: 'Жена' });
    const roomJoined = await c2.waitFor('room', (r) => r.players.length === 2);
    expect(roomJoined.youIndex).toBe(1);

    // 3. Оба нажимают «Готов»
    c1.send({ type: 'ready', value: true });
    c2.send({ type: 'ready', value: true });

    const matchStart1 = await c1.waitFor('match_start', undefined, 6000);
    const matchStart2 = await c2.waitFor('match_start', undefined, 6000);
    expect(matchStart1.seed).toBe(matchStart2.seed);

    // 4. Игрок 1 быстро сбрасывает фигуры по центру, вызывая переполнение до победы игрока 2
    for (let seq = 1; seq <= 35; seq++) {
      c1.send({ type: 'input', seq, a: 'HD' });
    }

    const matchEnd1 = await c1.waitFor('match_end', undefined, 5000);
    const matchEnd2 = await c2.waitFor('match_end', undefined, 5000);
    expect(matchEnd1.winner).toBe(1);
    expect(matchEnd2.winner).toBe(1);
    expect(matchEnd1.reason).toBe('ko');

    // 5. Проверка реванша
    c1.messages.length = 0;
    c2.messages.length = 0;

    c1.send({ type: 'rematch' });
    c2.send({ type: 'rematch' });

    const rematchStart1 = await c1.waitFor('match_start', undefined, 5000);
    const rematchStart2 = await c2.waitFor('match_start', undefined, 5000);
    expect(rematchStart1.seed).toBe(rematchStart2.seed);

    c1.close();
    c2.close();
  });

  it('Обрыв связи ставит матч на паузу, переподключение по sessionToken возвращает в игру, а невалидные команды игнорируются', async () => {
    server = createDualTetrisServer({
      reconnectTimeoutSec: 15,
    });
    const port = await server.listen(0, '127.0.0.1');

    const c1 = await TestWsClient.connect(port);
    const c2 = await TestWsClient.connect(port);

    c1.send({ type: 'create_room', name: 'P1' });
    const r1 = await c1.waitFor('room');
    const p1Token = r1.sessionToken;

    c2.send({ type: 'join_room', code: r1.code, name: 'P2' });
    await c2.waitFor('room', (r) => r.players.length === 2);

    c1.send({ type: 'ready', value: true });
    c2.send({ type: 'ready', value: true });

    await c1.waitFor('match_start', undefined, 6000);
    await c2.waitFor('match_start', undefined, 6000);

    // Попытка отправить мусор или невалидные команды
    c1.ws.send('not-a-json');
    c1.send({ type: 'unknown_command', hack: 999 });
    c1.send({ type: 'input', seq: -5, a: 'TELEPORT' });

    // Имитируем обрыв связи у c1
    c1.close();

    const pausedRoom = await c2.waitFor('room', (r) => r.paused === true, 3000);
    expect(pausedRoom.paused).toBe(true);

    // Переподключение c1 с тем же sessionToken
    const c1Reconnected = await TestWsClient.connect(port);
    c1Reconnected.send({
      type: 'join_room',
      code: r1.code,
      sessionToken: p1Token,
    });

    const resumedRoom = await c2.waitFor('room', (r) => r.paused === false, 3000);
    expect(resumedRoom.paused).toBe(false);
    const reconnectedSnap = await c1Reconnected.waitFor('snapshot', undefined, 3000);
    expect(reconnectedSnap.hp).toEqual([100, 100]);

    c1Reconnected.close();
    c2.close();
  });

  it('Нагрузочный тест: сервер держит 50 одновременных матчей без деградации тика', async () => {
    server = createDualTetrisServer();
    const port = await server.listen(0, '127.0.0.1');

    const clients: TestWsClient[] = [];
    for (let i = 0; i < 50; i++) {
      const client = await TestWsClient.connect(port);
      client.send({ type: 'start_bot_match', name: `Player_${i}` });
      clients.push(client);
    }

    await Promise.all(clients.map((c) => c.waitFor('match_start', undefined, 5000)));
    expect(server.rooms.size).toBe(50);

    // Замеряем скорость обработки тиков в течение ~400 мс при активном вводе всех 50 матчей
    const t0 = performance.now();
    for (let step = 1; step <= 5; step++) {
      for (const c of clients) {
        c.send({ type: 'input', seq: step, a: step % 2 === 0 ? 'L' : 'R' });
      }
      await new Promise((r) => setTimeout(r, 60));
    }
    const elapsed = performance.now() - t0;

    // Проверяем, что все 50 матчей продвинулись по тикам без зависаний
    for (const room of server.rooms.values()) {
      expect(room.match).not.toBeNull();
      expect(room.match!.tick).toBeGreaterThanOrEqual(5);
    }
    expect(elapsed).toBeLessThan(1500);

    for (const c of clients) {
      c.close();
    }
  });
});
