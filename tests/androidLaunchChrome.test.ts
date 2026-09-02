import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const capacitorConfig = readFileSync('capacitor.config.ts', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const login = readFileSync('src/screens/LoginScreen.tsx', 'utf8');
const webSplash = readFileSync('src/components/SplashScreen.tsx', 'utf8');
const css = readFileSync('src/index.css', 'utf8');
const indexHtml = readFileSync('index.html', 'utf8');
const styles = readFileSync('android/app/src/main/res/values/styles.xml', 'utf8');

const legacyNativeSplashIcon = 'android/app/src/main/res/drawable/seenit_splash_icon.xml';

test('SEENIT-APK-005 TNR conserve la status bar transparente avec icônes claires', () => {
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

test('SEENIT-APK-005 TNR conserve un seul splash brandé visible', () => {
  assert.match(styles, /windowSplashScreenBackground">@color\/splashBackground/);
  assert.match(styles, /windowSplashScreenAnimatedIcon">@android:color\/transparent/);
  assert.doesNotMatch(styles, /windowSplashScreenAnimatedIcon">@drawable\/seenit_splash_icon/);
  assert.equal(existsSync(legacyNativeSplashIcon), false);

  assert.match(app, /import \{ SplashScreen \} from '\.\/components\/SplashScreen'/);
  assert.match(app, /<SplashScreen[\s\S]*?animate=\{true\}/);
  assert.match(webSplash, /id="seenit-splash-screen"/);
  assert.match(webSplash, /L'expérience cinéma & séries/);

  assert.match(app, /requestAnimationFrame\(\(\) => \{[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?CapSplashScreen\.hide\(\)/);
  assert.match(capacitorConfig, /SplashScreen:\s*\{[\s\S]*?launchAutoHide: false,[\s\S]*?backgroundColor: '#040406'/);
});
