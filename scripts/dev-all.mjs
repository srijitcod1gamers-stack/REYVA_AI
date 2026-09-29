import { spawn } from 'node:child_process';

const services = [
  {
    name: 'frontend',
    args: ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'],
  },
  {
    name: 'worker',
    args: ['node_modules/wrangler/wrangler-dist/cli.js', 'dev', '--config', 'cloudflare/wrangler.toml'],
  },
];

let stopping = false;
const children = services.map(({ name, args }) => {
  console.log(`[dev:all] Starting ${name}...`);
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  child.on('error', (error) => {
    console.error(`[dev:all] ${name} failed to start: ${error.message}`);
    stop(1);
  });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`[dev:all] ${name} stopped${signal ? ` (${signal})` : ` with code ${code ?? 1}`}.`);
    stop(code ?? 1);
  });
  return child;
});

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(exitCode), 500);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

console.log('[dev:all] Frontend: http://127.0.0.1:5173');
console.log('[dev:all] Worker:   http://127.0.0.1:8787');
console.log('[dev:all] Press Ctrl+C to stop both services.');
