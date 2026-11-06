import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import vm from 'node:vm';

const source = readFileSync('src/components/HomeNotifications.tsx', 'utf8');
const page = readFileSync('src/components/HomeNotificationsPage.tsx', 'utf8');
const css = readFileSync('src/screens/watchListHome.css', 'utf8');

test('SEENIT-UX-018 #876 la cloche ouvre une page Notifications au contrat des sous-pages Réglages', () => {
  assert.match(page, /<SettingsSubscreen title="Notifications" onClose=\{onClose\}>/);
  assert.match(source, /lazy\(\(\) => import\('\.\/HomeNotificationsPage'\)/, 'la page reste hors du chargement d’À voir');
  assert.match(source, /onClose=\{\(\) => setOpen\(false\)\} onMarkAll=\{markAllRead\} onOpenNotice=\{openNotice\} onDismiss=\{dismiss\}/);
  assert.doesNotMatch(source + page, /<DialogLayer/, 'plus de feuille modale qui masque la navigation');
  assert.match(css, /\.home-notifications-page \.home-notice \.home-notice__text strong \{[^}]*color:#f2c36b/, 'titre média en or, même lu');
});

test('SEENIT-UX-018 #876 aucune action visible par notification ; Retirer reste accessible sans geste', () => {
  assert.doesNotMatch(source + page, /SeenItCheckButton/);
  assert.doesNotMatch(source + page, /onSeen/);
  assert.match(page, /className="home-notice__dismiss sr-only focus:not-sr-only" aria-label=\{`Retirer la notification \$\{notice\.title\}`\} onClick=\{\(\) => onDismiss\(notice\)\}>Retirer<\/button>/);
  assert.match(page, /<HomeNoticeSwipe key=\{notice\.id\} onDismiss=\{\(\) => onDismiss\(notice\)\}>/);
});

test('SEENIT-UX-018 #876 la page se ferme seule après la dernière notification retirée ou Tout marquer lu', () => {
  const autoClose = source.slice(source.indexOf('const hadVisibleNotices'), source.indexOf('const dismiss ='));
  assert.match(autoClose, /if \(visibleNotices\.length\) hadVisibleNotices\.current = true;/);
  assert.match(autoClose, /else if \(!loading && hadVisibleNotices\.current\) setOpen\(false\);/);
  const markAll = source.slice(source.indexOf('const markAllRead'), source.indexOf('const openNotice'));
  assert.match(markAll, /void markRead\(visibleNotices\);\s*setOpen\(false\);/);
  // Toucher une notification la marque lue, ferme la page et ouvre la fiche exacte.
  const openNotice = source.slice(source.indexOf('const openNotice'), source.indexOf('return <>'));
  assert.match(openNotice, /void markRead\(\[notice\]\); setOpen\(false\);/);
  assert.match(openNotice, /else if \(notice\.show\) onOpen\(notice\.show\.id, notice\.show\.mediaType\)/);
});

test('SEENIT-UX-018 #876 le glissement fait sortir la carte puis la retire, immédiatement si mouvement réduit', async () => {
  const bundle = await build({ entryPoints: ['src/components/cards/HomeNoticeSwipe.tsx'], bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{ name: 'notice-gesture-ports', setup(builder) {
      builder.onResolve({ filter: /^(?:react(?:\/jsx-runtime)?|lucide-react)$/ }, args => ({ path: args.path, namespace: 'ports' }));
      builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: 'export const useRef=value=>({current:value});export const useState=value=>[value,()=>{}];export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Trash2=()=>null;' }));
    } }],
  });
  for (const reduced of [false, true]) {
    const timers: number[] = [];
    const module = { exports: {} as { HomeNoticeSwipe: (props: { children: string; onDismiss: () => void }) => { props: Record<string, (event: unknown) => void> } } };
    const window = { matchMedia: () => ({ matches: reduced }) };
    let pending: (() => void) | null = null;
    vm.runInContext(bundle.outputFiles[0].text, vm.createContext({ module, window, setTimeout: (callback: () => void, delay: number) => { pending = callback; timers.push(delay); return 0; } }));
    let dismissed = 0;
    const handlers = module.exports.HomeNoticeSwipe({ children: 'Une notification', onDismiss: () => dismissed++ }).props;
    const pointer = { button: 0, pointerId: 1, clientX: 40, clientY: 100, target: { closest: () => null }, currentTarget: { setPointerCapture() {} }, preventDefault() {}, stopPropagation() {} };
    let stopped = false;
    handlers.onTouchStart({ stopPropagation: () => { stopped = true; } });
    assert.equal(stopped, true, 'un glissement parti d’une carte ne ferme pas la page par le bord gauche');
    handlers.onPointerDown(pointer);
    handlers.onPointerMove({ ...pointer, clientX: 160 });
    handlers.onPointerUp(pointer);
    if (reduced) {
      assert.equal(dismissed, 1, 'mouvement réduit : retrait immédiat');
      assert.deepEqual(timers, []);
    } else {
      assert.equal(dismissed, 0, 'la carte sort d’abord de l’écran');
      assert.deepEqual(timers, [220]);
      pending!();
      assert.equal(dismissed, 1);
    }
  }
});
