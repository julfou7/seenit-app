const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const configPath = path.join(root, 'docs', 'specifications', 'quality-gates.json');
const reportDir = path.join(root, 'quality-reports');
const previewUrl = 'http://127.0.0.1:4173/';

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function appendGithubMetric(name, seconds) {
  if (!process.env.GITHUB_ENV) return;
  fs.appendFileSync(process.env.GITHUB_ENV, `${name}=${seconds}\n`, 'utf8');
}

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) throw new Error(`Chrome/Chromium introuvable (${candidates.join(', ')}).`);
  return found;
}

async function waitForHttp(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.status < 500) return;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Preview Vite indisponible après ${timeoutMs} ms : ${lastError?.message || 'timeout'}`);
}

function listenForDevtools(processHandle, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('Chrome n’a pas exposé DevTools à temps.')), timeoutMs);
    let buffer = '';
    const onData = chunk => {
      buffer += chunk.toString();
      const match = buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(deadline);
      processHandle.stderr.off('data', onData);
      resolve(match[1]);
    };
    processHandle.stderr.on('data', onData);
    processHandle.once('exit', code => {
      clearTimeout(deadline);
      reject(new Error(`Chrome s’est arrêté avant DevTools (code ${code}).`));
    });
  });
}

function devtoolsPort(browserWsUrl) {
  const url = new URL(browserWsUrl);
  return Number(url.port);
}

async function createPageWebSocket(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  if (!response.ok) throw new Error(`Création onglet CDP impossible : HTTP ${response.status}`);
  const target = await response.json();
  if (!target.webSocketDebuggerUrl) throw new Error('webSocketDebuggerUrl absent pour l’onglet CDP.');
  return target.webSocketDebuggerUrl;
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket = null;
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) {
        Promise.resolve(listener(message.params || {})).catch(error => {
          console.error(`[PWA Browser] événement ${message.method}:`, error);
        });
      }
    });
    this.socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('Connexion CDP fermée.'));
      this.pending.clear();
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket?.close();
  }
}

async function evaluate(client, expression, awaitPromise = true) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate a échoué.');
  }
  return result.result?.value;
}

async function waitForLogin(client, timeoutMs = 9_000) {
  const deadline = Date.now() + timeoutMs;
  let snapshot;
  while (Date.now() < deadline) {
    snapshot = await evaluate(client, `(() => {
      const buttons = [...document.querySelectorAll('button')];
      const login = buttons.find(button => button.textContent?.includes('Continuer avec Google'));
      return {
        ready: Boolean(login) && !document.querySelector('#seenit-splash-screen'),
        text: document.body?.innerText?.slice(0, 500) || '',
        splash: Boolean(document.querySelector('#seenit-splash-screen')),
      };
    })()`);
    if (snapshot?.ready) return snapshot;
    await delay(150);
  }
  throw new Error(`Écran de connexion non prêt : ${JSON.stringify(snapshot)}`);
}

async function captureScreenshot(client, filePath) {
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(filePath, Buffer.from(screenshot.data, 'base64'));
}

function findNamedButton(nodes, name) {
  return nodes.find(node =>
    node.role?.value === 'button' &&
    node.name?.value?.includes(name) &&
    !node.ignored
  );
}

async function testViewport(client, viewport, minTouchTargetCssPx) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.width < 600,
  });
  await client.send('Page.navigate', { url: previewUrl });
  await waitForLogin(client);

  const metrics = await evaluate(client, `(() => {
    const button = [...document.querySelectorAll('button')].find(node => node.textContent?.includes('Continuer avec Google'));
    const rect = button?.getBoundingClientRect();
    return {
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      button: rect ? { width: rect.width, height: rect.height, text: button.textContent?.trim() } : null,
    };
  })()`);
  if (!metrics?.button) throw new Error(`${viewport.id}: bouton de connexion introuvable.`);
  if (metrics.scrollWidth > metrics.innerWidth + 1) {
    throw new Error(`${viewport.id}: débordement horizontal ${metrics.scrollWidth}px > ${metrics.innerWidth}px.`);
  }
  if (metrics.button.width < minTouchTargetCssPx || metrics.button.height < minTouchTargetCssPx) {
    throw new Error(`${viewport.id}: cible de connexion ${metrics.button.width}×${metrics.button.height}px < ${minTouchTargetCssPx}px.`);
  }

  fs.mkdirSync(reportDir, { recursive: true });
  await captureScreenshot(client, path.join(reportDir, `pwa-${viewport.id}.png`));
  return metrics;
}

async function runKeyboardAndAccessibilityChecks(client, minTouchTargetCssPx) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await client.send('Emulation.setEmulatedMedia', {
    media: '',
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await client.send('Page.navigate', { url: previewUrl });
  await waitForLogin(client);
  let keyboard;
  let tabCount = 0;
  for (; tabCount < 12; tabCount += 1) {
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await delay(75);
    keyboard = await evaluate(client, `(() => {
      const active = document.activeElement;
      const rect = active?.getBoundingClientRect?.();
      return {
        tag: active?.tagName || null,
        text: active?.textContent?.trim() || '',
        width: rect?.width || 0,
        height: rect?.height || 0,
      };
    })()`);
    if (keyboard?.tag === 'BUTTON' && keyboard.text.includes('Continuer avec Google')) break;
  }
  if (keyboard?.tag !== 'BUTTON' || !keyboard.text.includes('Continuer avec Google')) {
    throw new Error(`Clavier : la connexion n’est pas atteignable en 12 Tab (${JSON.stringify(keyboard)}).`);
  }
  if (keyboard.width < minTouchTargetCssPx || keyboard.height < minTouchTargetCssPx) {
    throw new Error(`Clavier : cible active ${keyboard.width}×${keyboard.height}px < ${minTouchTargetCssPx}px.`);
  }

  const ax = await client.send('Accessibility.getFullAXTree');
  const loginNode = findNamedButton(ax.nodes || [], 'Continuer avec Google');
  if (!loginNode) throw new Error('Arbre d’accessibilité : bouton « Continuer avec Google » absent ou ignoré.');

  return {
    activeElement: keyboard,
    tabCount: tabCount + 1,
    loginAccessibilityNode: {
      role: loginNode.role?.value,
      name: loginNode.name?.value,
      ignored: loginNode.ignored,
    },
  };
}

async function main() {
  const started = Date.now();
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  fs.mkdirSync(reportDir, { recursive: true });
  const diagnostics = [];
  let preview;
  let chrome;
  let client;
  try {
    const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
    if (!fs.existsSync(viteBin)) throw new Error('Vite installé requis avant le smoke navigateur.');
    preview = spawn(process.execPath, [viteBin, 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    preview.stdout.on('data', chunk => diagnostics.push(`[vite] ${chunk.toString().trim()}`));
    preview.stderr.on('data', chunk => diagnostics.push(`[vite] ${chunk.toString().trim()}`));
    await waitForHttp(previewUrl);

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seenit-chrome-'));
    chrome = spawn(findChrome(), [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    const browserWs = await listenForDevtools(chrome);
    const pageWs = await createPageWebSocket(devtoolsPort(browserWs));
    client = new CdpClient(pageWs);
    await client.connect();
    await Promise.all([
      client.send('Page.enable'),
      client.send('Runtime.enable'),
      client.send('Network.enable'),
      client.send('Accessibility.enable'),
      client.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }),
    ]);
    client.on('Fetch.requestPaused', async event => {
      const url = new URL(event.request.url);
      const local = (url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.port === '4173';
      if (local || url.protocol === 'data:' || url.protocol === 'blob:') {
        await client.send('Fetch.continueRequest', { requestId: event.requestId });
      } else {
        await client.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' });
      }
    });

    const viewports = [];
    for (const viewport of config.pwa.viewports) {
      viewports.push({
        id: viewport.id,
        ...(await testViewport(client, viewport, config.pwa.minTouchTargetCssPx)),
      });
    }
    const accessibility = await runKeyboardAndAccessibilityChecks(client, config.pwa.minTouchTargetCssPx);
    const report = {
      generatedAt: new Date().toISOString(),
      issue: config.issue,
      status: 'pass',
      networkIsolation: 'Les requêtes hors http://127.0.0.1:4173 sont bloquées par CDP.',
      viewports,
      accessibility,
    };
    fs.writeFileSync(path.join(reportDir, 'pwa-browser.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(reportDir, 'pwa-browser.md'), [
      '# Smoke navigateur PWA SeenIt',
      '',
      '- État : ✅ vert',
      '- Réseau : origines externes bloquées, aucun compte personnel contacté.',
      `- Cible tactile minimale : ${config.pwa.minTouchTargetCssPx} CSS px.`,
      '- Clavier : le bouton de connexion est atteignable au Tab.',
      '- Accessibilité : le bouton de connexion est exposé comme bouton nommé dans l’arbre Chromium.',
      '- Captures : mobile 360 px, mobile 412 px et desktop 1280 px.',
      '',
    ].join('\n'), 'utf8');
    console.log('[PWA Browser] ✅ rendu 360/412/desktop, clavier, cible tactile et arbre d’accessibilité validés.');
  } catch (error) {
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, 'pwa-browser-failure.txt'), `${error.stack || error.message}\n\n${diagnostics.join('\n')}\n`, 'utf8');
    throw error;
  } finally {
    client?.close();
    if (chrome && !chrome.killed) chrome.kill('SIGTERM');
    if (preview && !preview.killed) preview.kill('SIGTERM');
    appendGithubMetric('SEENIT_PWA_QUALITY_SECONDS', Math.ceil((Date.now() - started) / 1000));
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[PWA Browser] ❌ ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  CdpClient,
  findNamedButton,
  findChrome,
  waitForHttp,
};
