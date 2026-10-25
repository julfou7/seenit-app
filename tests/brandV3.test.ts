import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { brandStackedSvg } from '../src/assets/brandStacked.ts';

test('SEENIT-APK-001 marque v3 autorisée conserve package signature et icônes verrouillées', () => {
 const contract=JSON.parse(fs.readFileSync('docs/specifications/android-contract.json','utf8'));
 assert.equal(contract.applicationId,'com.seenit.app');
 assert.equal(contract.signing.keyAlias,'seenit');
 assert.equal(contract.signing.certificateSha256,'c8f9245671c6e4e73baf55281280ada35ff80bbe7dce800b29d2bb7d7f247853');
 for(const asset of contract.brandAssets) assert.equal(createHash('sha256').update(fs.readFileSync(asset.path)).digest('hex'),asset.sha256,asset.path);
 for(const file of ['ic_launcher','ic_launcher_round']) assert.match(fs.readFileSync('android/app/src/main/res/mipmap-anydpi-v26/'+file+'.xml','utf8'),/@drawable\/ic_launcher_monochrome/);
 assert.match(fs.readFileSync('android/app/src/main/res/drawable/ic_stat_seenit.xml','utf8'),/M12,4.02 A7.98/);
});

test('SEENIT-UX-009 marque v3 réutilise les tracés et termine la séquence de splash', () => {
 const paths=['src/components/SeenItLogo.tsx','src/screens/WatchListView.tsx','src/screens/LoginScreen.tsx','index.html'];
 for(const file of paths) assert.match(fs.readFileSync(file,'utf8'),/seenit-logo-(?:sombre|empile-sombre)|SeenItLogo variant="horizontal"/);
 const splash=fs.readFileSync('src/components/SplashScreen.tsx','utf8');
 assert.match(splash,/Array.from\(\{length:8\}/);
 assert.match(splash,/BRAND_SPLASH_ANIMATION_MS = 3700/);
 assert.match(splash,/data-ready=\{timeElapsed \|\| !animate \|\| reducedMotion\}/);
 assert.doesNotMatch(fs.readFileSync('src/App.tsx','utf8'),/minimumDisplayTime=\{0\}/);
 assert.doesNotMatch(fs.readFileSync('public/brand/seenit-logo-sombre.svg','utf8'),/<script|\bon\w+=|href=/i);
 assert.doesNotMatch(fs.readFileSync('public/brand/seenit-logo-empile-sombre.svg','utf8'),/<rect/);
 assert.doesNotMatch(brandStackedSvg,/<rect/);
});
