import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const capacitorConfig = readFileSync('capacitor.config.ts', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const login = readFileSync('src/screens/LoginScreen.tsx', 'utf8');
const css = readFileSync('src/index.css', 'utf8');
const indexHtml = readFileSync('index.html', 'utf8');
const styles = readFileSync('android/app/src/main/res/values/styles.xml', 'utf8');
const nativeSplash = readFileSync('android/app/src/main/res/drawable/seenit_splash_icon.xml', 'utf8');

test('SEENIT-APK-005 supprime la bande noire de status bar sans perdre la safe area', () => {
  assert.match(capacitorConfig, /StatusBar:\s*\{[\s\S]*?overlaysWebView: true,[\s\S]*?backgroundColor: '#00000000',[\s\S]*?style: 'DARK'/);
  assert.match(app, /StatusBar\.setStyle\(\{ style: Style\.Dark \}\)/);
  assert.doesNotMatch(app, /StatusBar\.setStyle\(\{ style: Style\.Light \}\)/);
  assert.match(app, /StatusBar\.setOverlaysWebView\(\{ overlay: true \}\)/);
  assert.match(app, /StatusBar\.setBackgroundColor\(\{ color: '#00000000' \}\)/);
  assert.match(styles, /android:statusBarColor">@android:color\/transparent/);
  assert.match(css, /\.pt-safe\s*\{\s*padding-top: env\(safe-area-inset-top, 0px\)/);
  assert.match(indexHtml, /viewport-fit=cover/);
  assert.match(app, /bg-premium-ambient[^"\n]*pt-safe/);
  assert.match(login, /bg-premium-ambient[^"\n]*pt-safe/);
});

test('SEENIT-APK-005 affiche le branding natif avant le premier rendu WebView', () => {
  assert.match(styles, /windowSplashScreenAnimatedIcon">@drawable\/seenit_splash_icon/);
  assert.doesNotMatch(styles, /windowSplashScreenAnimatedIcon">@android:color\/transparent/);
  assert.match(nativeSplash, /#F5C518/);
  assert.match(nativeSplash, /M 7\.5,10\.5 L 10\.5,13\.5 L 16\.5,7\.5/);
  assert.match(indexHtml, /class="instant-splash"/);
  assert.match(indexHtml, /background-color: #040406/);
});
