import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDualTetrisServer, getLanAddresses } from './server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(__dirname, '../../web/dist');
const port = Number(process.env.PORT ?? 3000);

const server = createDualTetrisServer({}, staticDir);

server.listen(port, '0.0.0.0').then((actualPort) => {
  console.log(`==================================================`);
  console.log(`🎮 DUAL TETRIS Server запущен!`);
  console.log(`🏠 Локально:   http://localhost:${actualPort}`);
  for (const ip of getLanAddresses()) {
    console.log(`📱 В Wi-Fi сети (для телефона): http://${ip}:${actualPort}`);
  }
  console.log(`==================================================`);
});
