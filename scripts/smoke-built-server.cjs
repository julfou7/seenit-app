const http = require('node:http');
const { spawn } = require('node:child_process');

const child = spawn(process.execPath, ['dist/server.cjs'], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: '3000'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let stdout = '';
let stderr = '';
const append = (current, chunk) => (current + chunk.toString()).slice(-12_000);
child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });

let exited = false;
let exitCode = null;
child.once('exit', code => {
  exited = true;
  exitCode = code;
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function requestHealth() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:3000/api/health', { timeout: 1500 }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve({ statusCode: res.statusCode, headers: res.headers, body });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('health timeout')));
    req.on('error', reject);
  });
}

async function stopChild() {
  if (exited) return;
  child.kill('SIGTERM');
  for (let attempt = 0; attempt < 10 && !exited; attempt += 1) await sleep(100);
  if (!exited) child.kill('SIGKILL');
}

(async () => {
  const deadline = Date.now() + 15_000;
  let lastError = null;

  while (Date.now() < deadline) {
    if (exited) break;
    try {
      const health = await requestHealth();
      if (
        health.statusCode === 200
        && health.body?.status === 'ok'
        && health.body?.service === 'seenit-backend'
        && health.body?.identity === 'canonical'
        && String(health.headers['x-seenit-backend'] || '').toLowerCase() === 'canonical'
      ) {
        console.log('[BackendProductionSmoke] dist/server.cjs démarre et /api/health est canonique.');
        await stopChild();
        process.exit(0);
      }
      lastError = new Error(`health invalide: HTTP ${health.statusCode}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }

  await stopChild();
  console.error(`[BackendProductionSmoke] Échec du démarrage production: ${lastError?.message || `process exit ${exitCode}`}`);
  if (stdout.trim()) console.error(`--- stdout ---\n${stdout.trim()}`);
  if (stderr.trim()) console.error(`--- stderr ---\n${stderr.trim()}`);
  process.exit(1);
})().catch(async error => {
  await stopChild();
  console.error(`[BackendProductionSmoke] Erreur: ${error?.message || error}`);
  process.exit(1);
});
