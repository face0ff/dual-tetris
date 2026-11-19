import { spawn } from 'node:child_process';

// Держим stdin открытым ('pipe'), чтобы Windows OpenSSH не закрывал канал по EOF
const child = spawn(
  'ssh.exe',
  [
    '-T',
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    'UserKnownHostsFile=NUL',
    '-o',
    'ServerAliveInterval=20',
    '-o',
    'ExitOnForwardFailure=yes',
    '-R',
    '80:127.0.0.1:3000',
    'nokey@localhost.run',
  ],
  {
    stdio: ['pipe', 'inherit', 'inherit'],
  }
);

child.on('exit', (code) => {
  console.log(`Tunnel exited with code ${code}`);
  process.exit(code ?? 0);
});
