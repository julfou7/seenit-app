const fs = require('node:fs');
const path = require('node:path');

/**
 * #1079 : le smoke tournait seulement sous Linux (CI) ; les chemins Windows et macOS de Chrome, puis Edge (Chromium),
 * permettent de rejouer un couloir en local (`SEENIT_PWA_ONLY=downloads`) avant de pousser. Module sans effet de bord
 * (le charger dans les tests unitaires ne doit rien démarrer).
 */
function chromeCandidates(env = process.env, platform = process.platform) {
  const windows = platform === 'win32' ? [
    env.PROGRAMFILES && path.join(env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    env['PROGRAMFILES(X86)'] && path.join(env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    env['PROGRAMFILES(X86)'] && path.join(env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    env.PROGRAMFILES && path.join(env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'),
  ] : [];
  const mac = platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'] : [];
  return [env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', ...windows, ...mac].filter(Boolean);
}

function findChrome() {
  const candidates = chromeCandidates();
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) throw new Error(`Chrome/Chromium introuvable (${candidates.join(', ')}).`);
  return found;
}

module.exports = { chromeCandidates, findChrome };
